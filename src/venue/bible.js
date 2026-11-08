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
  { id: 'eng_webc', short: 'WEBc', name: 'World English Bible (Catholic)', lang: 'en', language: 'English', license: PD, deuterocanon: true },
  { id: 'eng_dra', short: 'DRA', name: 'Douay-Rheims 1899 (Catholic)', lang: 'en', language: 'English', license: PD, deuterocanon: true },
  { id: 'eng_kja', short: 'KJVA', name: 'King James Version + Apocrypha', lang: 'en', language: 'English', license: PD, deuterocanon: true },
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
  // Qur’an (via Al Quran Cloud — free, no key)
  { id: 'quran_en_sahih', short: 'Sahih', name: 'Qur’an — Sahih International', lang: 'en', language: 'English', license: 'Translation © Saheeh International', corpus: 'quran' },
  { id: 'quran_en_pickthall', short: 'Pickthall', name: 'Qur’an — Mohammed Marmaduke Pickthall', lang: 'en', language: 'English', license: PD, corpus: 'quran' },
  { id: 'quran_en_yusufali', short: 'Yusuf Ali', name: 'Qur’an — Abdullah Yusuf Ali', lang: 'en', language: 'English', license: PD, corpus: 'quran' },
  { id: 'quran_ar_uthmani', short: 'Uthmani', name: 'Qur’an — Arabic (Uthmani)', lang: 'ar', language: 'Arabic', license: PD, corpus: 'quran', rtl: true },
];
const BY_ID = new Map(TRANSLATIONS.map((t) => [t.id.toLowerCase(), t]));
const BY_SHORT = new Map(TRANSLATIONS.map((t) => [t.short.toLowerCase(), t]));
function resolveTranslation(id) {
  const k = String(id || '').toLowerCase();
  return BY_ID.get(k) || BY_SHORT.get(k) || BY_ID.get(config.BIBLE.defaultTranslation.toLowerCase()) || TRANSLATIONS[0];
}

