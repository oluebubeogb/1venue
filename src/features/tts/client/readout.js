// Read-out (text-to-speech) for the browser. Served as /features/tts/readout.js.
//
//   const engine = await readOutEngine(lang, { headers })   // 'cloud' | 'browser' | null
//   readOut({ verses, text, lang }, { engine, headers })    // starts reading
//   stopReadOut(); isReadingOut(); onReadOutChange(fn)
//
// 'browser' = the device's own speech voice for exactly this language. Preferred: free and instant.
// 'cloud'   = the server's /api/tts (Replicate model), only for languages the device can't speak.
// 'signin'  = cloud would work, but the viewer must log in first (cloud audio costs money).
// null      = hide the read-out icon; we never fall back to an English voice for other languages.
import { api, toast } from '/js/ui.js';
import { state, goLogin } from '/js/app.js';
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
let session = null; // { audio, stopped, preparing }
// A tiny silent clip played on the tap itself "unlocks" one <audio> element on iOS/Safari, so the
// cloud clip can start seconds later (after the server generates it) without being blocked.
const SILENT = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let player = null;
function unlockPlayer() {
  try {
    player ||= new Audio();
    player.src = SILENT;
    const p = player.play(); if (p && p.catch) p.catch(() => {});
  } catch { /* old browsers: a fresh Audio() is used */ }
  return player;
}
export const isPreparing = () => !!(session && session.preparing);
const notify = () => { for (const fn of listeners) { try { fn(isReadingOut()); } catch { /* */ } } };
onTtsChange(() => notify());

export function onReadOutChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isReadingOut() { return !!session || browserSpeaking(); }
export function stopReadOut() {
  if (session) { session.stopped = true; try { session.audio && session.audio.pause(); } catch { /* */ } session = null; }
  else if (player) { try { player.pause(); } catch { /* */ } }
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

async function readCloud(text, lang, headers, el) {
  const me = { stopped: false, audio: null, preparing: true };
  session = me; // set synchronously so the caller sees isReadingOut() === true right away
  notify();
  let parts;
  try {
    const cfg = await ttsConfig();
    const max = Math.max(100, (cfg.maxChars || 1000) - 20);
    parts = chunks(text, max);
    // A short first clip starts playback sooner; later clips are generated while it plays.
    if (parts[0] && parts[0].length > 320) parts = [...chunks(parts[0], 300), ...parts.slice(1)];
  } catch (e) { if (session === me) { session = null; notify(); } throw e; }
  const fetchPart = (t) => api('/api/tts', { method: 'POST', body: { text: t, lang }, headers: headers || {} });
  try {
    let next = fetchPart(parts[0]);
    for (let i = 0; i < parts.length && !me.stopped; i++) {
      const { url } = await next;
      if (me.stopped) break;
      if (i + 1 < parts.length) next = fetchPart(parts[i + 1]);
      me.audio = el || new Audio();
      me.audio.src = url;
      await new Promise((resolve, reject) => {
        me.audio.onended = resolve;
        me.audio.onerror = () => reject(new Error('Could not play the audio'));
        me.audio.play().then(() => { if (me.preparing) { me.preparing = false; notify(); } }).catch((e) => reject(e && e.name === 'NotAllowedError' ? new Error('Tap the speaker again to play') : e));
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
  if (engine === 'signin') { toast('Log in to listen', { icon: 'login' }); goLogin(); return false; }
  const el = unlockPlayer(); // must run inside the tap, before any await
  readCloud(plain, lang, headers, el).catch((e) => {
    if (e && e.status === 401) toast('Sign in to listen', { icon: 'info' });
    else toast(e?.message || 'Could not read this right now', { icon: 'alert' });
  });
  return true;
}
