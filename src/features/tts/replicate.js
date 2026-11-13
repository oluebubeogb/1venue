/**
 * Minimal Replicate client for one prediction: create, wait (Prefer: wait), poll if still
 * running, then download the output file. Official models are run with
 * POST /v1/models/{owner}/{name}/predictions; a pinned "owner/name:version" uses POST /v1/predictions.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

async function fetchJson(url, opts, what) {
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw fail(502, `Could not reach the speech service (${what})`); }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = body && (body.detail || body.error || body.title);
    if (res.status === 401 || res.status === 403) console.error('[tts] Replicate rejected the API token');
    else console.error('[tts] Replicate', what, res.status, detail || '');
    throw fail(res.status === 429 ? 429 : 502, res.status === 429 ? 'The speech service is busy, try again in a moment' : 'The speech service could not read this right now');
  }
  return body;
}

/** Returns { audio: Buffer, mime, predictionId }. */
async function synthesize(cfg, input) {
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
  const [ref, version] = cfg.model.split(':');
  const url = version ? `${cfg.apiBase}/predictions` : `${cfg.apiBase}/models/${ref}/predictions`;
  const body = version ? { version, input } : { input };
  const deadline = Date.now() + cfg.timeoutMs;

  let pred = await fetchJson(url, { method: 'POST', headers: { ...headers, Prefer: 'wait=60' }, body: JSON.stringify(body) }, 'create');
  while (pred && ['starting', 'processing'].includes(pred.status)) {
    if (Date.now() > deadline) throw fail(504, 'Reading this took too long, try a shorter passage');
    await sleep(1000);
    const getUrl = pred.urls && pred.urls.get;
    if (!getUrl) break;
    pred = await fetchJson(getUrl, { headers }, 'poll');
  }
  if (!pred || pred.status !== 'succeeded') {
    console.error('[tts] prediction', pred && pred.id, pred && pred.status, pred && pred.error);
    throw fail(502, 'The speech service could not read this right now');
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof out !== 'string' || !/^https?:\/\//.test(out)) throw fail(502, 'The speech service returned no audio');

  let res;
  try { res = await fetch(out); } catch { throw fail(502, 'Could not download the audio'); }
  if (!res.ok) throw fail(502, 'Could not download the audio');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > cfg.maxAudioBytes) throw fail(502, 'The audio is too large');
  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length || audio.length > cfg.maxAudioBytes) throw fail(502, 'The speech service returned no audio');
  const mime = /\.wav(\?|$)/i.test(out) || cfg.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  return { audio, mime, predictionId: pred.id };
}

module.exports = { synthesize };
