/**
 * AI over two OpenAI-compatible providers (for example RunPod vLLM primary and
 * any secondary) with automatic fallback. When neither is configured, or
 * AI_MOCK=true, a deterministic local fallback keeps every feature usable.
 */
const config = require('../config');

function providers() {
  return [config.AI.primary, config.AI.secondary].filter((p) => p && p.baseUrl && p.model);
}
function status() {
  const ps = providers();
  return {
    enabled: ps.length > 0 && !config.AI.mock,
    mock: config.AI.mock || ps.length === 0,
    providers: ps.map((p) => ({ name: p.name, model: p.model })),
  };
}

async function callProvider(p, messages, { maxTokens, temperature, json }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.AI.timeoutMs);
  const url = p.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  try {
    const body = { model: p.model, messages, max_tokens: maxTokens || config.AI.maxTokens, temperature: temperature ?? 0.3, stream: false };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${p.name} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = j.choices && j.choices[0] && (j.choices[0].message?.content ?? j.choices[0].text);
    if (!text) throw new Error(`${p.name} returned no content`);
    return String(text).trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * chat(useCase, messages, opts) -> { text, provider, model, mock }
 * Tries primary then secondary. Falls back to the mock when both fail.
 */
async function chat(useCase, messages, opts = {}) {
  const data = require('./data');
  const ps = config.AI.mock ? [] : providers();
  const errors = [];
  for (const p of ps) {
    const t0 = Date.now();
    try {
      const text = await callProvider(p, messages, opts);
      data.logAiUsage({ useCase, provider: p.name, model: p.model, ok: true, latencyMs: Date.now() - t0 });
      return { text, provider: p.name, model: p.model, mock: false };
    } catch (e) {
      errors.push(e.message);
      data.logAiUsage({ useCase, provider: p.name, model: p.model, ok: false, latencyMs: Date.now() - t0, error: e.message });
    }
  }
  const text = mock(useCase, messages, opts);
  return { text, provider: 'local', model: 'heuristic', mock: true, errors };
}

// --------------------------------------------------------------- heuristics
const STOP = new Set('the a an and or but to of in on for with is are was were be been it this that i you we they he she at as by from so not do does did have has had will would can could should just like yeah okay ok um uh really very there here what when where who how why our your my me us them'.split(' '));
function keywords(text, n = 8) {
  const freq = new Map();
  for (const w of String(text).toLowerCase().match(/[a-zà-ÿ']{4,}/g) || []) if (!STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}
function sentences(text) {
  return String(text).split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
}
function mock(useCase, messages, opts) {
  const input = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const lines = sentences(input);
  const kw = keywords(input);
  const speakers = [...new Set((input.match(/^([^:\n]{2,40}):/gm) || []).map((s) => s.slice(0, -1).trim()))];
  switch (useCase) {
    case 'summary':
    case 'recap':
    case 'catchup': {
      const top = lines.filter((l) => kw.some((k) => l.toLowerCase().includes(k))).slice(0, useCase === 'catchup' ? 4 : 7);
      return [
        useCase === 'catchup' ? '## While you were away' : '## Summary',
        speakers.length ? `**Speakers:** ${speakers.slice(0, 8).join(', ')}` : '',
        kw.length ? `**Key topics:** ${kw.slice(0, 6).join(', ')}` : '',
        '',
        ...top.map((l) => `- ${l.replace(/^[^:]{2,40}:\s*/, (m) => `**${m.trim()}** `)}`),
        '',
        '_Generated locally: connect an AI provider (AI_PRIMARY_*) for richer summaries._',
      ].filter((x) => x !== '').join('\n');
    }
    case 'action_items': {
      const acts = lines.filter((l) => /\b(will|should|need to|must|todo|to-do|action|follow up|deadline|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)|pay|send|call|share|review)\b/i.test(l)).slice(0, 10);
      return acts.length ? acts.map((a) => `- [ ] ${a}`).join('\n') : '- [ ] No explicit action items detected.';
    }
    case 'title': {
      const t = kw.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(', ');
      const tags = kw.slice(0, 6).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 2);
      return JSON.stringify({
        title: t ? `Conversations on ${t}` : 'Live session',
        description: lines.slice(0, 2).join(' ').slice(0, 280) || 'Join us live on 1venue.',
        tags: tags.length ? tags : ['live', 'event'],
      });
    }
    case 'moderate': {
      const bad = /\b(fuck|shit|bitch|bastard|idiot|stupid|kill yourself|nigga|scam link|free money)\b/i.test(input);
      return JSON.stringify({ allowed: !bad, reason: bad ? 'Contains abusive or spammy language' : 'ok' });
    }
    case 'translate':
      return input.replace(/^Translate[^\n]*\n/i, '');
    case 'scripture': {
      // Heuristic topic / phrase → well-known references so search works offline.
      // Respect corpus: quran → surahs only; bible → canon + deuterocanonical.
      let q = input.replace(/^Find passages for:\s*/i, '');
      const corpusM = q.match(/\bcategory:\s*(quran|bible)\b/i);
      const corpus = (corpusM ? corpusM[1] : 'bible').toLowerCase();
      q = q.replace(/\s*\([^)]*\)\s*$/i, '').replace(/\bcategory:\s*(quran|bible)\b/ig, '').trim().toLowerCase();

      const BIBLE_TOPIC = [
        [/family|marriage|husband|wife|leave.*(father|mother)|cleave|one flesh/, [
          ['Genesis 2:24', 'A man leaves his parents and is united to his wife'],
          ['Tobit 8:4-8', 'Tobias and Sarah pray on their wedding night (deuterocanonical)'],
          ['Ephesians 5:25', 'Husbands, love your wives as Christ loved the church'],
          ['Ephesians 5:31', 'The two will become one flesh'],
          ['Sirach 26:1-3', 'A good wife is a great blessing (deuterocanonical)'],
          ['Matthew 19:5-6', 'What God has joined together, let no one separate'],
        ]],
        [/hope|hopeful|future/, [
          ['Jeremiah 29:11', 'Plans to prosper you and give you a future and a hope'],
          ['Romans 15:13', 'May the God of hope fill you with all joy and peace'],
          ['Hebrews 11:1', 'Faith is the assurance of things hoped for'],
          ['Wisdom 3:1-4', 'The souls of the righteous are in the hand of God (deuterocanonical)'],
          ['Psalm 42:11', 'Put your hope in God'],
        ]],
        [/love|loving|charity/, [
          ['1 Corinthians 13:4-7', 'Love is patient, love is kind'],
          ['John 3:16', 'For God so loved the world'],
          ['1 John 4:7-8', 'Love is from God; God is love'],
          ['Song of Songs 8:6-7', 'Love is strong as death'],
          ['Sirach 6:14-16', 'A faithful friend is a sturdy shelter (deuterocanonical)'],
        ]],
        [/faith|believe|belief/, [
          ['Hebrews 11:1', 'Faith is the assurance of things hoped for'],
          ['Hebrews 11:6', 'Without faith it is impossible to please God'],
          ['Romans 10:17', 'Faith comes from hearing the word of Christ'],
          ['Mark 11:22-24', 'Have faith in God'],
          ['2 Maccabees 7:20-23', 'A mother’s faith under persecution (deuterocanonical)'],
        ]],
        [/peace|anxiety|worry|afraid|fear/, [
          ['Philippians 4:6-7', 'Do not be anxious; the peace of God will guard you'],
          ['John 14:27', 'Peace I leave with you; my peace I give you'],
          ['Isaiah 26:3', 'You keep in perfect peace those whose minds are stayed on you'],
          ['Sirach 2:1-6', 'Accept what befalls you; trust God (deuterocanonical)'],
          ['Psalm 23:4', 'I will fear no evil, for you are with me'],
        ]],
        [/strength|strong|weak|weary/, [
          ['Philippians 4:13', 'I can do all things through him who strengthens me'],
          ['Isaiah 40:31', 'Those who wait for the Lord shall renew their strength'],
          ['2 Corinthians 12:9', 'My grace is sufficient; power is made perfect in weakness'],
          ['Psalm 46:1', 'God is our refuge and strength'],
          ['Judith 13:7-8', 'Judith’s courage (deuterocanonical)'],
        ]],
        [/wisdom|wise|understanding|knowledge/, [
          ['Proverbs 3:5-6', 'Trust in the Lord with all your heart'],
          ['Wisdom 7:7-11', 'I prayed and understanding was given me (deuterocanonical)'],
          ['James 1:5', 'If any of you lacks wisdom, ask God'],
          ['Sirach 1:1-4', 'All wisdom comes from the Lord (deuterocanonical)'],
          ['Proverbs 9:10', 'The fear of the Lord is the beginning of wisdom'],
        ]],
        [/prayer|pray|praying/, [
          ['Matthew 6:9-13', 'The Lord’s Prayer'],
          ['Philippians 4:6', 'In everything by prayer and supplication'],
          ['Tobit 3:1-6', 'Tobit’s prayer in affliction (deuterocanonical)'],
          ['1 Thessalonians 5:17', 'Pray without ceasing'],
          ['James 5:16', 'The prayer of a righteous person has great power'],
        ]],
        [/forgiveness|forgive|forgiving|mercy/, [
          ['Matthew 6:14-15', 'Forgiving others linked to receiving the Father’s forgiveness'],
          ['Ephesians 4:32', 'Forgive one another as God in Christ has forgiven you'],
          ['Sirach 28:1-5', 'Mercy toward a neighbor opens the way for one’s own mercy (deuterocanonical)'],
          ['1 John 1:9', 'Confession met by God’s faithful forgiveness'],
          ['Tobit 4:7-11', 'Generosity and almsgiving as a path of mercy (deuterocanonical)'],
          ['Colossians 3:13', 'Bear with one another and forgive as the Lord forgave'],
        ]],
        [/good works|good deeds|works|deeds|serving|service/, [
          ['Ephesians 2:10', 'Believers created in Christ for a life of good works'],
          ['Matthew 5:16', 'Let good deeds shine so others glorify the Father'],
          ['James 2:14-17', 'Faith without accompanying works is dead'],
          ['Tobit 4:7-11', 'Almsgiving and open-handedness toward the poor (deuterocanonical)'],
          ['Galatians 6:9-10', 'Do not grow weary in doing good to others'],
          ['Sirach 3:30', 'Almsgiving as a form of atonement (deuterocanonical)'],
        ]],
        [/salvation|saved|save|gospel|cross/, [
          ['John 3:16', 'Core summary of the gospel: God’s love and eternal life'],
          ['Romans 10:9-10', 'If you confess with your mouth and believe in your heart'],
          ['Ephesians 2:8-9', 'By grace you have been saved through faith'],
          ['Wisdom 2:12-20', 'The righteous one is tested (deuterocanonical; often read with the Passion)'],
          ['Acts 4:12', 'There is no other name under heaven by which we must be saved'],
        ]],
        [/creation|beginning|genesis|created/, [
          ['Genesis 1:1', 'In the beginning, God created the heavens and the earth'],
          ['Genesis 1:27', 'God created man in his own image'],
          ['John 1:1-3', 'In the beginning was the Word'],
          ['Wisdom 11:24-26', 'You love all things that exist (deuterocanonical)'],
          ['Colossians 1:16', 'All things were created through him and for him'],
        ]],
        [/shepherd|psalm 23|green pastures/, [
          ['Psalm 23:1-6', 'The Lord is my shepherd'],
          ['John 10:11', 'I am the good shepherd'],
          ['Isaiah 40:11', 'He will tend his flock like a shepherd'],
        ]],
      ];

      const QURAN_TOPIC = [
        [/forgiveness|forgive|forgiving|mercy|merciful|rahman|rahim/, [
          ['Az-Zumar 53', 'Do not despair of the mercy of Allah — He forgives all sins'],
          ['An-Nisa 110', 'Whoever does evil or wrongs himself then seeks Allah’s forgiveness'],
          ['Al-Hijr 49', 'Inform My servants that I am the Forgiving, the Merciful'],
          ['Ash-Shura 25', 'He is the One who accepts repentance from His servants'],
          ['Al-Baqarah 222', 'Allah loves those who are constantly repentant and who purify themselves'],
        ]],
        [/good works|good deeds|works|deeds|charity|serving|righteous/, [
          ['Al-Baqarah 195', 'Encourages spending and striving in the cause of Allah'],
          ['Al-Baqarah 261', 'Likeness of those who spend in the way of Allah'],
          ['An-Nahl 97', 'Whoever does righteousness, male or female, while a believer'],
          ['Al-Kahf 30', 'Those who believe and do righteous deeds — we will not let their reward be lost'],
          ['Az-Zalzalah 7-8', 'Whoever does an atom’s weight of good will see it'],
        ]],
        [/peace|anxiety|worry|afraid|fear|sabr|patience/, [
          ['Ar-Ra\'d 28', 'In the remembrance of Allah do hearts find rest'],
          ['Ash-Sharh 5-6', 'With hardship comes ease'],
          ['Al-Baqarah 286', 'Allah does not burden a soul beyond that it can bear'],
          ['Al-Baqarah 153', 'Seek help through patience and prayer'],
          ['Al-Imran 139', 'Do not weaken and do not grieve; you will be superior if you are believers'],
        ]],
        [/hope|hopeful|future|trust|tawakkul/, [
          ['At-Talaq 2-3', 'Whoever fears Allah — He will make for him a way out'],
          ['Ash-Sharh 5-6', 'Indeed, with hardship comes ease'],
          ['Yusuf 87', 'Do not despair of relief from Allah'],
          ['Al-Baqarah 216', 'Perhaps you hate a thing and it is good for you'],
        ]],
        [/love|loving|charity|kindness|compassion/, [
          ['Al-Baqarah 177', 'Righteousness is… giving wealth in spite of love for it'],
          ['Al-Imran 134', 'Those who spend in ease and hardship and who restrain anger'],
          ['Ar-Rum 21', 'He created for you from yourselves mates that you may find tranquillity'],
          ['Al-Hujurat 13', 'The most noble of you in the sight of Allah is the most righteous'],
        ]],
        [/faith|believe|belief|iman|muslim/, [
          ['Al-Baqarah 2-5', 'This is the Book about which there is no doubt'],
          ['Al-Baqarah 285', 'The Messenger has believed… and the believers'],
          ['Al-Anfal 2-4', 'The believers are only those who, when Allah is mentioned, their hearts become fearful'],
          ['Al-Hujurat 14-15', 'The bedouins say, “We have believed”…'],
        ]],
        [/prayer|pray|praying|salah|dua/, [
          ['Al-Baqarah 45', 'Seek help through patience and prayer'],
          ['Al-Mu\'minun 1-2', 'Successful are the believers who are humble in their prayers'],
          ['Al-Isra 78', 'Establish prayer at the decline of the sun'],
          ['Ghafir 60', 'Call upon Me; I will respond to you'],
        ]],
        [/wisdom|wise|knowledge|understanding/, [
          ['Al-Baqarah 269', 'He gives wisdom to whom He wills'],
          ['Taha 114', 'My Lord, increase me in knowledge'],
          ['Al-Mujadila 11', 'Allah will raise those who have believed and been given knowledge'],
          ['Az-Zumar 9', 'Are those who know equal to those who do not know?'],
        ]],
        [/family|marriage|husband|wife|parents|orphan/, [
          ['Ar-Rum 21', 'He created for you from yourselves mates that you may find tranquillity'],
          ['An-Nisa 1', 'Fear Allah through whom you ask one another, and the wombs'],
          ['Al-Isra 23-24', 'Be kind to parents'],
          ['An-Nur 32', 'Marry the unmarried among you'],
        ]],
        [/strength|strong|weak|weary|patience|sabr/, [
          ['Ash-Sharh 5-6', 'With hardship comes ease'],
          ['Al-Baqarah 153', 'Indeed, Allah is with the patient'],
          ['Al-Imran 200', 'Be patient and endure and remain stationed'],
          ['Al-Baqarah 286', 'Allah does not burden a soul beyond that it can bear'],
        ]],
        [/creation|beginning|created|heavens/, [
          ['Al-Fatihah 1-2', 'Praise be to Allah, Lord of the worlds'],
          ['Al-Baqarah 164', 'In the creation of the heavens and earth are signs'],
          ['Adh-Dhariyat 47', 'We constructed the heaven with strength'],
          ['Fussilat 9-12', 'He created the earth in two days…'],
        ]],
      ];

      const TOPIC = corpus === 'quran' ? QURAN_TOPIC : BIBLE_TOPIC;
      for (const [re, list] of TOPIC) {
        if (re.test(q)) return list.map(([ref, why]) => `${ref} | ${why}`).join('\n');
      }
      if (corpus === 'quran') {
        return [
          'Al-Fatihah 1-7 | The opening chapter of the Qur’an',
          'Al-Baqarah 255 | Ayat al-Kursi',
          'Al-Ikhlas 1-4 | He is Allah, One',
          'Ar-Rahman 1-4 | The Most Merciful taught the Qur’an',
        ].join('\n');
      }
      if (q.length > 24 || /\b(leave|mother|father|wife|husband|flesh|united|joined)\b/.test(q)) {
        return [
          'Genesis 2:24 | A man shall leave his father and his mother and hold fast to his wife',
          'Tobit 8:4-8 | Tobias and Sarah’s prayer (deuterocanonical)',
          'Matthew 19:5 | For this reason a man shall leave his father and mother',
          'Ephesians 5:31 | Therefore a man shall leave his father and mother',
        ].join('\n');
      }
      return [
        'John 3:16 | For God so loved the world',
        'Psalm 23:1 | The Lord is my shepherd',
        'Sirach 2:1-6 | Accept what befalls you; trust God (deuterocanonical)',
        'Romans 8:28 | All things work together for good',
      ].join('\n');
    }
    default:
      return lines.length ? `Here is what I found in the session:\n${lines.slice(-4).map((l) => `- ${l}`).join('\n')}` : 'I do not have enough context yet. Ask again once the session has a transcript.';
  }
}

// --------------------------------------------------------------- use cases
const SYS = 'You are 1venue AI, a concise assistant for live events and meetings. Use Markdown. Never invent facts that are not in the provided context.';
function clip(s, n = 24000) { s = String(s || ''); return s.length > n ? s.slice(-n) : s; }

module.exports = {
  status,
  chat,
  summarize: (transcript, title) => chat('summary', [
    { role: 'system', content: SYS },
    { role: 'user', content: `Summarise this session${title ? ` titled "${title}"` : ''}. Give: a 2–3 sentence overview, key points as bullets, decisions, and notable quotes with the speaker name.\n\nTranscript ("Name: text"):\n${clip(transcript)}` },
  ]),
  actionItems: (transcript) => chat('action_items', [
    { role: 'system', content: SYS },
    { role: 'user', content: `List the action items as Markdown checkboxes "- [ ] Owner: task (due if mentioned)".\n\n${clip(transcript)}` },
  ]),
  catchUp: (transcript, minutes) => chat('catchup', [
    { role: 'system', content: SYS },
    { role: 'user', content: `I joined late or stepped away. Catch me up on the last ${minutes || 10} minutes in at most 5 bullets.\n\n${clip(transcript, 12000)}` },
  ]),
  ask: (question, context) => chat('assistant', [
    { role: 'system', content: SYS + ' Answer the question using the live session context. If the answer is not in it, say so briefly.' },
    { role: 'user', content: `Session context:\n${clip(context, 16000)}\n\nQuestion: ${question}` },
  ]),
  scripture: (query, translation, corpus = 'bible') => {
    const isQuran = String(corpus || '').toLowerCase() === 'quran';
    const system = isQuran
      ? 'You help find Qur’an passages for topics and themes. Reply with up to 6 references, one per line as "SurahName Ayah(-Ayah) | short reason". Use common English surah names (e.g. Al-Baqarah 255, Az-Zumar 53). No Bible verses. No other text.'
      : 'You help find Bible passages for topics, themes, and approximate quotes. Include deuterocanonical books where relevant (Tobit, Judith, Wisdom, Sirach, Baruch, 1–2 Maccabees). Reply with up to 6 references, one per line as "Book C:V(-V) | short reason". No other text.';
    return chat('scripture', [
      { role: 'system', content: system },
      { role: 'user', content: `Find passages for: ${query} (translation preference ${translation || (isQuran ? 'Sahih' : 'KJV')}; category: ${isQuran ? 'quran' : 'bible'})` },
    ], { maxTokens: 400 });
  },
  translate: (text, lang) => chat('translate', [
    { role: 'system', content: 'Translate the user text. Output only the translation.' },
    { role: 'user', content: `Translate to ${lang}:\n${String(text).slice(0, 2000)}` },
  ], { maxTokens: 400, temperature: 0.1 }),
  titleDescription: (notes, category) => chat('title', [
    { role: 'system', content: 'Write a catchy event title (max 80 chars), description (max 400 chars), and 3–8 short discovery tags (lowercase, no #, max 32 chars each). Reply as JSON {"title":"","description":"","tags":["tag1","tag2"]}.' },
    { role: 'user', content: `Category: ${category || 'event'}\nNotes: ${String(notes).slice(0, 2000)}` },
  ], { json: true, maxTokens: 350 }),
  moderate: async (text) => {
    const r = await chat('moderate', [
      { role: 'system', content: 'You moderate a community comment section. Reply JSON {"allowed":true|false,"reason":"..."}; block hate, harassment, explicit sexual content, scams and spam.' },
      { role: 'user', content: String(text).slice(0, 2000) },
    ], { json: true, maxTokens: 60, temperature: 0 });
    try { const j = JSON.parse(r.text.replace(/^```json|```$/g, '')); return { allowed: j.allowed !== false, reason: j.reason || '', provider: r.provider }; }
    catch (_) { return { allowed: true, reason: 'unparsed', provider: r.provider }; }
  },
  _mock: mock,
};
