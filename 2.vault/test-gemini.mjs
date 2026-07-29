// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  console.log("⚡ Connecting to Gemini API...\n");

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Hello! Please confirm backend connectivity and system operational status for KLYN AI OS.',
  });

  console.log("--- Gemini Response ---");
  console.log(response.text);
}

run().catch((err) => {
  console.error("API Connection Error:", err.message);
});
