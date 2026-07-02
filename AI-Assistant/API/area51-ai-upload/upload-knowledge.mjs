import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing from .env");
}

const ai = new GoogleGenAI({ apiKey });

// Reuse the store that was already created successfully.
const storeName =
  "fileSearchStores/area-51-world-knowledge-bas-38llyew541qi";

async function uploadKnowledge() {
  console.log("Using File Search store:");
  console.log(storeName);

  console.log("Uploading and indexing knowledge file...");

  let operation =
    await ai.fileSearchStores.uploadToFileSearchStore({
      file: "./area51_knowledge_base.md",
      fileSearchStoreName: storeName,

      config: {
        mimeType: "text/markdown",
        displayName: "Area 51 World Public Information",

        chunkingConfig: {
          whiteSpaceConfig: {
            maxTokensPerChunk: 500,
            maxOverlapTokens: 75
          }
        }
      }
    });

  while (!operation.done) {
    console.log("Still indexing...");

    await new Promise((resolve) =>
      setTimeout(resolve, 5000)
    );

    operation = await ai.operations.get({
      operation
    });
  }

  console.log("\nKnowledge upload finished.");
  console.log("Store name:");
  console.log(storeName);
}

uploadKnowledge().catch((error) => {
  console.error("Upload failed:", error);
  process.exit(1);
});