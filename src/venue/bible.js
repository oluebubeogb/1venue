/**
 * Bibles from openly licensed translations, through the Free Use Bible API
 * (bible.helloao.org, which serves eBible.org texts). Chapters are cached in
 * PostgreSQL, so a sermon panel costs one upstream request per chapter per month.
 * Translations under copyright, such as GNT, NIV or NET, are deliberately excluded.
 */
const config = require('../config');

const PD = 'Public domain';
const BYSA = 'CC BY-SA 4.0 (attribution required, share-alike)';
const TRANSLATIONS = [
  { id: 'eng_kjv', short: 'KJV', name: 'King James Version', lang: 'en', language: 'English', license: PD },
  { id: 'ENGWEBP', short: 'WEB', name: 'World English Bible', lang: 'en', language: 'English', license: PD },
  { id: 'BSB', short: 'BSB', name: 'Berean Standard Bible', lang: 'en', language: 'English', license: PD },
  { id: 'eng_asv', short: 'ASV', name: 'American Standard Version (1901)', lang: 'en', language: 'English', license: PD },
  { id: 'eng_bbe', short: 'BBE', name: 'Bible in Basic English', lang: 'en', language: 'English', license: PD },
  { id: 'eng_ylt', short: 'YLT', name: "Young's Literal Translation", lang: 'en', language: 'English', license: PD },
  { id: 'eng_dby', short: 'DBY', name: 'Darby Translation', lang: 'en', language: 'English', license: PD },
  { id: 'eng_fbv', short: 'FBV', name: 'Free Bible Version', lang: 'en', language: 'English', license: BYSA },
  { id: 'eng_lsv', short: 'LSV', name: 'Literal Standard Version', lang: 'en', language: 'English', license: BYSA },
  { id: 'yor_bib', short: 'YOR', name: 'Bíbélì Mímọ́ (Yoruba Bible)', lang: 'yo', language: 'Yoruba', license: BYSA },
  { id: 'ibo_bib', short: 'IBO', name: 'Baịbụl Nsọ (Igbo Bible)', lang: 'ig', language: 'Igbo', license: BYSA },
  { id: 'hau_bib', short: 'HAU', name: 'Littafi Mai Tsarki (Hausa Contemporary)', lang: 'ha', language: 'Hausa', license: BYSA },
  { id: 'swh_bib', short: 'SWH', name: 'Kiswahili Contemporary Version', lang: 'sw', language: 'Swahili', license: BYSA },
  { id: 'fra_lsg', short: 'LSG', name: 'Louis Segond 1910', lang: 'fr', language: 'French', license: PD },
  { id: 'spa_r09', short: 'RV09', name: 'Reina-Valera 1909', lang: 'es', language: 'Spanish', license: PD },
  { id: 'por_bsl', short: 'BSL', name: 'Bíblia Livre (Portuguese)', lang: 'pt', language: 'Portuguese', license: PD },
  { id: 'deu_l12', short: 'L1912', name: 'Luther Bibel 1912', lang: 'de', language: 'German', license: PD },
  { id: 'arb_vdv', short: 'SVD', name: 'Van Dyck (Arabic)', lang: 'ar', language: 'Arabic', license: PD, rtl: true },
];
const BY_ID = new Map(TRANSLATIONS.map((t) => [t.id.toLowerCase(), t]));
const BY_SHORT = new Map(TRANSLATIONS.map((t) => [t.short.toLowerCase(), t]));
function resolveTranslation(id) {
  const k = String(id || '').toLowerCase();
  return BY_ID.get(k) || BY_SHORT.get(k) || BY_ID.get(config.BIBLE.defaultTranslation.toLowerCase()) || TRANSLATIONS[0];
}

