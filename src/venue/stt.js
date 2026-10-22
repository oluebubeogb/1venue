/**
 * Speech-to-text. The primary is N-ATLaS (NCAIR1, Nigeria's open ASR models
 * fine-tuned from Whisper for Nigerian-accented English, Yoruba, Igbo and Hausa),
 * served behind an OpenAI-compatible /audio/transcriptions endpoint (see
 * stt-sidecar/ or a RunPod worker). Whisper is the secondary. When neither is
 * configured, clients fall back to the browser Web Speech API.
 */
const config = require('../config');

const LANG_MODELS = {
  // Per-language N-ATLaS checkpoints. A sidecar may also route by `language` itself.
  en: 'NCAIR1/NigerianAccentedEnglish',
  yo: 'NCAIR1/Yoruba-ASR',
  ig: 'NCAIR1/Igbo-ASR',
  ha: 'NCAIR1/Hausa-ASR',
};

function chain() {
  const mode = config.STT.provider;
  if (mode === 'off' || mode === 'webspeech') return [];
  const out = [];
  if ((mode === 'auto' || mode === 'natlas') && config.STT.primary.baseUrl) out.push({ ...config.STT.primary, kind: 'natlas' });
  if ((mode === 'auto' || mode === 'whisper') && config.STT.secondary.baseUrl) out.push({ ...config.STT.secondary, kind: 'whisper' });
  return out;
}
function status() {
  const c = chain();
  return {
    server: c.length > 0,
    providers: c.map((p) => p.name),
    fallback: config.STT.provider === 'off' ? 'none' : 'webspeech',
    chunkSeconds: config.STT.chunkSeconds,
    maxChunkBytes: config.STT.maxChunkBytes,
    languages: ['en', 'yo', 'ig', 'ha', 'pcm'],
  };
}

async function transcribeWith(p, buf, mime, lang) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.STT.timeoutMs);
  try {
    const fd = new FormData();
    const ext = /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mp4|m4a|aac/.test(mime) ? 'm4a' : 'webm';
    fd.append('file', new Blob([buf], { type: mime || 'audio/webm' }), `chunk.${ext}`);
    let model = p.model;
    if (p.kind === 'natlas' && lang && LANG_MODELS[lang] && /^NCAIR1\//.test(p.model)) model = LANG_MODELS[lang];
    fd.append('model', model);
    if (lang && lang !== 'pcm') fd.append('language', lang);
    fd.append('response_format', 'json');
    const r = await fetch(p.baseUrl + '/audio/transcriptions', {
      method: 'POST',
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
      body: fd,
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${p.name} HTTP ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    const text = ct.includes('json') ? ((await r.json()).text || '') : await r.text();
    return { text: String(text).trim(), provider: p.name, model };
  } finally {
    clearTimeout(timer);
  }
}

async function transcribe(buf, mime, lang) {
  const errors = [];
  for (const p of chain()) {
    try {
      return await transcribeWith(p, buf, mime, lang);
    } catch (e) {
      errors.push(e.message);
    }
  }
  const e = new Error(errors.length ? 'All STT providers failed: ' + errors.join('; ') : 'No server STT configured');
  e.status = 503;
  e.fallback = 'webspeech';
  throw e;
}

// Whisper-family models hallucinate on silence. Drop the usual phantom lines.
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|\.|bye\.?|subtitles by .*|\[music\]|\[silence\])$/i;
function clean(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return HALLUCINATIONS.test(t) ? '' : t;
}

module.exports = { status, transcribe, clean, LANG_MODELS };
