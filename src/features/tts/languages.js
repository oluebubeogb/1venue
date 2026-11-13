/**
 * Languages documented for Gemini 3.8 Flash TTS (the model behind google/gemini-3.8-flash-tts on
 * Replicate). Source: Google's list linked from the Replicate model page,
 * https://ai.google.dev/gemini-api/docs/speech-generation#languages (checked 2026-11-13,
 * "Gemini 3.8 Flash TTS" column: 132 entries).
 *
 * The model has no language input: it detects the language from the text. This list is only
 * used to decide whether 1venue offers a read-out at all, so we never send, say, Yorùbá text to a
 * model that does not list it (it would sound like badly read English).
 *
 * Codes are BCP-47 primary subtags (ISO 639-1 where one exists, otherwise ISO 639-3). Matching
 * uses the primary subtag of the content's language tag, so "ar-EG" and "ar" both match "ar".
 * Override the whole list with TTS_LANGUAGES=en,ar,ha,ig (comma separated).
 */
const DOCUMENTED = [
  ['ace', 'Acehnese (Arab script)'], ['af', 'Afrikaans'], ['ak', 'Akan'], ['am', 'Amharic'], ['hy', 'Armenian'],
  ['as', 'Assamese'], ['awa', 'Awadhi'], ['ban', 'Balinese'], ['bn', 'Bangla'], ['bjn', 'Banjar (Arab and Latn script)'],
  ['ba', 'Bashkir'], ['eu', 'Basque'], ['be', 'Belarusian'], ['bem', 'Bemba'], ['bho', 'Bhojpuri'], ['bs', 'Bosnian'],
  ['bug', 'Buginese'], ['bg', 'Bulgarian'], ['my', 'Burmese'], ['yue', 'Cantonese'], ['ca', 'Catalan'], ['ceb', 'Cebuano'],
  ['ckb', 'Central Kurdish'], ['hne', 'Chhattisgarhi'], ['zh', 'Chinese (Hans and Hant script)'], ['crh', 'Crimean Tatar'],
  ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['dyu', 'Dyula'], ['dz', 'Dzongkha'],
  ['arz', 'Egyptian Arabic'], ['en', 'English'], ['et', 'Estonian'], ['fil', 'Filipino'], ['fi', 'Finnish'], ['fr', 'French'],
  ['gl', 'Galician'], ['lg', 'Ganda'], ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gn', 'Guarani'],
  ['gu', 'Gujarati'], ['ht', 'Haitian Creole'], ['mn', 'Halh Mongolian'], ['ha', 'Hausa'], ['he', 'Hebrew'], ['hi', 'Hindi'],
  ['hu', 'Hungarian'], ['is', 'Icelandic'], ['ig', 'Igbo'], ['ilo', 'Iloko'], ['id', 'Indonesian'], ['fa', 'Iranian Persian'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['jv', 'Javanese'], ['kab', 'Kabyle'], ['kam', 'Kamba'], ['kn', 'Kannada'],
  ['ks', 'Kashmiri (Arab and Deva script)'], ['kk', 'Kazakh'], ['km', 'Khmer'], ['ki', 'Kikuyu'], ['rw', 'Kinyarwanda'],
  ['kg', 'Kongo'], ['ko', 'Korean'], ['ky', 'Kyrgyz'], ['lo', 'Lao'], ['ltg', 'Latgalian'], ['ln', 'Lingala'],
  ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'], ['mag', 'Magahi'], ['mai', 'Maithili'],
  ['ml', 'Malayalam'], ['mt', 'Maltese'], ['mni', 'Manipuri'], ['mr', 'Marathi'], ['min', 'Minangkabau (Arab and Latn script)'],
  ['lus', 'Mizo'], ['ne', 'Nepali'], ['fuv', 'Nigerian Fulfulde'], ['az', 'North Azerbaijani'], ['nso', 'Northern Sotho'],
  ['uz', 'Northern Uzbek'], ['nb', 'Norwegian Bokmål'], ['nn', 'Norwegian Nynorsk'], ['ny', 'Nyanja'], ['oc', 'Occitan'],
  ['or', 'Odia'], ['pag', 'Pangasinan'], ['prs', 'Persian (Afghanistan)'], ['pl', 'Polish'], ['pt', 'Portuguese'],
  ['pa', 'Punjabi'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sat', 'Santali'], ['sr', 'Serbian'], ['sd', 'Sindhi'],
  ['si', 'Sinhala'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['azb', 'South Azerbaijani'],
  ['pbt', 'Southern Pashto'], ['st', 'Southern Sotho'], ['es', 'Spanish'], ['ar', 'Standard Arabic (Arab and Latn script)'],
  ['lv', 'Standard Latvian'], ['ms', 'Standard Malay'], ['sw', 'Swahili'], ['ss', 'Swati'], ['sv', 'Swedish'], ['tg', 'Tajik'],
  ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['ti', 'Tigrinya'], ['sq', 'Tosk Albanian'], ['tr', 'Turkish'],
  ['ug', 'Uyghur'], ['vi', 'Vietnamese'],
];

/** Other tags people commonly use for a listed language. */
const ALIASES = { tl: 'fil', no: 'nb', ps: 'pbt', swh: 'sw', arb: 'ar', ful: 'fuv', ff: 'fuv', khk: 'mn', zsm: 'ms', als: 'sq', uzn: 'uz' };

/** Primary subtag, lower-case, aliases resolved: "ar-EG" -> "ar", "tl" -> "fil". */
function normLang(tag) {
  const p = String(tag || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return ALIASES[p] || p;
}

function allowedLanguages(override) {
  if (override && String(override).trim()) {
    return [...new Set(String(override).split(',').map(normLang).filter((x) => /^[a-z]{2,3}$/.test(x)))];
  }
  return DOCUMENTED.map(([code]) => code);
}

module.exports = { DOCUMENTED, ALIASES, normLang, allowedLanguages };