// USFM book ids, English names and chapter counts
const BOOKS = [
  ['GEN', 'Genesis', 50], ['EXO', 'Exodus', 40], ['LEV', 'Leviticus', 27], ['NUM', 'Numbers', 36], ['DEU', 'Deuteronomy', 34],
  ['JOS', 'Joshua', 24], ['JDG', 'Judges', 21], ['RUT', 'Ruth', 4], ['1SA', '1 Samuel', 31], ['2SA', '2 Samuel', 24],
  ['1KI', '1 Kings', 22], ['2KI', '2 Kings', 25], ['1CH', '1 Chronicles', 29], ['2CH', '2 Chronicles', 36], ['EZR', 'Ezra', 10],
  ['NEH', 'Nehemiah', 13], ['EST', 'Esther', 10], ['JOB', 'Job', 42], ['PSA', 'Psalms', 150], ['PRO', 'Proverbs', 31],
  ['ECC', 'Ecclesiastes', 12], ['SNG', 'Song of Songs', 8], ['ISA', 'Isaiah', 66], ['JER', 'Jeremiah', 52], ['LAM', 'Lamentations', 5],
  ['EZK', 'Ezekiel', 48], ['DAN', 'Daniel', 12], ['HOS', 'Hosea', 14], ['JOL', 'Joel', 3], ['AMO', 'Amos', 9],
  ['OBA', 'Obadiah', 1], ['JON', 'Jonah', 4], ['MIC', 'Micah', 7], ['NAM', 'Nahum', 3], ['HAB', 'Habakkuk', 3],
  ['ZEP', 'Zephaniah', 3], ['HAG', 'Haggai', 2], ['ZEC', 'Zechariah', 14], ['MAL', 'Malachi', 4],
  ['MAT', 'Matthew', 28], ['MRK', 'Mark', 16], ['LUK', 'Luke', 24], ['JHN', 'John', 21], ['ACT', 'Acts', 28],
  ['ROM', 'Romans', 16], ['1CO', '1 Corinthians', 16], ['2CO', '2 Corinthians', 13], ['GAL', 'Galatians', 6], ['EPH', 'Ephesians', 6],
  ['PHP', 'Philippians', 4], ['COL', 'Colossians', 4], ['1TH', '1 Thessalonians', 5], ['2TH', '2 Thessalonians', 3], ['1TI', '1 Timothy', 6],
  ['2TI', '2 Timothy', 4], ['TIT', 'Titus', 3], ['PHM', 'Philemon', 1], ['HEB', 'Hebrews', 13], ['JAS', 'James', 5],
  ['1PE', '1 Peter', 5], ['2PE', '2 Peter', 3], ['1JN', '1 John', 5], ['2JN', '2 John', 1], ['3JN', '3 John', 1],
  ['JUD', 'Jude', 1], ['REV', 'Revelation', 22],
].map(([id, name, chapters], i) => ({ id, name, chapters, testament: i < 39 ? 'OT' : 'NT' }));
const ALIASES = { psalm: 'PSA', ps: 'PSA', pss: 'PSA', song: 'SNG', songofsolomon: 'SNG', canticles: 'SNG', jn: 'JHN', joh: 'JHN', mt: 'MAT', mk: 'MRK', lk: 'LUK', ac: 'ACT', rev: 'REV', revelations: 'REV', phil: 'PHP', philippians: 'PHP', phm: 'PHM', philemon: 'PHM', jas: 'JAS', jude: 'JUD', ezek: 'EZK', eze: 'EZK', judg: 'JDG', jdg: 'JDG', prov: 'PRO', eccl: 'ECC', qoheleth: 'ECC', obad: 'OBA', zeph: 'ZEP', zech: 'ZEC', hab: 'HAB', nah: 'NAM', joel: 'JOL', mic: 'MIC', lam: 'LAM', deut: 'DEU', dt: 'DEU', num: 'NUM', lev: 'LEV', ex: 'EXO', exod: 'EXO', gen: 'GEN', gn: 'GEN', josh: 'JOS', rom: 'ROM', gal: 'GAL', eph: 'EPH', col: 'COL', heb: 'HEB', tit: 'TIT', mat: 'MAT', matt: 'MAT', mark: 'MRK', luke: 'LUK', john: 'JHN', acts: 'ACT', isa: 'ISA', jer: 'JER', dan: 'DAN', hos: 'HOS', amos: 'AMO', jonah: 'JON', mal: 'MAL', hag: 'HAG', neh: 'NEH', est: 'EST', ezr: 'EZR', job: 'JOB', ruth: 'RUT' };
function findBook(raw) {
  let s = String(raw || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(first|i)\s+/, '1 ').replace(/^(second|ii)\s+/, '2 ').replace(/^(third|iii)\s+/, '3 ');
  const compact = s.replace(/\s/g, '');
  const num = (compact.match(/^[123]/) || [''])[0];
  const rest = compact.slice(num.length);
  if (ALIASES[compact]) return BOOKS.find((b) => b.id === ALIASES[compact]);
  const exact = BOOKS.find((b) => b.id.toLowerCase() === compact || b.name.toLowerCase().replace(/\s/g, '') === compact);
  if (exact) return exact;
  if (rest.length >= 2) {
    const cands = BOOKS.filter((b) => {
      const bn = b.name.toLowerCase().replace(/\s/g, '');
      return (num ? bn.startsWith(num) : !/^[123]/.test(bn)) && bn.slice(num.length).startsWith(rest);
    });
    if (cands.length) return cands[0];
    if (!num && ALIASES[rest]) return BOOKS.find((b) => b.id === ALIASES[rest]);
  }
  return null;
}
/** Parse "John 3:16-18", "1 Cor 13", "Ps 23:1,4", "Romans 8:28–39". */
function parseReference(ref) {
  const m = String(ref || '').trim().match(/^((?:[123]|i{1,3}|first|second|third)?\s*[a-zA-Z][a-zA-Z .]*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?((?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*))?\s*$/i);
  if (!m) return null;
  const book = findBook(m[1]);
  if (!book) return null;
  const chapter = parseInt(m[2], 10);
  if (chapter < 1 || chapter > book.chapters) return null;
  let verses = null;
  if (m[3]) {
    verses = [];
    const add = (a, b) => { for (let v = a; v <= (b || a) && verses.length < 200; v++) verses.push(v); };
    add(parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : null);
    for (const part of (m[5] || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = part.split(/[-–]/).map((x) => parseInt(x, 10));
      add(a, b);
    }
  }
  return { book: book.id, bookName: book.name, chapter, verses };
}

function flatten(content) {
  return (content || []).map((c) => (typeof c === 'string' ? c : c && c.text ? c.text : c && c.lineBreak ? '\n' : '')).join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(`Bible source HTTP ${r.status}`); e.status = r.status === 404 ? 404 : 502; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

const mem = new Map(); // tiny LRU in front of PG
function memGet(k) { const v = mem.get(k); if (v) { mem.delete(k); mem.set(k, v); } return v; }
function memSet(k, v) { mem.set(k, v); if (mem.size > 200) mem.delete(mem.keys().next().value); }

async function chapter(translationId, bookId, ch) {
  const t = resolveTranslation(translationId);
  const book = BOOKS.find((b) => b.id === String(bookId).toUpperCase()) || findBook(bookId);
  if (!book) { const e = new Error('Unknown book'); e.status = 400; throw e; }
  const c = Math.max(1, Math.min(book.chapters, parseInt(ch, 10) || 1));
  const key = `${t.id}|${book.id}|${c}`;
  const hit = memGet(key);
  if (hit) return hit;
  const data = require('./data');
  let payload = await data.bibleCacheGet(t.id, book.id, c, config.BIBLE.cacheDays).catch(() => null);
  if (!payload) {
    try {
      const j = await fetchJSON(`${config.BIBLE.apiBase}/${encodeURIComponent(t.id)}/${book.id}/${c}.json`);
      const verses = (j.chapter?.content || []).filter((x) => x.type === 'verse').map((v) => ({ v: v.number, text: flatten(v.content) }));
      const headings = (j.chapter?.content || []).filter((x) => x.type === 'heading').map((h) => flatten(h.content));
      payload = { translation: t.id, book: book.id, bookName: j.book?.name || book.name, chapter: c, verses, headings, source: 'helloao' };
    } catch (e) {
      if (!config.BIBLE.fallbackBase || !/^(eng_kjv|ENGWEBP|eng_web|eng_asv|eng_bbe|eng_ylt|eng_dby)$/i.test(t.id)) throw e;
      // bible-api.com fallback (public-domain English only)
      const map = { eng_kjv: 'kjv', ENGWEBP: 'web', eng_web: 'web', eng_asv: 'asv', eng_bbe: 'bbe', eng_ylt: 'ylt', eng_dby: 'darby' };
      const j = await fetchJSON(`${config.BIBLE.fallbackBase}/${encodeURIComponent(book.name + ' ' + c)}?translation=${map[t.id] || 'kjv'}`);
      payload = { translation: t.id, book: book.id, bookName: book.name, chapter: c, verses: (j.verses || []).map((v) => ({ v: v.verse, text: String(v.text).replace(/\s+/g, ' ').trim() })), headings: [], source: 'bible-api.com' };
    }
    if (payload.verses.length) await data.bibleCachePut(t.id, book.id, c, payload).catch(() => {});
  }
  const out = { ...payload, translationInfo: t, chapters: book.chapters };
  memSet(key, out);
  return out;
}

async function passage(ref, translationId) {
  const p = parseReference(ref);
  if (!p) { const e = new Error('Could not read that reference. Try "John 3:16" or "Psalm 23".'); e.status = 400; throw e; }
  const ch = await chapter(translationId, p.book, p.chapter);
  const verses = p.verses ? ch.verses.filter((v) => p.verses.includes(v.v)) : ch.verses;
  const label = `${ch.bookName} ${p.chapter}${p.verses ? ':' + compressVerses(p.verses) : ''}`;
  return { reference: label, book: p.book, bookName: ch.bookName, chapter: p.chapter, verses, selected: p.verses, translation: ch.translationInfo, chapters: ch.chapters };
}
function compressVerses(vs) {
  const out = []; let s = vs[0], prev = vs[0];
  for (const v of vs.slice(1).concat([null])) {
    if (v === prev + 1) { prev = v; continue; }
    out.push(s === prev ? `${s}` : `${s}-${prev}`); s = prev = v;
  }
  return out.join(',');
}

module.exports = { TRANSLATIONS, BOOKS, resolveTranslation, parseReference, findBook, chapter, passage };