// USFM book ids, English names and chapter counts
const CANON_BOOKS = [
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

// Catholic / Orthodox deuterocanonical books (available in eng_webc, eng_dra, eng_kja, …)
const DEUTERO_BOOKS = [
  ['TOB', 'Tobit', 14], ['JDT', 'Judith', 16], ['ESG', 'Esther (Greek)', 10],
  ['WIS', 'Wisdom of Solomon', 19], ['SIR', 'Sirach', 51], ['BAR', 'Baruch', 6],
  ['1MA', '1 Maccabees', 16], ['2MA', '2 Maccabees', 15], ['DAG', 'Daniel (Greek)', 14],
].map(([id, name, chapters]) => ({ id, name, chapters, testament: 'DC' }));

// Qur’an — 114 surahs: [number, Arabic name, ayah count, English meaning]
const QURAN_SURAHS = [
  [1, 'Al-Fatihah', 7, 'The Opener'], [2, 'Al-Baqarah', 286, 'The Cow'], [3, 'Ali \'Imran', 200, 'Family of Imran'],
  [4, 'An-Nisa', 176, 'The Women'], [5, 'Al-Ma\'idah', 120, 'The Table Spread'], [6, 'Al-An\'am', 165, 'The Cattle'],
  [7, 'Al-A\'raf', 206, 'The Heights'], [8, 'Al-Anfal', 75, 'The Spoils of War'], [9, 'At-Tawbah', 129, 'The Repentance'],
  [10, 'Yunus', 109, 'Jonah'], [11, 'Hud', 123, 'Hud'], [12, 'Yusuf', 111, 'Joseph'],
  [13, 'Ar-Ra\'d', 43, 'The Thunder'], [14, 'Ibrahim', 52, 'Abraham'], [15, 'Al-Hijr', 99, 'The Rocky Tract'],
  [16, 'An-Nahl', 128, 'The Bee'], [17, 'Al-Isra', 111, 'The Night Journey'], [18, 'Al-Kahf', 110, 'The Cave'],
  [19, 'Maryam', 98, 'Mary'], [20, 'Ta-Ha', 135, 'Ta-Ha'], [21, 'Al-Anbiya', 112, 'The Prophets'],
  [22, 'Al-Hajj', 78, 'The Pilgrimage'], [23, 'Al-Mu\'minun', 118, 'The Believers'], [24, 'An-Nur', 64, 'The Light'],
  [25, 'Al-Furqan', 77, 'The Criterion'], [26, 'Ash-Shu\'ara', 227, 'The Poets'], [27, 'An-Naml', 93, 'The Ant'],
  [28, 'Al-Qasas', 88, 'The Stories'], [29, 'Al-\'Ankabut', 69, 'The Spider'], [30, 'Ar-Rum', 60, 'The Romans'],
  [31, 'Luqman', 34, 'Luqman'], [32, 'As-Sajdah', 30, 'The Prostration'], [33, 'Al-Ahzab', 73, 'The Combined Forces'],
  [34, 'Saba', 54, 'Sheba'], [35, 'Fatir', 45, 'The Originator'], [36, 'Ya-Sin', 83, 'Ya-Sin'],
  [37, 'As-Saffat', 182, 'Those Who Set The Ranks'], [38, 'Sad', 88, 'Sad'], [39, 'Az-Zumar', 75, 'The Troops'],
  [40, 'Ghafir', 85, 'The Forgiver'], [41, 'Fussilat', 54, 'Explained in Detail'], [42, 'Ash-Shura', 53, 'The Consultation'],
  [43, 'Az-Zukhruf', 89, 'The Ornaments of Gold'], [44, 'Ad-Dukhan', 59, 'The Smoke'], [45, 'Al-Jathiyah', 37, 'The Crouching'],
  [46, 'Al-Ahqaf', 35, 'The Wind-Curved Sandhills'], [47, 'Muhammad', 38, 'Muhammad'], [48, 'Al-Fath', 29, 'The Victory'],
  [49, 'Al-Hujurat', 18, 'The Rooms'], [50, 'Qaf', 45, 'Qaf'], [51, 'Adh-Dhariyat', 60, 'The Winnowing Winds'],
  [52, 'At-Tur', 49, 'The Mount'], [53, 'An-Najm', 62, 'The Star'], [54, 'Al-Qamar', 55, 'The Moon'],
  [55, 'Ar-Rahman', 78, 'The Beneficent'], [56, 'Al-Waqi\'ah', 96, 'The Inevitable'], [57, 'Al-Hadid', 29, 'The Iron'],
  [58, 'Al-Mujadila', 22, 'The Pleading Woman'], [59, 'Al-Hashr', 24, 'The Exile'], [60, 'Al-Mumtahanah', 13, 'She That Is To Be Examined'],
  [61, 'As-Saff', 14, 'The Ranks'], [62, 'Al-Jumu\'ah', 11, 'The Congregation'], [63, 'Al-Munafiqun', 11, 'The Hypocrites'],
  [64, 'At-Taghabun', 18, 'The Mutual Disillusion'], [65, 'At-Talaq', 12, 'The Divorce'], [66, 'At-Tahrim', 12, 'The Prohibition'],
  [67, 'Al-Mulk', 30, 'The Sovereignty'], [68, 'Al-Qalam', 52, 'The Pen'], [69, 'Al-Haqqah', 52, 'The Reality'],
  [70, 'Al-Ma\'arij', 44, 'The Ascending Stairways'], [71, 'Nuh', 28, 'Noah'], [72, 'Al-Jinn', 28, 'The Jinn'],
  [73, 'Al-Muzzammil', 20, 'The Enshrouded One'], [74, 'Al-Muddaththir', 56, 'The Cloaked One'], [75, 'Al-Qiyamah', 40, 'The Resurrection'],
  [76, 'Al-Insan', 31, 'The Man'], [77, 'Al-Mursalat', 50, 'The Emissaries'], [78, 'An-Naba', 40, 'The Tidings'],
  [79, 'An-Nazi\'at', 46, 'Those Who Drag Forth'], [80, '\'Abasa', 42, 'He Frowned'], [81, 'At-Takwir', 29, 'The Overthrowing'],
  [82, 'Al-Infitar', 19, 'The Cleaving'], [83, 'Al-Mutaffifin', 36, 'The Defrauding'], [84, 'Al-Inshiqaq', 25, 'The Sundering'],
  [85, 'Al-Buruj', 22, 'The Mansions of the Stars'], [86, 'At-Tariq', 17, 'The Morning Star'], [87, 'Al-A\'la', 19, 'The Most High'],
  [88, 'Al-Ghashiyah', 26, 'The Overwhelming'], [89, 'Al-Fajr', 30, 'The Dawn'], [90, 'Al-Balad', 20, 'The City'],
  [91, 'Ash-Shams', 15, 'The Sun'], [92, 'Al-Layl', 21, 'The Night'], [93, 'Ad-Duha', 11, 'The Morning Hours'],
  [94, 'Ash-Sharh', 8, 'The Relief'], [95, 'At-Tin', 8, 'The Fig'], [96, 'Al-\'Alaq', 19, 'The Clot'],
  [97, 'Al-Qadr', 5, 'The Power'], [98, 'Al-Bayyinah', 8, 'The Clear Proof'], [99, 'Az-Zalzalah', 8, 'The Earthquake'],
  [100, 'Al-\'Adiyat', 11, 'The Courser'], [101, 'Al-Qari\'ah', 11, 'The Calamity'], [102, 'At-Takathur', 8, 'The Rivalry in World Increase'],
  [103, 'Al-\'Asr', 3, 'The Declining Day'], [104, 'Al-Humazah', 9, 'The Traducer'], [105, 'Al-Fil', 5, 'The Elephant'],
  [106, 'Quraysh', 4, 'Quraysh'], [107, 'Al-Ma\'un', 7, 'The Small Kindnesses'], [108, 'Al-Kawthar', 3, 'The Abundance'],
  [109, 'Al-Kafirun', 6, 'The Disbelievers'], [110, 'An-Nasr', 3, 'The Divine Support'], [111, 'Al-Masad', 5, 'The Palm Fiber'],
  [112, 'Al-Ikhlas', 4, 'The Sincerity'], [113, 'Al-Falaq', 5, 'The Daybreak'], [114, 'An-Nas', 6, 'Mankind'],
].map(([n, name, ayahs, meaning]) => ({
  id: `Q${String(n).padStart(3, '0')}`,
  name,
  meaning,
  chapters: 1, // API shape: one chapter per surah; ayahs are the verses
  ayahs,
  surah: n,
  testament: 'Quran',
}));

const BOOKS = [...CANON_BOOKS, ...DEUTERO_BOOKS, ...QURAN_SURAHS];

const ALIASES = {
  psalm: 'PSA', ps: 'PSA', pss: 'PSA', song: 'SNG', songofsolomon: 'SNG', canticles: 'SNG',
  jn: 'JHN', joh: 'JHN', mt: 'MAT', mk: 'MRK', lk: 'LUK', ac: 'ACT', rev: 'REV', revelations: 'REV',
  phil: 'PHP', philippians: 'PHP', phm: 'PHM', philemon: 'PHM', jas: 'JAS', jude: 'JUD',
  ezek: 'EZK', eze: 'EZK', judg: 'JDG', jdg: 'JDG', prov: 'PRO', eccl: 'ECC', qoheleth: 'ECC',
  obad: 'OBA', zeph: 'ZEP', zech: 'ZEC', hab: 'HAB', nah: 'NAM', joel: 'JOL', mic: 'MIC', lam: 'LAM',
  deut: 'DEU', dt: 'DEU', num: 'NUM', lev: 'LEV', ex: 'EXO', exod: 'EXO', gen: 'GEN', gn: 'GEN',
  josh: 'JOS', rom: 'ROM', gal: 'GAL', eph: 'EPH', col: 'COL', heb: 'HEB', tit: 'TIT',
  mat: 'MAT', matt: 'MAT', mark: 'MRK', luke: 'LUK', john: 'JHN', acts: 'ACT', isa: 'ISA', jer: 'JER',
  dan: 'DAN', hos: 'HOS', amos: 'AMO', jonah: 'JON', mal: 'MAL', hag: 'HAG', neh: 'NEH', est: 'EST',
  ezr: 'EZR', job: 'JOB', ruth: 'RUT',
  // Deuterocanon
  tobit: 'TOB', tob: 'TOB', judith: 'JDT', jdt: 'JDT', wisdom: 'WIS', wis: 'WIS', wisdomofsolomon: 'WIS',
  sirach: 'SIR', sir: 'SIR', ecclesiasticus: 'SIR', baruch: 'BAR', bar: 'BAR',
  '1maccabees': '1MA', '1macc': '1MA', '2maccabees': '2MA', '2macc': '2MA',
  // Qur’an common aliases (normalized keys without hyphens/spaces also matched in findBook)
  fatihah: 'Q001', alfatihah: 'Q001', 'al-fatihah': 'Q001',
  baqarah: 'Q002', albaqarah: 'Q002', 'al-baqarah': 'Q002',
  baqara: 'Q002', albaqara: 'Q002', 'al-baqara': 'Q002',
  imran: 'Q003', aliimran: 'Q003', alimran: 'Q003',
  nisa: 'Q004', annisa: 'Q004',
  ikhlas: 'Q112', alikhlas: 'Q112', 'al-ikhlas': 'Q112',
  falaq: 'Q113', alfalaq: 'Q113', 'al-falaq': 'Q113',
  nas: 'Q114', annas: 'Q114', 'an-nas': 'Q114',
  yasin: 'Q036', 'ya-sin': 'Q036', mulk: 'Q067', almulk: 'Q067',
  kahf: 'Q018', alkahf: 'Q018', 'al-kahf': 'Q018',
  maryam: 'Q019', rahman: 'Q055', arrahman: 'Q055',
  zumar: 'Q039', azzumar: 'Q039', hijr: 'Q015', alhijr: 'Q015',
  shura: 'Q042', ashshura: 'Q042', talaq: 'Q065', attalaq: 'Q065',
  sharh: 'Q094', ashsharh: 'Q094', inshirah: 'Q094',
};
function normBookKey(s) {
  return String(s || '').toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[-–—_./]/g, '')
    .replace(/\s+/g, '')
    .trim();
}
function findBook(raw) {
  let s = String(raw || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(first|i)\s+/, '1 ').replace(/^(second|ii)\s+/, '2 ').replace(/^(third|iii)\s+/, '3 ');
  // Strip leading "surah/sura/al " for Qur’an lookups
  s = s.replace(/^(surah|sura|soorah)\s+/i, '');
  const compact = s.replace(/\s/g, '');
  const key = normBookKey(s);
  const num = (compact.match(/^[123]/) || [''])[0];
  const rest = compact.slice(num.length);
  if (ALIASES[compact]) return BOOKS.find((b) => b.id === ALIASES[compact]);
  if (ALIASES[key]) return BOOKS.find((b) => b.id === ALIASES[key]);
  // Exact id / name (ignore spaces, hyphens, apostrophes)
  const exact = BOOKS.find((b) => {
    const id = b.id.toLowerCase();
    const nm = normBookKey(b.name);
    return id === compact || id === key || nm === compact || nm === key
      || normBookKey(b.name.replace(/^al[- ]?/i, '')) === key.replace(/^al/, '');
  });
  if (exact) return exact;
  // Qur’an: "112" or "Q112"
  const qn = key.match(/^q?0*(\d{1,3})$/);
  if (qn) {
    const n = parseInt(qn[1], 10);
    if (n >= 1 && n <= 114) return BOOKS.find((b) => b.surah === n);
  }
  if (rest.length >= 2) {
    const cands = BOOKS.filter((b) => {
      const bn = normBookKey(b.name);
      const r = normBookKey(rest);
      return (num ? bn.startsWith(num) : !/^[123]/.test(bn)) && (bn.slice(num.length).startsWith(r) || bn.includes(r));
    });
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      // Prefer shortest name match (e.g. "John" → JHN not 1JN)
      cands.sort((a, b) => a.name.length - b.name.length);
      return cands[0];
    }
    if (!num && ALIASES[rest]) return BOOKS.find((b) => b.id === ALIASES[rest]);
  }
  return null;
}
/** Parse "John 3:16-18", "1 Cor 13", "Al-Ikhlas 1", "Surah Al-Baqarah 1:255". */
function parseReference(ref) {
  const raw = String(ref || '').trim();
  // Allow hyphens / apostrophes in book names (Al-Ikhlas, Ali 'Imran, Song of Songs)
  // Chapter form: "John 3:16-18" OR range without colon "Al-Baqara 2-195" / "Psalm 23"
  const m = raw.match(/^((?:[123]|i{1,3}|first|second|third)?\s*[a-zA-Z][a-zA-Z0-9 .'\-’]*?)\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?((?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*))?$/i)
    || raw.match(/^((?:[123]|i{1,3}|first|second|third)?\s*[a-zA-Z][a-zA-Z0-9 .'\-’]*?)\s+(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/i);
  if (!m) {
    // Bare surah name with no chapter (e.g. "Al-Ikhlas") → whole surah chapter 1
    const only = findBook(raw);
    if (only && only.testament === 'Quran') return { book: only.id, bookName: only.name, chapter: 1, verses: null };
    return null;
  }
  const book = findBook(m[1]);
  if (!book) return null;
  let chapter = parseInt(m[2], 10);
  let verses = null;
  const addRange = (a, b) => {
    if (!verses) verses = [];
    for (let v = a; v <= (b || a) && verses.length < 200; v++) verses.push(v);
  };
  // Qur’an surahs are one chapter each. "Az-Zumar 53" / "Al-Baqarah 255" mean ayahs.
  if (book.testament === 'Quran') {
    if (m[3]) {
      const a = chapter;
      const b = parseInt(m[3], 10);
      // "Al-Baqarah 1:255" → ayah 255; "Al-Baqara 2-195" (surah:ayah miswritten) → ayah 195
      if (a === 1 && book.surah) {
        addRange(b, m[4] ? parseInt(m[4], 10) : b);
        for (const part of (m[5] || '').split(',').map((x) => x.trim()).filter(Boolean)) {
          const [x, y] = part.split(/[-–]/).map((n) => parseInt(n, 10));
          addRange(x, y);
        }
      } else if (book.surah && a === book.surah && b > a) {
        addRange(b, b);
      } else if (a > 1) {
        addRange(Math.min(a, b), Math.max(a, b));
      } else {
        addRange(b, m[4] ? parseInt(m[4], 10) : b);
      }
      chapter = 1;
    } else if (chapter > 1 || (book.ayahs && chapter <= book.ayahs && chapter !== 1)) {
      // "Az-Zumar 53" → ayah 53; bare "Al-Fatihah 1" opens whole surah
      addRange(chapter, chapter);
      chapter = 1;
    } else {
      chapter = 1; // full surah
    }
    // "Al-Fatihah 1-7" or mistaken "Al-Baqarah 2-195" (AI wrote surah:ayah with a hyphen)
    const dash = raw.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/);
    if (dash && !m[3]) {
      const a = parseInt(dash[1], 10);
      const b = parseInt(dash[2], 10);
      verses = [];
      // Start equals surah number + wide span → treat as single ayah b (e.g. 2-195 → ayah 195)
      if (book.surah && a === book.surah && b > a && (b - a > 15 || b > (book.ayahs || 999))) {
        addRange(b, b);
      } else {
        addRange(Math.min(a, b), Math.max(a, b));
      }
      chapter = 1;
    }
    return { book: book.id, bookName: book.name, chapter: 1, verses };
  }
  if (chapter < 1 || chapter > book.chapters) return null;
  if (m[3]) {
    addRange(parseInt(m[3], 10), m[4] ? parseInt(m[4], 10) : null);
    for (const part of (m[5] || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const [a, b] = part.split(/[-–]/).map((x) => parseInt(x, 10));
      addRange(a, b);
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

const QURAN_EDITION = {
  quran_en_sahih: 'en.sahih',
  quran_en_pickthall: 'en.pickthall',
  quran_en_yusufali: 'en.yusufali',
  quran_ar_uthmani: 'quran-uthmani',
};

async function chapterQuran(t, book, c) {
  const edition = QURAN_EDITION[t.id] || 'en.sahih';
  const surah = book.surah || parseInt(String(book.id).replace(/^Q0*/, ''), 10);
  if (!surah || surah < 1 || surah > 114) { const e = new Error('Unknown surah'); e.status = 400; throw e; }
  const j = await fetchJSON(`https://api.alquran.cloud/v1/surah/${surah}/${edition}`);
  const data = j.data || j;
  const verses = (data.ayahs || []).map((a) => ({
    v: a.numberInSurah || a.number,
    text: String(a.text || '').replace(/\s+/g, ' ').trim(),
  }));
  const meaning = data.englishNameTranslation || book.meaning || '';
  return {
    translation: t.id,
    book: book.id,
    bookName: data.englishName || book.name,
    chapter: 1,
    surah: surah,
    meaning,
    verses,
    headings: meaning ? [meaning] : [],
    source: 'alquran.cloud',
    translationInfo: t,
    chapters: 1,
  };
}

async function chapter(translationId, bookId, ch) {
  const t = resolveTranslation(translationId);
  const book = BOOKS.find((b) => b.id === String(bookId).toUpperCase()) || findBook(bookId);
  if (!book) { const e = new Error('Unknown book'); e.status = 400; throw e; }
  const isQuranBook = book.testament === 'Quran';
  const isQuranTr = t.corpus === 'quran';

  // Keep Bible and Qur’an fully isolated — never mix translation corpus with the other library
  if (isQuranTr && !isQuranBook) {
    const e = new Error('That reference is not a Qur’an surah. Switch to a Bible translation, or open the Bible reader.');
    e.status = 400; throw e;
  }
  if (!isQuranTr && isQuranBook) {
    const e = new Error('That reference is a Qur’an surah. Switch to a Qur’an edition, or open the Qur’an reader.');
    e.status = 400; throw e;
  }

  const c = Math.max(1, Math.min(book.chapters, parseInt(ch, 10) || 1));
  const key = `${t.id}|${book.id}|${c}`;
  const hit = memGet(key);
  if (hit) return hit;

  // Qur’an editions use a different upstream
  if (isQuranTr) {
    const out = await chapterQuran(t, book, c);
    memSet(key, out);
    return out;
  }

  // Deuterocanonical books only in editions that include them
  if (book.testament === 'DC' && !t.deuterocanon) {
    const e = new Error(`“${book.name}” is in the deuterocanon. Switch to WEBc, DRA, or KJVA.`);
    e.status = 400; throw e;
  }

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
  const isQuran = ch.surah || (p.book && String(p.book).startsWith('Q'));
  // Qur’an: "Al-Fatihah" or "Al-Fatihah 1-3" (ayahs), never "Al-Fatihah 1" as a chapter
  let label;
  if (isQuran) {
    label = ch.bookName + (p.verses ? ` ${compressVerses(p.verses)}` : '');
  } else {
    label = `${ch.bookName} ${p.chapter}${p.verses ? ':' + compressVerses(p.verses) : ''}`;
  }
  return {
    reference: label,
    book: p.book,
    bookName: ch.bookName,
    chapter: p.chapter,
    surah: ch.surah || null,
    meaning: ch.meaning || null,
    verses,
    selected: p.verses,
    translation: ch.translationInfo,
    chapters: ch.chapters,
  };
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
