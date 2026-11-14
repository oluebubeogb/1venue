// Content-language detection for read-outs. Pure functions, no imports (unit-tested in Node).
//
// Rule: explicit language metadata always wins (Bible/Qur'an translation, event language, an
// element's lang attribute). Without metadata we only trust the writing system when it points
// to one language. Latin-script text (English, Igbo, Hausa, Yorùbá, French, …) and shared
// scripts (Cyrillic, Devanagari, Ethiopic) are NOT guessed: the read-out stays hidden instead
// of risking, say, Igbo read in an English voice.

const ALIASES = { tl: 'fil', no: 'nb', ps: 'pbt', swh: 'sw', arb: 'ar', ful: 'fuv', ff: 'fuv', khk: 'mn', zsm: 'ms', als: 'sq', uzn: 'uz',
  // ISO 639-2/3 and plain names people type into TTS_LANGUAGES
  ibo: 'ig', hau: 'ha', ara: 'ar', eng: 'en', yor: 'yo', fra: 'fr', fre: 'fr', swa: 'sw',
  igbo: 'ig', hausa: 'ha', arabic: 'ar', english: 'en', yoruba: 'yo', french: 'fr', swahili: 'sw' };

export function normLang(tag) {
  const p = String(tag || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (ALIASES[p]) return ALIASES[p];
  return /^[a-z]{2,3}$/.test(p) ? p : null;
}

// [regex for the script, language when the script is dominant (null = ambiguous)]
const SCRIPTS = [
  [/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, 'arabic'],
  [/[\u0590-\u05FF]/g, 'he'], [/[\u0370-\u03FF\u1F00-\u1FFF]/g, 'el'], [/[\u0E00-\u0E7F]/g, 'th'],
  [/[\uAC00-\uD7AF\u1100-\u11FF]/g, 'ko'], [/[\u3040-\u30FF]/g, 'ja'], [/[\u4E00-\u9FFF]/g, 'han'],
  [/[\u10A0-\u10FF]/g, 'ka'], [/[\u0530-\u058F]/g, 'hy'], [/[\u0980-\u09FF]/g, 'bn'], [/[\u0B80-\u0BFF]/g, 'ta'],
  [/[\u0C00-\u0C7F]/g, 'te'], [/[\u0C80-\u0CFF]/g, 'kn'], [/[\u0D00-\u0D7F]/g, 'ml'], [/[\u0A80-\u0AFF]/g, 'gu'],
  [/[\u0A00-\u0A7F]/g, 'pa'], [/[\u1780-\u17FF]/g, 'km'], [/[\u0E80-\u0EFF]/g, 'lo'], [/[\u1000-\u109F]/g, 'my'],
  [/[\u0D80-\u0DFF]/g, 'si'],
  [/[\u0400-\u04FF]/g, null], [/[\u0900-\u097F]/g, null], [/[\u1200-\u137F]/g, null],
  [/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g, null], // Latin: never guessed
];

/**
 * @returns {{ lang: string|null, source: 'metadata'|'script'|null }}
 */
export function detectLang(text, hint) {
  const meta = normLang(hint);
  if (meta) return { lang: meta, source: 'metadata' };
  const s = String(text || '').slice(0, 600);
  let total = 0;
  const counts = SCRIPTS.map(([re, lang]) => { const n = (s.match(re) || []).length; total += n; return [n, lang]; });
  if (total < 3) return { lang: null, source: null };
  const [n, script] = counts.reduce((a, b) => (b[0] > a[0] ? b : a));
  if (!script || n / total < 0.6) return { lang: null, source: null };
  if (script === 'arabic') {
    if (/[ٹڈڑںےۓھ]/.test(s)) return { lang: 'ur', source: 'script' }; // Urdu letters
    if (/[پچژگکی]/.test(s)) return { lang: 'fa', source: 'script' }; // Persian letters
    return { lang: 'ar', source: 'script' };
  }
  if (script === 'han') return { lang: /[\u3040-\u30FF]/.test(s) ? 'ja' : 'zh', source: 'script' };
  return { lang: script, source: 'script' };
}

/**
 * Which engine reads this language:
 *   'browser' — the device has a voice for exactly this language (free, instant; preferred)
 *   'cloud'   — no device voice, but the server's read-out model lists the language
 *   'signin'  — same as cloud, but the viewer must log in first (cloud audio costs money)
 *   null      — hide the read-out icon (never read Igbo with an English voice)
 */
export function chooseEngine(lang, { cloudEnabled = false, cloudLanguages = [], canUseCloud = false, browserLangs = [] } = {}) {
  const l = normLang(lang);
  if (!l) return null;
  if (browserLangs.map(normLang).includes(l)) return 'browser';
  if (cloudEnabled && cloudLanguages.map(normLang).includes(l)) return canUseCloud ? 'cloud' : 'signin';
  return null;
}
