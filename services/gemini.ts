
import { GoogleGenAI } from "@google/genai";
import { SessionResult, DetailedFeedback } from "../types";

/**
 * Detecção dinâmica de chave de API - Alinhada com useLiveAvatar.ts
 */
const getApiKey = () => {
  const key = (process as any).env?.GEMINI_API_KEY ||
    (process as any).env?.API_KEY ||
    (process as any).env?.VITE_GEMINI_API_KEY ||
    (import.meta as any).env?.VITE_GEMINI_API_KEY ||
    (typeof window !== 'undefined' && (window as any).VITE_GEMINI_API_KEY) ||
    "";
  return key;
};

/**
 * Utilitário avançado para reparo de JSON truncado.
 */
const safeJsonParse = (text: string): any => {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.includes("```json")) {
    cleaned = cleaned.split("```json")[1].split("```")[0];
  } else if (cleaned.includes("```")) {
    cleaned = cleaned.split("```")[1].split("```")[0];
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.log("[Gemini Service] Iniciando reparo estrutural do JSON...");
    let repaired = cleaned;
    let inString = false;
    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) inString = !inString;
    }
    if (inString) repaired += '"';

    const stack: string[] = [];
    let inStrRep = false;
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (inStrRep) {
        if (char === '"' && (i === 0 || repaired[i - 1] !== '\\')) inStrRep = false;
        continue;
      }
      if (char === '"' && (i === 0 || repaired[i - 1] !== '\\')) inStrRep = true;
      else if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}') { if (stack[stack.length - 1] === '}') stack.pop(); }
      else if (char === ']') { if (stack[stack.length - 1] === ']') stack.pop(); }
    }
    repaired = repaired.replace(/,\s*$/, "");
    while (stack.length > 0) repaired += stack.pop();

    try {
      return JSON.parse(repaired);
    } catch (e2) {
      console.error("[Gemini Service] Falha crítica de reparo.");
      return null;
    }
  }
};

// Modelos priorizando o menor custo (Flash é mais barato que Pro)
const MODELS = {
  // Apenas modelos Flash para custo mínimo absoluto
  EVAL: ["gemini-2.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash"],
  DETAILED: ["gemini-2.5-flash", "gemini-1.5-flash-latest"]
};

