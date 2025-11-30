import re

INPUT_FILE = "notes.txt"
OUTPUT_FILE = "knowledge.txt"

with open(INPUT_FILE, "r", encoding="utf-8") as f:
    text = f.read()

# 1) Grab a short overview line (optional but nice)
intro = ""
m_intro = re.search(r"Indoor Playgrounds in Australia[^\n]*", text)
if m_intro:
    intro = m_intro.group(0).strip()

# 2) Grab the main block that contains Underwood / Mt Gravatt / Redcliffe / Helensvale
m_loc = re.search("Underwood Info", text)
if not m_loc:
    raise SystemExit("Could not find 'Underwood Info' in notes.txt")

# Take a window around that section (adjust AFTER_CHARS if you want more/less)
BEFORE_CHARS = 80
AFTER_CHARS = 2000
start = max(0, m_loc.start() - BEFORE_CHARS)
end = min(len(text), m_loc.end() + AFTER_CHARS)
location_block = text[start:end]

# 3) Clean the location block line by line (remove obvious navigation junk)
SKIP_PHRASES = [
    "LEARN MORE",
    "My Booking",
    "CHANGE LOCATION",
    "Change Location",
    "Online bookings are essential",
    "Buy Tickets",
    "Book Party",
    "Check what’s available at your chosen location",
]

clean_lines = []
for line in location_block.splitlines():
    stripped = line.strip()
    if not stripped:
        continue
    if any(p.lower() in stripped.lower() for p in SKIP_PHRASES):
        continue
    clean_lines.append(stripped)

clean_block = "\n".join(clean_lines)

# 4) Build the final trimmed knowledge text
parts = []
if intro:
    parts.append("Area51 Overview:\n" + intro)

parts.append("Location details:\n" + clean_block)

knowledge_text = "\n\n".join(parts)

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.write(knowledge_text)

print(f"Wrote trimmed notes to {OUTPUT_FILE}")
print(f"Characters: {len(knowledge_text)}, words: {len(knowledge_text.split())}")
