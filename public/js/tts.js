// Browser text-to-speech for scripture (Web Speech API). Cloud upgrade later.
let speaking = false;
let queue = [];
let current = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn({ speaking, current }); } catch { /* ignore */ }
  }
}

export function onTtsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function voices() {
  try { return window.speechSynthesis.getVoices() || []; } catch { return []; }
}

/** Prefer exact BCP-47, then language prefix, then any local voice. */
export function bestVoice(lang) {
  const list = voices();
  if (!list.length) return null;
  const primary = String(lang || 'en').toLowerCase().split('-')[0];
  const tags = [];
  if (lang) tags.push(String(lang).toLowerCase());
  // Common expansions
  const expand = {
    en: ['en-US', 'en-GB', 'en'],
    ar: ['ar-SA', 'ar-XA', 'ar-EG', 'ar'],
    yo: ['yo-NG', 'yo'],
    ig: ['ig-NG', 'ig'],
    ha: ['ha-NG', 'ha'],
    sw: ['sw-KE', 'sw-TZ', 'sw'],
    fr: ['fr-FR', 'fr'],
    es: ['es-ES', 'es-MX', 'es'],
    pt: ['pt-BR', 'pt-PT', 'pt'],
    de: ['de-DE', 'de'],
  };
  for (const t of (expand[primary] || [primary])) tags.push(t.toLowerCase());

  const byLang = (pred) => list.find(pred);
  for (const tag of tags) {
    const hit = byLang((v) => (v.lang || '').toLowerCase() === tag)
      || byLang((v) => (v.lang || '').toLowerCase().startsWith(tag.split('-')[0]));
    if (hit) return hit;
  }
  // Prefer local English as last resort only when primary is en
  if (primary === 'en') {
    return byLang((v) => (v.lang || '').toLowerCase().startsWith('en') && v.localService)
      || byLang((v) => (v.lang || '').toLowerCase().startsWith('en'))
      || list[0];
  }
  return byLang((v) => (v.lang || '').toLowerCase().startsWith(primary)) || null;
}

export function langForTranslation(tr) {
  if (!tr) return 'en';
  if (typeof tr === 'string') return tr;
  return tr.lang || 'en';
}

function chunkText(text, max = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const parts = [];
  let buf = '';
  for (const sentence of t.split(/(?<=[.!?؛。])\s+/)) {
    if ((buf + ' ' + sentence).trim().length > max && buf) {
      parts.push(buf.trim());
      buf = sentence;
    } else buf = (buf + ' ' + sentence).trim();
  }
  if (buf) parts.push(buf.trim());
  return parts;
}

/**
 * Speak plain text or an array of { v, text } verses.
 * @param {string|{v?:number,text:string}[]} input
 * @param {{ lang?: string, rate?: number, onBoundary?: (v:number|null)=>void }} opts
 */
export function speak(input, opts = {}) {
  if (!ttsSupported()) return { ok: false, reason: 'unsupported' };
  stop();
  const lang = opts.lang || 'en';
  const rate = Math.min(1.4, Math.max(0.7, Number(opts.rate) || 1));
  const voice = bestVoice(lang);

  const items = Array.isArray(input)
    ? input.map((v) => ({ v: v.v ?? null, text: String(v.text || '').replace(/^¶\s*/, '').trim() })).filter((x) => x.text)
    : chunkText(input).map((text) => ({ v: null, text }));

  if (!items.length) return { ok: false, reason: 'empty' };
  if (!voice && !lang.startsWith('en')) {
    // Still try with lang tag — browser may resolve online
  }

  queue = items.slice();
  speaking = true;
  notify();

  const next = () => {
    if (!queue.length) {
      speaking = false;
      current = null;
      notify();
      opts.onBoundary && opts.onBoundary(null);
      return;
    }
    const item = queue.shift();
    current = item;
    opts.onBoundary && opts.onBoundary(item.v);
    const u = new SpeechSynthesisUtterance(item.text);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => next();
    u.onerror = () => next();
    try {
      window.speechSynthesis.speak(u);
    } catch {
      speaking = false;
      current = null;
      notify();
    }
  };
  // Chrome: voices may load async
  const start = () => next();
  if (!voices().length) {
    const prev = window.speechSynthesis.onvoiceschanged;
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = prev;
      start();
    };
    // Fallback if event never fires
    setTimeout(start, 250);
  } else start();

  return { ok: true, voice: voice?.name || null, lang: voice?.lang || lang };
}

export function stop() {
  queue = [];
  current = null;
  speaking = false;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  notify();
}

export function isSpeaking() {
  return speaking;
}

export function hasVoiceFor(lang) {
  return !!bestVoice(lang);
}
