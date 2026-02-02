
import { GoogleGenAI, Type } from "@google/genai";
import { SessionResult, DetailedFeedback } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Utilitário para extrair e analisar JSON de uma string de forma robusta.
 * Lida com blocos de código Markdown ou texto extra após o objeto JSON.
 */
const safeJsonParse = (text: string): any => {
  if (!text) return null;
  
  // Tenta o parse direto primeiro (caminho feliz)
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    // Se falhar, tenta limpar blocos de código markdown
    let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      // Se ainda falhar, tenta extrair o primeiro objeto { } ou array [ ] encontrado
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        try {
          return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } catch (e3) {
          console.error("[Gemini Service] Falha crítica ao extrair JSON:", e3);
        }
      }
      throw e; // Lança o erro original se nada funcionar
    }
  }
};

export const evaluateSession = async (transcript: string): Promise<Omit<SessionResult, 'durationSeconds' | 'date' | 'avatarName'>> => {
  if (!transcript || transcript.trim().length < 10) {
    return {
      overallScore: 10,
      vocabularyScore: 10,
      grammarScore: 10,
      pronunciationScore: 10,
      feedback: "A sessão foi muito curta para avaliar corretamente. Continue praticando!",
      fluencyRating: 'Beginner',
      transcript: transcript
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Analyze the following English conversation transcript between a user and an AI tutor. 
      The user is learning English. 
      
      Provide a comprehensive evaluation returning a JSON object.
      
      Strict Scoring Criteria:
      1. vocabularyScore (0-100): Evaluate range of words and idiomatic usage.
      2. grammarScore (0-100): Evaluate syntax accuracy and tense consistency.
      3. pronunciationScore (0-100): Estimate based on transcript clarity.
      4. overallScore (0-100): (vocabularyScore * 0.3) + (grammarScore * 0.3) + (pronunciationScore * 0.4).
      5. fluencyRating: "Beginner", "Intermediate", "Advanced", or "Native".
      6. feedback: A constructive paragraph (max 60 words) in Portuguese.

      Transcript:
      ${transcript}`,
      config: {
        thinkingConfig: { thinkingBudget: 2048 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.INTEGER },
            vocabularyScore: { type: Type.INTEGER },
            grammarScore: { type: Type.INTEGER },
            pronunciationScore: { type: Type.INTEGER },
            fluencyRating: { type: Type.STRING, enum: ["Beginner", "Intermediate", "Advanced", "Native"] },
            feedback: { type: Type.STRING }
          },
          required: ["overallScore", "vocabularyScore", "grammarScore", "pronunciationScore", "fluencyRating", "feedback"]
        }
      }
    });

    const result = safeJsonParse(response.text);
    return {
      overallScore: result?.overallScore || 0,
      vocabularyScore: result?.vocabularyScore || 0,
      grammarScore: result?.grammarScore || 0,
      pronunciationScore: result?.pronunciationScore || 0,
      fluencyRating: result?.fluencyRating || 'Beginner',
      feedback: result?.feedback || "Bom esforço!",
      transcript: transcript
    };
  } catch (error) {
    console.error("Evaluation error:", error);
    return {
      overallScore: 50,
      vocabularyScore: 50,
      grammarScore: 50,
      pronunciationScore: 50,
      fluencyRating: 'Beginner',
      feedback: "Sessão concluída. Avaliação simplificada devido a instabilidade técnica.",
      transcript: transcript
    };
  }
};

export const generateDetailedFeedback = async (currentTranscript: string, history: SessionResult[]): Promise<DetailedFeedback | null> => {
  try {
    const historyContext = history.slice(0, 10).map(s => ({
      date: s.date,
      overall: s.overallScore,
      vocab: s.vocabularyScore,
      grammar: s.grammarScore,
      pronunciation: s.pronunciationScore
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Você é um Agente de Avaliação de Aprendizado de Inglês de alta performance. Analise as sessões e gere métricas precisas.

      OBJETIVO:
      Avaliar o desempenho do usuário em inglês, identificar progresso ou regressão e fornecer dados estruturados.

      ENTRADA:
      1. Transcrição da sessão atual.
      2. Histórico do usuário (últimas 10 sessões).

      Transcrição Atual:
      ${currentTranscript}

      Histórico:
      ${JSON.stringify(historyContext)}

      REGRAS IMPORTANTES:
      - Atribuir pontuação de 0 a 100 para todas as métricas.
      - Determinar tendência: "evoluindo", "estavel", "regredindo".
      - Feedback textual específico e em português.
      - Gerar dados para gráfico histórico baseado nas datas do histórico fornecido.
      - Saída deve ser APENAS o JSON, sem texto explicativo antes ou depois.

      FORMATO DE SAÍDA (JSON ESTRITO):
      {
        "metricas_atuais": {
          "fluencia": { "score": number, "tendencia": "evoluindo|estavel|regredindo" },
          "vocabulario": { "score": number, "tendencia": "evoluindo|estavel|regredindo" },
          "precisao_gramatical": { "score": number, "tendencia": "evoluindo|estavel|regredindo" },
          "clareza_pronuncia": { "score": number, "tendencia": "evoluindo|estavel|regredindo" },
          "coerencia": { "score": number, "tendencia": "evoluindo|estavel|regredindo" },
          "confianca": { "score": number, "tendencia": "evoluindo|estavel|regredindo" }
        },
        "feedbacks": {
          "fluencia": "string",
          "vocabulario": "string",
          "precisao_gramatical": "string",
          "clareza_pronuncia": "string",
          "coerencia": "string",
          "confianca": "string"
        },
        "resumo_geral": "string (máx 3 frases)",
        "dados_grafico_historico": {
          "fluencia": [ { "data": "YYYY-MM-DD", "score": number } ],
          "vocabulario": [ { "data": "YYYY-MM-DD", "score": number } ],
          "precisao_gramatical": [ { "data": "YYYY-MM-DD", "score": number } ],
          "clareza_pronuncia": [ { "data": "YYYY-MM-DD", "score": number } ],
          "coerencia": [ { "data": "YYYY-MM-DD", "score": number } ],
          "confianca": [ { "data": "YYYY-MM-DD", "score": number } ]
        }
      }`,
      config: {
        thinkingConfig: { thinkingBudget: 4000 },
        responseMimeType: "application/json"
      }
    });

    return safeJsonParse(response.text);
  } catch (error) {
    console.error("Detailed feedback error:", error);
    return null;
  }
};
