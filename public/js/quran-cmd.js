// Qur'an in the command bar: "/quran" or "q" lists all 114 surahs (English + Arabic names);
// "q 18", "quran kahf", "surah yasin 5", "2:255", "الكهف" and bare names like "kahf" jump straight in.
// Pure matching (surahCommands) is unit-tested in Node; loadSurahs() fetches the list once.

const TRIGGER = /^(?:qur'?an|koran|quraan|q|surah?|surat|sura)(?:\s+|$)/;
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`ʿʾ]/g, '');
// "Al-Kahf" -> "kahf", "Ya-Sin" -> "yasin", "Ali 'Imran" -> "aliimran"
const key = (name) => fold(name).replace(/^(al|an|ar|as|at|ad|adh|ash|az)[-\s]/, '').replace(/[^a-z0-9]/g, '');
const keyFull = (name) => fold(name).replace(/[^a-z0-9]/g, '');
const arFold = (s) => String(s || '').replace(/[\u064B-\u065F\u0670\u06E1\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/^ال/, '').replace(/\s+/g, '');

/**
 * @param {string} q           what the user typed
 * @param {Array} surahs       [{ surah, name, nameAr, meaning, ayahs }]
 * @param {(path: string) => void} go
 * @returns command objects for the bar (empty when the text is not about the Qur'an)
 */
export function surahCommands(q, surahs, go) {
  if (!surahs || !surahs.length) return [];
  let t = fold(q).replace(/^\/+/, '').trim();
  const hasTrigger = TRIGGER.test(t);
  if (hasTrigger) t = t.replace(TRIGGER, '').trim();
  const isArabic = /[\u0600-\u06FF]/.test(q);
  let list = [], ayah = null;

  let m;
  if (hasTrigger && !t) list = surahs;
  else if ((m = t.match(/^(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3}))?$/)) && (hasTrigger || m[2])) {
    const s = surahs.find((x) => x.surah === Number(m[1]));
    if (s) { list = [s]; ayah = m[2] ? Number(m[2]) : null; }
  } else if (isArabic) {
    const a = arFold(q.replace(/^\/+/, '').trim());
    if (a.length >= 1) list = surahs.filter((s) => arFold(s.nameAr).startsWith(a) || (a.length > 2 && arFold(s.nameAr).includes(a)));
  } else if (t) {
    m = t.match(/^(.*?)(?:\s+(\d{1,3}))?$/);
    const word = m[1].replace(/[^a-z0-9]/g, '');
    if (m[2]) ayah = Number(m[2]);
    if (word.length >= (hasTrigger ? 1 : 3)) {
      const score = (s) => {
        const k = key(s.name), f = keyFull(s.name), mean = fold(s.meaning).replace(/[^a-z0-9]/g, '');
        if (k === word || f === word) return 5;
        if (k.startsWith(word) || f.startsWith(word)) return 4;
        if (word.length >= 4 && (k.includes(word) || f.includes(word))) return 3;
        if (hasTrigger && word.length >= 3 && mean.replace(/^the/, '').startsWith(word)) return 2; // "q cave" -> Al-Kahf
        return 0;
      };
      list = surahs.map((s) => [s, score(s)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].surah - b[0].surah).map(([s]) => s);
    }
  }
  if (!list.length) return [];
  if (ayah != null && list.length > 1) list = list.slice(0, 1);
  return list.map((s) => {
    const a = ayah && ayah >= 1 && ayah <= (s.ayahs || 999) ? ayah : null;
    return {
      id: `dyn-surah-${s.surah}`,
      label: `Surah ${s.surah} ${s.name} ${s.nameAr || ''}${a ? ` · ayah ${a}` : ''}`.trim(),
      short: `${s.name}${a ? ` ${a}` : ''} · ${s.nameAr || ''}`,
      tip: `${s.surah}. ${s.name} (${s.nameAr}) — ${s.meaning} · ${s.ayahs} ayahs`,
      glyph: String(s.surah),
      group: 'faith',
      run: () => go(`/books?corpus=quran&ref=${encodeURIComponent(a ? `${s.name} ${a}` : s.name)}`),
    };
  });
}

let cache = null, loading = null;
/** Surah list (sync, may be empty on first call); onReady fires once it arrives. */
export function loadSurahs(onReady) {
  if (cache) return cache;
  loading ||= fetch('/api/bible/books', { credentials: 'same-origin' }).then((r) => r.json())
    .then((b) => { cache = (b.books || []).filter((x) => x.surah); onReady && onReady(); })
    .catch(() => { loading = null; });
  return [];
}
export const looksLikeQuran = (q) => TRIGGER.test(fold(q).replace(/^\/+/, '').trim()) || /[\u0600-\u06FF]/.test(q) || /^\s*\d{1,3}\s*:\s*\d{1,3}\s*$/.test(q);
