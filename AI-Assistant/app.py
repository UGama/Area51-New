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


SYSTEM_PROMPT = f"""
You are an AI robot for Area51, a chain of indoor amusement parks in Australia.

You MUST answer using ONLY the information in the NOTES below.

RULES:
- If the NOTES contain information that answers the question, summarise it clearly.
- If the NOTES do NOT contain the answer, reply exactly:
  "I don't know based on what I know."
- Do NOT give generic advice like "check online directories" or "use Google".
- Stay friendly and concise.

NOTES:
{NOTES}
"""

print("SYSTEM_PROMPT preview:")
print(SYSTEM_PROMPT[:600])

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "llama3.2"   # you can change to llama3:8b later if your Mac is comfy

@app.post("/chat")
def chat():
    data = request.get_json()
    user_message = data.get("message", "").strip()

    if not user_message:
        return jsonify({"reply": "Please type a message."})

    relevant_notes = get_relevant_notes(user_message, NOTES)
    system_prompt = SYSTEM_PROMPT.replace("{NOTES}", relevant_notes)

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "options": {"num_ctx": 8192},
        "stream": False,
    }

    r = requests.post(OLLAMA_URL, json=payload)
    r.raise_for_status()
    reply = r.json()["message"]["content"]

    return jsonify({"reply": reply})

def get_relevant_notes(question, notes, max_chars=2000):
    # very naive keyword filter
    q_words = [w.lower() for w in re.findall(r"\w+", question)]
    paragraphs = notes.split("\n\n")
    scored = []

    for para in paragraphs:
        p_lower = para.lower()
        score = sum(1 for w in q_words if w in p_lower)
        if score > 0:
            scored.append((score, para))

    # sort best first
    scored.sort(reverse=True, key=lambda x: x[0])

    selected = []
    total = 0
    for score, para in scored:
        if total + len(para) > max_chars:
            break
        selected.append(para)
        total += len(para)

    # fallback: first few paragraphs if nothing matched
    if not selected:
        selected = paragraphs[:3]

    return "\n\n".join(selected)


# Serve the frontend
@app.route("/")
def index():
    # Serve the main page; static files (CSS, images) are handled by Flask's static settings above.
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True)
