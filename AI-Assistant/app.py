from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__, static_folder=".", static_url_path="")

# Load your notes / website text once at startup
NOTES_PATH = "notes.txt"
if os.path.exists(NOTES_PATH):
    with open(NOTES_PATH, "r", encoding="utf-8") as f:
        NOTES = f.read()
else:
    NOTES = ""

SYSTEM_PROMPT = (
    "You are a friendly tutor for high-school students.\n"
    "Use ONLY the information in the following notes as your main reference.\n"
    "If a question is not covered in the notes, say you are not sure "
    "or answer briefly from general knowledge.\n\n"
    "NOTES:\n"
    + NOTES
)

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "llama3.2"   # you can change to llama3:8b later if your Mac is comfy

@app.post("/chat")
def chat():
    data = request.get_json()
    user_message = data.get("message", "").strip()

    if not user_message:
        return jsonify({"reply": "Please type a message."})

    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
    }

    r = requests.post(OLLAMA_URL, json=payload)
    r.raise_for_status()
    reply = r.json()["message"]["content"]

    return jsonify({"reply": reply})


# Serve the frontend
@app.route("/")
def index():
    # Serve the main page; static files (CSS, images) are handled by Flask's static settings above.
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(debug=True)
