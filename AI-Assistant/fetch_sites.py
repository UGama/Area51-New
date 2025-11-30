import requests
from bs4 import BeautifulSoup

# 1) Put the pages you want here
URLS = [
    "https://www.area51world.com.au/",
    "https://www.area51world.com.au/activities/",
    "https://www.area51world.com.au/parties/",
    "https://www.area51world.com.au/tickets/underwood/",
    "https://www.area51world.com.au/gift-cards/underwood/",
    "https://www.area51world.com.au/locations/",
    "https://www.area51world.com.au/tickets/redcliffe/",
    "https://www.area51world.com.au/tickets/helensvale/",
    "https://www.area51world.com.au/tickets/mt-gravatt/",
]

def fetch_clean_text(url: str) -> str:
    print(f"Fetching {url} ...")
    headers = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/129.0.0.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=10)

    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove scripts / styles
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    # Get visible text, clean empty lines
    text = soup.get_text("\n")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)

def main():
    parts = []

    # (Optional) include your own notes first
    try:
        with open("my_notes.txt", "r", encoding="utf-8") as f:
            parts.append("MY NOTES:\n" + f.read().strip())
    except FileNotFoundError:
        pass

    # Add website content
    for url in URLS:
        text = fetch_clean_text(url)
        parts.append(f"CONTENT FROM {url}:\n{text}")

    # Write everything into notes.txt (used by your app)
    with open("notes.txt", "w", encoding="utf-8") as f:
        f.write("\n\n" + ("-" * 80) + "\n\n".join(parts))

    print("Saved combined notes to notes.txt")

if __name__ == "__main__":
    main()
