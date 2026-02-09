
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../utils/audio';
import { AvatarConfig } from '../types';

interface UseLiveAvatarProps {
  avatarConfig: AvatarConfig;
  onTranscriptUpdate: (text: string, isUser: boolean) => void;
}

export const useLiveAvatar = ({ avatarConfig, onTranscriptUpdate }: UseLiveAvatarProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const isConnectingRef = useRef(false);
  const isActiveRef = useRef(false);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  const disconnect = useCallback(async (isManual = true) => {
    isActiveRef.current = false;

    if (isManual) {
      retryCountRef.current = 0;
    }

    if (sessionPromiseRef.current) {
      const sessionToClose = sessionPromiseRef.current;
      sessionPromiseRef.current = null;
      try {
        const session = await sessionToClose;
        session.close();
      } catch (e) {
        console.warn("[Live] Error closing session:", e);
      }
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
    }

    if (isManual) {
      if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close().catch(() => { });
        inputAudioContextRef.current = null;
      }
      if (outputAudioContextRef.current) {
        outputAudioContextRef.current.close().catch(() => { });
        outputAudioContextRef.current = null;
      }
    }

    setIsConnected(false);
    setIsTalking(false);
    isConnectingRef.current = false;
  }, []);

  const isTalkingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptBufferRef = useRef<{ text: string, isUser: boolean }[]>([]);

  // Throttle de transcrição para reduzir carga de UI em mobile
  useEffect(() => {
    const interval = setInterval(() => {
      if (transcriptBufferRef.current.length > 0) {
        // Agrupa textos do mesmo tipo
        const groups: { text: string, isUser: boolean }[] = [];
        transcriptBufferRef.current.forEach(item => {
          const last = groups[groups.length - 1];
          if (last && last.isUser === item.isUser) {
            last.text += item.text;
          } else {
            groups.push({ ...item });
          }
        });

        groups.forEach(group => onTranscriptUpdate(group.text, group.isUser));
        transcriptBufferRef.current = [];
      }
    }, 150); // 150ms é um bom balanço entre tempo real e performance
    return () => clearInterval(interval);
  }, [onTranscriptUpdate]);

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    isActiveRef.current = true;

    try {
      setError(null);
      const isActuallyReconnecting = retryCountRef.current > 0;
      setIsReconnecting(isActuallyReconnecting);

      if (!inputAudioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        inputAudioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
        outputAudioContextRef.current = new AudioContextClass({ sampleRate: 24000 });

        // Keep-alive: Oscilador silencioso para evitar que o Android suspenda o áudio
        const keepAliveOsc = outputAudioContextRef.current.createOscillator();
        const keepAliveGain = outputAudioContextRef.current.createGain();
        keepAliveGain.gain.value = 0.001; // Quase inaudível, mas detectável pelo hardware
        keepAliveOsc.connect(keepAliveGain);
        keepAliveGain.connect(outputAudioContextRef.current.destination);
        keepAliveOsc.start();

        analyserRef.current = outputAudioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 512;
        const outputNode = outputAudioContextRef.current.createGain();
        analyserRef.current.connect(outputNode);
        outputNode.connect(outputAudioContextRef.current.destination);
      }

      if (inputAudioContextRef.current.state === 'suspended') await inputAudioContextRef.current.resume();
      if (outputAudioContextRef.current && outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();

      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || (window as any).VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("Chave de API ausente.");

      const ai = new GoogleGenAI({ apiKey });

      const currentSessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: avatarConfig.voice } },
          },
          systemInstruction: `YOU ARE A NATIVE SPEAKER CONVERSATION PARTNER.
          - MANDATORY RULE: NEVER repeat, parrot, or rephrase the user's sentence back to them if they are correct.
          - NO CONFIRMATION: Do not say "You said correctly: ..." or similar.
          - FLOW: If the user is correct, respond IMMEDIATELY to their question or comment like a real human friend.
          - CORRECTION: ONLY use the word "Correction:" if there is a real grammatical error. If you correct, be brief: "Correction: [Right sentence]. Anyway, [Your response]".
          - PORTUGUESE: You understand Portuguese perfectly. If the user is stuck, help them in English.
          - ROLEPLAY: Act according to your specific persona: ${avatarConfig.systemInstruction}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            if (!isActiveRef.current) { disconnect(true); return; }
            setIsConnected(true);
            setIsReconnecting(false);
            isConnectingRef.current = false;
            retryCountRef.current = 0;

            if (!inputAudioContextRef.current || !streamRef.current) return;

            inputAudioContextRef.current.resume();
            sourceRef.current = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            processorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

            processorRef.current.onaudioprocess = (e) => {
              if (!isActiveRef.current) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              currentSessionPromise.then(session => {
                if (isActiveRef.current && session) {
                  try {
                    session.sendRealtimeInput({ media: pcmBlob });
                  } catch (err) {
                    // Ignore WebSocket closing errors during disconnect/instability
                  }
                }
              }).catch(() => { });
            };

            sourceRef.current.connect(processorRef.current);
            processorRef.current.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!isActiveRef.current) return;

            if (message.serverContent?.outputTranscription?.text) {
              transcriptBufferRef.current.push({ text: message.serverContent.outputTranscription.text, isUser: false });
            }
            if (message.serverContent?.inputTranscription?.text) {
              transcriptBufferRef.current.push({ text: message.serverContent.inputTranscription.text, isUser: true });
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (parts && outputAudioContextRef.current && analyserRef.current) {
              const ctx = outputAudioContextRef.current;

              if (ctx.state === 'suspended') await ctx.resume();

              const LOOKAHEAD_DELAY = 1.0;

              for (const part of parts) {
                const base64Audio = part.inlineData?.data;
                if (base64Audio && isActiveRef.current) {
                  try {
                    // decodeAudioData agora é síncrona para maior precisão
                    const audioBuffer = decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(analyserRef.current);

                    source.addEventListener('ended', () => {
                      sourcesRef.current.delete(source);

                      // Grace period: Só limpa isTalking se nada for agendado nos próximos 500ms
                      // Isso evita loops se houver gaps pequenos no áudio em dispositivos lentos
                      if (sourcesRef.current.size === 0) {
                        if (isTalkingTimeoutRef.current) clearTimeout(isTalkingTimeoutRef.current);
                        isTalkingTimeoutRef.current = setTimeout(() => {
                          if (sourcesRef.current.size === 0) setIsTalking(false);
                          isTalkingTimeoutRef.current = null;
                        }, 500);
                      }
                    });

                    const currentTime = ctx.currentTime;
                    // Se o tempo planejado já passou ou não há nada tocando
                    if (nextStartTimeRef.current < currentTime || sourcesRef.current.size === 0) {
                      nextStartTimeRef.current = currentTime + LOOKAHEAD_DELAY;
                    }

                    // Evita re-renders desnecessários se já estiver falando
                    if (isTalkingTimeoutRef.current) {
                      clearTimeout(isTalkingTimeoutRef.current);
                      isTalkingTimeoutRef.current = null;
                    }
                    setIsTalking(true);

                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourcesRef.current.add(source);
                  } catch (err) { console.error("[Live] Audio decode error", err); }
                }
              }
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsTalking(false);
              if (isTalkingTimeoutRef.current) {
                clearTimeout(isTalkingTimeoutRef.current);
                isTalkingTimeoutRef.current = null;
              }
            }
          },
          onclose: () => {
            setIsConnected(false);
            isConnectingRef.current = false;
            if (isActiveRef.current && retryCountRef.current < MAX_RETRIES) {
              retryCountRef.current++;
              setTimeout(() => connect(), 1000 * retryCountRef.current);
            }
          },
          onerror: (err) => {
            if (isActiveRef.current) {
              setError("Instabilidade. Reconectando...");
              disconnect(false);
            }
          }
        }
      });

      sessionPromiseRef.current = currentSessionPromise;
    } catch (err: any) {
      setError(err.message || "Falha na conexão.");
      isConnectingRef.current = false;
      disconnect(false);
    }
  }, [avatarConfig, disconnect, onTranscriptUpdate]);

  const sendText = useCallback((text: string) => {
    if (sessionPromiseRef.current && isActiveRef.current) {
      sessionPromiseRef.current.then(session => {
        if (!session || !isActiveRef.current) return;

        try {
          if (typeof (session as any).sendClientContent === 'function') {
            (session as any).sendClientContent({
              turns: [{ role: 'user', parts: [{ text }] }]
            });
          } else if (typeof (session as any).send === 'function') {
            (session as any).send({ parts: [{ text }] });
          }
        } catch (err) {
          console.error("[useLiveAvatar] Error in sendText:", err);
        }
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect(true);
      if (isTalkingTimeoutRef.current) clearTimeout(isTalkingTimeoutRef.current);
    };
  }, [disconnect]);

  return { connect, disconnect, isConnected, isTalking, isReconnecting, error, analyserNode: analyserRef.current, sendText };
};
