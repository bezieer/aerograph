import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GeminiAnalysisResult } from '../types';

const apiKey = process.env.API_KEY || '';

// We create the client inside the function call to ensure we pick up the key if it changes, 
// though typically env vars are static.
const getAIClient = () => new GoogleGenAI({ apiKey });

export const analyzeSmokeArt = async (base64Image: string): Promise<GeminiAnalysisResult> => {
  if (!apiKey) {
    throw new Error("API Key is missing");
  }

  const ai = getAIClient();
  
  // Remove header if present (data:image/png;base64,)
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const prompt = `
    You are an art critic specializing in abstract fluid dynamics and ephemeral art.
    Analyze this generated smoke image. 
    
    1. Give it a short, poetic title.
    2. Describe the shapes, movement, and pareidolia (what objects it resembles, e.g., a dragon, a cloud, a dancer).
    3. Describe the mood (e.g., ethereal, turbulent, calm).
    
    Keep the description under 50 words.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      mood: { type: Type.STRING }
    },
    required: ["title", "description", "mood"]
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Data
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text) as GeminiAnalysisResult;

  } catch (error) {
    console.error("Gemini analysis failed:", error);
    throw error;
  }
};