export const evaluateSession = async (transcript: string): Promise<Omit<SessionResult, 'durationSeconds' | 'date' | 'avatarName'>> => {
  if (!transcript || transcript.trim().length < 10) {
    return { overallScore: 10, vocabularyScore: 10, grammarScore: 10, pronunciationScore: 10, coherenceScore: 10, confidenceScore: 10, feedback: "Diálogo insuficiente.", fluencyRating: 'Beginner', transcript };
  }

  const apiKey = getApiKey();
  if (!apiKey) return { overallScore: 50, vocabularyScore: 50, grammarScore: 50, pronunciationScore: 50, coherenceScore: 50, confidenceScore: 50, fluencyRating: 'Beginner', feedback: "Erro: Chave de API ausente.", transcript };

  const genAI = new GoogleGenAI({ apiKey });
  const prunedTranscript = transcript.split('\n').filter(l => l.trim()).slice(-10).join('\n');

  for (const modelName of MODELS.EVAL) {
    try {
      const response = await (genAI as any).models.generateContent({
        model: modelName,
        contents: [{
          role: 'user', parts: [{
            text: `Aja como Native English Teacher. Analise o transcript e forneça o feedback no formato JSON.
                        REGRAS DE FEEDBACK:
                        1. LINGUAGEM OBRIGATÓRIA: Português (pt-BR).
                        2. ESCALA DE NOTAS: Use obrigatoriamente 0 a 100 (ex: 85 para 85%). NUNCA use escala 0-10.
                        3. Use entre 60 e 90 palavras no total.
                        4. Use tópicos (bullet points) para listar erros e dicas.
                        5. Cite obrigatoriamente um ponto forte e um ponto de correção gramatical do diálogo.
                        6. Dê dicas práticas de estudo.
                        
                        Transcript: ${prunedTranscript}
                        
                        JSON schema:
                        {
                          "overallScore": number,
                          "vocabularyScore": number,
                          "grammarScore": number,
                          "pronunciationScore": number,
                          "coherenceScore": number,
                          "confidenceScore": number,
                          "fluencyRating": "Beginner"|"Intermediate"|"Advanced"|"Native",
                          "feedback": "string"
                        }`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 768, // Reduzido para economia extrema
          temperature: 0.7,
          responseMimeType: "application/json"
        },
        systemInstruction: {
          parts: [{ text: "Você é um mentor rigoroso de inglês. Nunca forneça respostas curtas ou genéricas. Use a escala total de 0 a 100 para refletir o desempenho real." }]
        }
      });

      const text = response.text || (response.response && response.response.text && (typeof response.response.text === 'function' ? response.response.text() : response.response.text));
      const r = safeJsonParse(text);

      if (r) {
        // Normalização defensiva: Se a IA retornar na escala 0-10, converte para 0-100
        const normalize = (val: any) => {
          let n = Number(val);
          if (isNaN(n)) return 50;
          return (n > 0 && n <= 10) ? n * 10 : n;
        };

        console.log(`[Gemini Eval] Sucesso com ${modelName}`);
        return {
          overallScore: normalize(r.overallScore),
          vocabularyScore: normalize(r.vocabularyScore),
          grammarScore: normalize(r.grammarScore),
          pronunciationScore: normalize(r.pronunciationScore),
          coherenceScore: normalize(r.coherenceScore),
          confidenceScore: normalize(r.confidenceScore),
          fluencyRating: r.fluencyRating || 'Beginner',
          feedback: r.feedback || "Excelente prática! Continue assim.",
          transcript
        };
      }
    } catch (error: any) {
      if (!error.message.includes('404')) console.error(`[Gemini Eval] Erro em ${modelName}:`, error.message);
    }
  }

  return { overallScore: 50, vocabularyScore: 50, grammarScore: 50, pronunciationScore: 50, coherenceScore: 50, confidenceScore: 50, fluencyRating: 'Beginner', feedback: "Sua prática foi concluída! Continue conversando para expandir seu inglês.", transcript };
};

export const generateDetailedFeedback = async (currentTranscript: string, history: SessionResult[]): Promise<DetailedFeedback | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const genAI = new GoogleGenAI({ apiKey });
  const trans = currentTranscript.split('\n').filter(l => l.trim()).slice(-10).join('\n');
  const hist = history.slice(0, 10).map(s => ({
    d: s.date.split('T')[0],
    s: {
      fluencia: s.overallScore,
      vocabulario: s.vocabularyScore,
      precisao_gramatical: s.grammarScore,
      clareza_pronuncia: s.pronunciationScore,
      coerencia: s.coherenceScore || s.overallScore, // Fallback para registros antigos
      confianca: s.confidenceScore || s.overallScore
    }
  }));

  for (const modelName of MODELS.DETAILED) {
    try {
      const response = await (genAI as any).models.generateContent({
        model: modelName,
        contents: [{
          role: 'user',
          parts: [{
            text: `Gere um relatório JSON de evolução baseado no histórico e transcript.
                    Transcript: ${trans}
                    Histórico: ${JSON.stringify(hist)}
                    
                    REGRAS:
                    1. Preencha TODAS as métricas: fluencia, vocabulario, precisao_gramatical, clareza_pronuncia, coerencia, confianca.
                    2. Dê notas técnicas reais.
                    3. Feedbacks e resumo DEVEM ser objetivos, diretos e em Português.
                    4. Seja conciso para economizar tokens.
                    
                    JSON: {
                      "metricas_atuais": { "[fluencia, vocabulario, precisao_gramatical, clareza_pronuncia, coerencia, confianca]": {"score":0, "tendencia":"evoluindo"|"estavel"|"regredindo"} },
                      "feedbacks": { "[fluencia, vocabulario, precisao_gramatical, clareza_pronuncia, coerencia, confianca]": "texto objetivo e direto" },
                      "resumo_geral": "análise concisa",
                      "dados_grafico_historico": { "[fluencia, vocabulario, precisao_gramatical, clareza_pronuncia, coerencia, confianca]": [{"data":"...", "score":0}] }
                    }` }]
        }],
        generationConfig: {
          maxOutputTokens: 2560, // Aumentado para garantir JSON completo sem custo Pro
          temperature: 0.1,
          responseMimeType: "application/json"
        },
        systemInstruction: {
          parts: [{ text: "Você é um Consultor Pedagógico. Gere relatórios ricos e evite textos curtos. Garanta integridade total do JSON." }]
        }
      });

      const text = response.text || (response.response && response.response.text && (typeof response.response.text === 'function' ? response.response.text() : response.response.text));
      const parsed = safeJsonParse(text);
      if (parsed && parsed.metricas_atuais) {
        console.log(`[Gemini Feedback] Sucesso com ${modelName}`);
        return parsed;
      }
    } catch (e: any) {
      if (!e.message.includes('404')) console.error(`[Gemini Feedback] Erro em ${modelName}:`, e.message);
    }
  }
  return null;
};
