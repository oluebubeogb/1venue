// Read-out (text-to-speech) for the browser. Served as /features/tts/readout.js.
//
//   const engine = await readOutEngine(lang, { headers })   // 'cloud' | 'browser' | null
//   readOut({ verses, text, lang }, { engine, headers })    // starts reading
//   stopReadOut(); isReadingOut(); onReadOutChange(fn)
//
// 'cloud' = the server's /api/tts (Replicate model) for languages on its allowlist.
// 'browser' = the device's own speech voices, only when one exists for exactly this language.
// null = hide the read-out icon; we never fall back to an English voice for other languages.
import { api, toast } from '/js/ui.js';
import { state } from '/js/app.js';
import { speak, stop as browserStop, isSpeaking as browserSpeaking, onTtsChange, ttsSupported } from '/js/tts.js';
import { normLang, detectLang, chooseEngine } from '/features/tts/lang.js';

export { detectLang, normLang };

let cfgPromise = null;
export function ttsConfig() {
  cfgPromise ||= api('/api/tts/config').catch(() => ({ enabled: false, languages: [], maxChars: 1000 }));
  return cfgPromise;
}

function browserVoiceLangs() {
  if (!ttsSupported()) return Promise.resolve([]);
  const read = () => (window.speechSynthesis.getVoices() || []).map((v) => v.lang).filter(Boolean);
  const now = read();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(read());
    window.speechSynthesis.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function readOutEngine(lang, { headers } = {}) {
  const l = normLang(lang);
  if (!l) return null;
  const [cfg, browserLangs] = await Promise.all([ttsConfig(), browserVoiceLangs()]);
  return chooseEngine(l, {
    cloudEnabled: !!cfg.enabled,
    cloudLanguages: cfg.languages || [],
    canUseCloud: !!(headers && headers['X-Room-Credential']) || !!state.user,
    browserLangs,
  });
}

// ---- cloud playback: one <audio> at a time, next chunk fetched while the current one plays
const listeners = new Set();
let session = null; // { audio, stopped }
const notify = () => { for (const fn of listeners) { try { fn(isReadingOut()); } catch { /* */ } } };
onTtsChange(() => notify());

export function onReadOutChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isReadingOut() { return !!session || browserSpeaking(); }
export function stopReadOut() {
  if (session) { session.stopped = true; try { session.audio && session.audio.pause(); } catch { /* */ } session = null; }
  browserStop();
  notify();
}

function chunks(text, max) {
  const out = [];
  let buf = '';
  for (const s of String(text).split(/(?<=[.!?؛۔。])\s+/)) {
    if (s.length > max) { if (buf) { out.push(buf); buf = ''; } for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max)); continue; }
    if ((buf + ' ' + s).trim().length > max) { out.push(buf); buf = s; } else buf = (buf + ' ' + s).trim();
  }
  if (buf) out.push(buf);
  return out.filter(Boolean);
}

async function readCloud(text, lang, headers) {
  const me = { stopped: false, audio: null };
  session = me; // set synchronously so the caller sees isReadingOut() === true right away
  notify();
  let parts;
  try {
    const cfg = await ttsConfig();
    parts = chunks(text, Math.max(100, (cfg.maxChars || 1000) - 20));
  } catch (e) { if (session === me) { session = null; notify(); } throw e; }
  const fetchPart = (t) => api('/api/tts', { method: 'POST', body: { text: t, lang }, headers: headers || {} });
  try {
    let next = fetchPart(parts[0]);
    for (let i = 0; i < parts.length && !me.stopped; i++) {
      const { url } = await next;
      if (me.stopped) break;
      if (i + 1 < parts.length) next = fetchPart(parts[i + 1]);
      me.audio = new Audio(url);
      await new Promise((resolve, reject) => {
        me.audio.onended = resolve;
        me.audio.onerror = () => reject(new Error('Could not play the audio'));
        me.audio.play().catch(reject);
      });
    }
  } finally {
    if (session === me) { session = null; notify(); }
  }
}

/**
 * Start reading. payload = { verses?: [{ text }], text?: string, lang }.
 * Returns false when nothing could be started.
 */
export async function readOut(payload, { engine, headers } = {}) {
  stopReadOut();
  const { verses, text } = payload || {};
  const lang = normLang(payload && payload.lang);
  const items = verses && verses.length ? verses.map((v) => ({ v: v.v ?? null, text: String(v.text || '').replace(/^¶\s*/, '').trim() })).filter((x) => x.text) : null;
  const plain = items ? items.map((x) => x.text).join(' ') : String(text || '').trim();
  if (!plain || !engine || !lang) { toast('Nothing to read', { icon: 'info' }); return false; }
  if (engine === 'browser') return speak(items || plain, { lang }).ok;
  readCloud(plain, lang, headers).catch((e) => {
    if (e && e.status === 401) toast('Sign in to listen', { icon: 'info' });
    else toast(e?.message || 'Could not read this right now', { icon: 'alert' });
  });
  return true;
}
