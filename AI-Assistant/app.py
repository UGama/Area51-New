from flask import Flask, request, jsonify
import requests
import os
import re

app = Flask(__name__, static_folder=".", static_url_path="")

# Load your notes / website text once at startup
NOTES_PATH = "knowledge.txt"
if os.path.exists(NOTES_PATH):
    with open(NOTES_PATH, "r", encoding="utf-8") as f:
        NOTES = f.read()
else:
    NOTES = ""
    print("⚠️ notes.txt not found, NOTES is empty")


SYSTEM_PROMPT_TEMPLATE = """
You are an AI robot for Area51, a chain of indoor amusement parks in Australia.

You MUST answer using ONLY the information in the NOTES below.

RULES:
- If the NOTES contain information that answers the question, summarise it clearly.
- If the NOTES do NOT contain the answer, reply exactly:
  "I don't know based on what I know."
- DO NOT give generic advice like "check online directories" or "use Google".
- Stay friendly and concise.

NOTES:
{NOTES}
"""

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "llama3.2"   # you can change to llama3:8b later if your Mac is comfy

@app.post("/chat")
def chat():
    data = request.get_json()
    user_message = data.get("message", "").strip()

    if not user_message:
        return jsonify({"reply": "Please type a message."})

    # NEW: pick relevant notes for this specific question
    relevant_notes = get_relevant_notes(user_message, NOTES, max_chars=5000)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(NOTES=relevant_notes)

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "options": {
            "num_ctx": 8192,  # enough for 5000 chars notes + prompt + answer
        },
        "stream": False,
    }

    r = requests.post(OLLAMA_URL, json=payload)
    r.raise_for_status()
    reply = r.json()["message"]["content"]

    return jsonify({"reply": reply})

def get_relevant_notes(question: str, notes: str, max_chars: int = 5000) -> str:
    """
    Return the most relevant parts of `notes` for this question,
    up to max_chars characters.
    """
    q_lower = question.lower()
    # words in the question
    q_words = set(re.findall(r"\w+", q_lower))

    # split the big notes into paragraphs
    paragraphs = notes.split("\n\n")

    # location keywords for bonus points
    location_keywords = [
        "underwood",
        "mt gravatt",
        "mount gravatt",
        "redcliffe",
        "helensvale",
        "area 51",
        "area51",
    ]

    scored = []
    for para in paragraphs:
        p = para.strip()
        if not p:
            continue
        p_lower = p.lower()
        score = 0

        # word overlap
        for w in q_words:
            if w and w in p_lower:
                score += 1

        # bonus if question + paragraph both mention a location name
        for loc in location_keywords:
            if loc in q_lower and loc in p_lower:
                score += 3

        if score > 0:
            scored.append((score, p))

    # if nothing matched, just take the first few paragraphs as a fallback
    if not scored:
        fallback = []
        total = 0
        for para in paragraphs:
            p = para.strip()
            if not p:
                continue
            if total + len(p) > max_chars:
                break
            fallback.append(p)
            total += len(p)
        return "\n\n".join(fallback)

    # sort by score (best first)
    scored.sort(key=lambda x: x[0], reverse=True)

    selected = []
    total_len = 0
    for score, p in scored:
        if total_len + len(p) > max_chars:
            break
        selected.append(p)
        total_len += len(p)

    return "\n\n".join(selected)


# Serve the frontend
@app.route("/")
def index():
    # Serve the main page; static files (CSS, images) are handled by Flask's static settings above.
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True)
