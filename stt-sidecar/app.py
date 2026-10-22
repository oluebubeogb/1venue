"""OpenAI-compatible /v1/audio/transcriptions in front of the N-ATLaS ASR checkpoints.
The NCAIR1 repos are gated on Hugging Face: accept the terms and set HF_TOKEN."""
import os, tempfile
from fastapi import FastAPI, UploadFile, File, Form
from transformers import pipeline
import librosa

MODELS = {"en": "NCAIR1/NigerianAccentedEnglish", "yo": "NCAIR1/Yoruba-ASR", "ig": "NCAIR1/Igbo-ASR", "ha": "NCAIR1/Hausa-ASR"}
ENABLED = [l.strip() for l in os.getenv("STT_LANGS", "en").split(",") if l.strip() in MODELS]
_pipes = {}
def pipe(lang):
    lang = lang if lang in ENABLED else ENABLED[0]
    if lang not in _pipes:
        _pipes[lang] = pipeline("automatic-speech-recognition", model=MODELS[lang], token=os.getenv("HF_TOKEN") or None, chunk_length_s=30)
    return _pipes[lang]

app = FastAPI()
@app.get("/health")
def health(): return {"ok": True, "languages": ENABLED}

@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), language: str = Form("en"), model: str = Form(None), response_format: str = Form("json")):
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(file.filename or "a.webm")[1] or ".webm") as f:
        f.write(await file.read()); f.flush()
        audio, _ = librosa.load(f.name, sr=16000, mono=True)
    text = pipe((language or "en")[:2])(audio)["text"].strip() if len(audio) else ""
    return {"text": text}
