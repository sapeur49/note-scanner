import base64
import json
import os
import re
from typing import List

import anthropic
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

MODEL = "claude-sonnet-4-6"
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY")) if os.environ.get("ANTHROPIC_API_KEY") else None

SCAN_PROMPT = """You are processing scanned note images. For each image provided:
1. Transcribe ALL visible text. Use paragraph breaks between distinct sections. Use bullet points only where the original notes use them. Do NOT wrap text at arbitrary line lengths — write flowing prose where the original is prose.
2. Produce a concise summary highlighting key points and any action items.

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "concise summary with key points and action items",
  "transcription": "full verbatim transcription of all text across all images"
}"""

app = FastAPI()


@app.post("/api/scan")
async def scan_notes(files: List[UploadFile] = File(...), instructions: str = Form(default="")):
    if not client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")
    if not files:
        raise HTTPException(status_code=400, detail="No images provided")

    image_blocks = []
    for f in files:
        data = await f.read()
        b64 = base64.b64encode(data).decode()
        media_type = f.content_type or "image/jpeg"
        if media_type == "application/pdf":
            image_blocks.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
            })
        else:
            image_blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64},
            })

    prompt = SCAN_PROMPT
    if instructions and instructions.strip():
        prompt += f"""\n\nAdditional instructions: {instructions.strip()}

Also include an "additional_notes" key in your JSON response addressing the additional instructions above. Omit "additional_notes" entirely if no additional instructions were given."""
    image_blocks.append({"type": "text", "text": prompt})

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": image_blocks}],
    )

    raw = response.content[0].text
    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(status_code=502, detail="Unexpected response from Claude")

    return json.loads(match.group())


# Serve static frontend — must come after API routes
app.mount("/", StaticFiles(directory=".", html=True), name="static")
