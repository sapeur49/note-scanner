# ── Add this endpoint to ra-match-scanner/app/main.py ──────────────────────
# Paste after the existing imports and config — no new imports needed,
# everything below is already imported in main.py.

SCAN_PROMPT = """You are processing scanned note images. For each image provided:
1. Transcribe ALL visible text. Use paragraph breaks between distinct sections. Use bullet points only where the original notes use them. Do NOT wrap text at arbitrary line lengths — write flowing prose where the original is prose.
2. Produce a concise summary highlighting key points and any action items.

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "concise summary with key points and action items",
  "transcription": "full verbatim transcription of all text across all images"
}"""


@app.post("/api/scan")
async def scan_notes(files: List[UploadFile] = File(...)):
    """Accept one or more note images → return AI summary + transcription."""
    if not client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    if not files:
        raise HTTPException(status_code=400, detail="No images provided")

    image_blocks = []
    for f in files:
        data = await f.read()
        b64 = base64.b64encode(data).decode()
        media_type = f.content_type or "image/jpeg"
        image_blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": b64},
        })

    image_blocks.append({"type": "text", "text": SCAN_PROMPT})

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": image_blocks}],
    )

    raw = response.content[0].text
    import re
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(status_code=502, detail="Unexpected response from Claude")

    return json.loads(match.group())
