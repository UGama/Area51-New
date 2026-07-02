import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const storeName =
  process.env.GEMINI_FILE_SEARCH_STORE;

if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing from .env"
  );
}

if (!storeName) {
  throw new Error(
    "GEMINI_FILE_SEARCH_STORE is missing from .env"
  );
}

const ai = new GoogleGenAI({ apiKey });

console.log("Using File Search store:", storeName);

async function askArea51(question) {
  const prompt = `
You are the official customer-service assistant for Area 51 World.

RULES

1. Only answer questions about Area 51 World, its venues,
   services, activities, tickets, parties, policies and Gizmo Courts.

2. Base factual answers only on information retrieved from the
   approved company knowledge file.

3. Never invent:
   - prices
   - opening hours
   - availability
   - age, height or weight restrictions
   - refund decisions
   - promotions
   - booking details

4. If the question is unrelated, reply:
   "I can only assist with questions about Area 51 World and its services."

5. If the answer is not available in the knowledge file, reply:
   "I don't have confirmed information about that. Please contact an Area 51 employee."

6. Prices, operating hours, promotions and event dates may change.
   When discussing these, recommend confirming through the live booking page.

CUSTOMER QUESTION

${question}
`;

  const interaction = await ai.interactions.create({
    model: "gemini-3.5-flash",
    input: prompt,
    tools: [
      {
        type: "file_search",
        file_search_store_names: [storeName]
      }
    ]
  });

  let answer = "";

  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;

    for (const block of step.content ?? []) {
      if (block.type === "text") {
        answer += block.text ?? "";
      }
    }
  }

  return answer.trim();
}

const answer = await askArea51(
  "Can I bring outside food to the Helensvale venue?"
);

console.log(answer);