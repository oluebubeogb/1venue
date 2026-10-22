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
      return JSON.stringify({ title: t ? `Conversations on ${t}` : 'Live session', description: lines.slice(0, 2).join(' ').slice(0, 280) || 'Join us live on 1venue.' });
    }
    case 'moderate': {
      const bad = /\b(fuck|shit|bitch|bastard|idiot|stupid|kill yourself|nigga|scam link|free money)\b/i.test(input);
      return JSON.stringify({ allowed: !bad, reason: bad ? 'Contains abusive or spammy language' : 'ok' });
    }
    case 'translate':
      return input.replace(/^Translate[^\n]*\n/i, '');
    case 'scripture':
      return 'Try a reference like "John 3:16", "Psalm 23" or "Romans 8:28-39". Connect an AI provider for topic lookups such as "verses about hope".';
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
    { role: 'system', content: 'You help find Bible passages. Reply with up to 6 references, one per line as "Book C:V(-V) | one-line why". No other text.' },
    { role: 'user', content: `Find passages for: ${query} (translation preference ${translation || 'KJV'})` },
  ], { maxTokens: 300 }),
  translate: (text, lang) => chat('translate', [
    { role: 'system', content: 'Translate the user text. Output only the translation.' },
    { role: 'user', content: `Translate to ${lang}:\n${String(text).slice(0, 2000)}` },
  ], { maxTokens: 400, temperature: 0.1 }),
  titleDescription: (notes, category) => chat('title', [
    { role: 'system', content: 'Write a catchy event title (max 80 chars) and description (max 400 chars). Reply as JSON {"title":"","description":""}.' },
    { role: 'user', content: `Category: ${category || 'event'}\nNotes: ${String(notes).slice(0, 2000)}` },
  ], { json: true, maxTokens: 300 }),
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
