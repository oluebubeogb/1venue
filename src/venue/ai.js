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
      // Heuristic topic / phrase → well-known references so search works offline
      const q = input.replace(/^Find passages for:\s*/i, '').replace(/\s*\(translation preference[^)]*\)\s*$/i, '').trim().toLowerCase();
      const TOPIC = [
        [/family|marriage|husband|wife|leave.*(father|mother)|cleave|one flesh/, [
          ['Genesis 2:24', 'A man leaves his parents and is united to his wife'],
          ['Ephesians 5:25', 'Husbands, love your wives as Christ loved the church'],
          ['Ephesians 5:31', 'The two will become one flesh'],
          ['Proverbs 18:22', 'He who finds a wife finds a good thing'],
          ['Matthew 19:5-6', 'What God has joined together, let no one separate'],
          ['Colossians 3:18-19', 'Wives submit; husbands love and do not be harsh'],
        ]],
        [/hope|hopeful|future/, [
          ['Jeremiah 29:11', 'Plans to prosper you and give you a future and a hope'],
          ['Romans 15:13', 'May the God of hope fill you with all joy and peace'],
          ['Hebrews 11:1', 'Faith is the assurance of things hoped for'],
          ['Psalm 42:11', 'Put your hope in God'],
          ['Romans 5:5', 'Hope does not put us to shame'],
        ]],
        [/love|loving|charity/, [
          ['1 Corinthians 13:4-7', 'Love is patient, love is kind'],
          ['John 3:16', 'For God so loved the world'],
          ['1 John 4:7-8', 'Love is from God; God is love'],
          ['Romans 8:38-39', 'Nothing can separate us from the love of God'],
          ['John 15:13', 'Greater love has no one than this'],
        ]],
        [/faith|believe|belief/, [
          ['Hebrews 11:1', 'Faith is the assurance of things hoped for'],
          ['Hebrews 11:6', 'Without faith it is impossible to please God'],
          ['Romans 10:17', 'Faith comes from hearing the word of Christ'],
          ['Mark 11:22-24', 'Have faith in God'],
          ['2 Corinthians 5:7', 'We walk by faith, not by sight'],
        ]],
        [/peace|anxiety|worry|afraid|fear/, [
          ['Philippians 4:6-7', 'Do not be anxious; the peace of God will guard you'],
          ['John 14:27', 'Peace I leave with you; my peace I give you'],
          ['Isaiah 26:3', 'You keep in perfect peace those whose minds are stayed on you'],
          ['Psalm 23:4', 'I will fear no evil, for you are with me'],
          ['2 Timothy 1:7', 'God gave us a spirit not of fear but of power'],
        ]],
        [/strength|strong|weak|weary/, [
          ['Philippians 4:13', 'I can do all things through him who strengthens me'],
          ['Isaiah 40:31', 'Those who wait for the Lord shall renew their strength'],
          ['2 Corinthians 12:9', 'My grace is sufficient; power is made perfect in weakness'],
          ['Psalm 46:1', 'God is our refuge and strength'],
          ['Ephesians 6:10', 'Be strong in the Lord and in the strength of his might'],
        ]],
        [/wisdom|wise|understanding|knowledge/, [
          ['Proverbs 3:5-6', 'Trust in the Lord with all your heart'],
          ['James 1:5', 'If any of you lacks wisdom, ask God'],
          ['Proverbs 9:10', 'The fear of the Lord is the beginning of wisdom'],
          ['Proverbs 4:7', 'The beginning of wisdom is this: get wisdom'],
        ]],
        [/prayer|pray|praying/, [
          ['Matthew 6:9-13', 'The Lord’s Prayer'],
          ['Philippians 4:6', 'In everything by prayer and supplication'],
          ['1 Thessalonians 5:17', 'Pray without ceasing'],
          ['James 5:16', 'The prayer of a righteous person has great power'],
        ]],
        [/forgiveness|forgive|forgiving|mercy/, [
          ['Matthew 6:14-15', 'If you forgive others, your heavenly Father will also forgive you'],
          ['Ephesians 4:32', 'Be kind, forgiving one another as God in Christ forgave you'],
          ['1 John 1:9', 'If we confess our sins, he is faithful to forgive'],
          ['Colossians 3:13', 'Forgive as the Lord has forgiven you'],
        ]],
        [/salvation|saved|save|gospel|cross/, [
          ['John 3:16', 'For God so loved the world that he gave his only Son'],
          ['Romans 10:9-10', 'If you confess with your mouth and believe in your heart'],
          ['Ephesians 2:8-9', 'By grace you have been saved through faith'],
          ['Acts 4:12', 'There is no other name under heaven by which we must be saved'],
        ]],
        [/creation|beginning|genesis|created/, [
          ['Genesis 1:1', 'In the beginning, God created the heavens and the earth'],
          ['Genesis 1:27', 'God created man in his own image'],
          ['John 1:1-3', 'In the beginning was the Word'],
          ['Colossians 1:16', 'All things were created through him and for him'],
        ]],
        [/shepherd|psalm 23|green pastures/, [
          ['Psalm 23:1-6', 'The Lord is my shepherd'],
          ['John 10:11', 'I am the good shepherd'],
          ['Isaiah 40:11', 'He will tend his flock like a shepherd'],
        ]],
      ];
      for (const [re, list] of TOPIC) {
        if (re.test(q)) return list.map(([ref, why]) => `${ref} | ${why}`).join('\n');
      }
      // Phrase-ish query: point to a few classic matches when keywords appear
      if (q.length > 24 || /\b(leave|mother|father|wife|husband|flesh|united|joined)\b/.test(q)) {
        return [
          'Genesis 2:24 | A man shall leave his father and his mother and hold fast to his wife',
          'Matthew 19:5 | For this reason a man shall leave his father and mother',
          'Mark 10:7-8 | The two shall become one flesh',
          'Ephesians 5:31 | Therefore a man shall leave his father and mother',
        ].join('\n');
      }
      return [
        'John 3:16 | For God so loved the world',
        'Psalm 23:1 | The Lord is my shepherd',
        'Romans 8:28 | All things work together for good',
        'Philippians 4:13 | I can do all things through him who strengthens me',
        'Try a reference like "John 3:16" or a topic like "hope", "family", "peace".',
      ].slice(0, 4).join('\n');
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
  scripture: (query, translation) => chat('scripture', [
    { role: 'system', content: 'You help find Bible passages for topics, themes, and approximate quotes. Reply with up to 6 references, one per line as "Book C:V(-V) | short reason or matching phrase". Prefer well-known public-domain wording. No other text, no preamble.' },
    { role: 'user', content: `Find passages for: ${query} (translation preference ${translation || 'KJV'})` },
  ], { maxTokens: 400 }),
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
