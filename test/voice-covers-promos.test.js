'use strict';
// Voice typing (Whisper on Replicate, spoken scripture + dates), AI covers (flux-schnell), promotions,
// Discover / command-bar layout, /u dots, Books API rename. Replicate is mocked: no network, no cost.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { boot, client, signupPayload, fundTestWallet } = require('./helpers/server');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL' : false;
const tokenOf = (link) => new URL(link).searchParams.get('token');

/* ------------------------------------------------------------ pure units */
test('spoken scripture -> bar suggestions (Bible + Qur’an)', async () => {
  const { spokenToQuery, spokenReference, wordsToDigits } = await import('../public/js/spoken-ref.js');
  const cases = {
    'John chapter 3.': 'John 3',
    'John chapter three verse sixteen': 'John 3:16',
    'Turn with me to first Corinthians 13.': '1 Corinthians 13',
    'Psalm one hundred and nineteen verse 105': 'Psalm 119:105',
    'Romans 8 verses 28 to 39': 'Romans 8:28-39',
    'Let us read from the Gospel of John chapter 3': 'John 3',
    'Second Timothy two fifteen': '2 Timothy 2:15',
    'Revelation twenty two verse twenty one': 'Revelation 22:21',
    'Surah Al-Kahf, verse ten.': 'surah al kahf 10',
    'surah 18 verse 10': 'surah 18 10',
  };
  for (const [said, want] of Object.entries(cases)) assert.equal(spokenToQuery(said), want, said);
  assert.equal(spokenReference('mute everyone please'), null);
  assert.equal(spokenToQuery('Open dark mode.'), 'Open dark mode');
  assert.equal(wordsToDigits('three sixteen'), '3 16', 'separate numbers are not added together');
  // the bar's Qur'an matcher understands what voice produces
  const { surahCommands } = await import('../public/js/quran-cmd.js');
  const surahs = require('../src/venue/bible.js').BOOKS.filter((b) => b.surah);
  const hit = surahCommands(spokenToQuery('Surah Al-Kahf verse ten'), surahs, () => {});
  assert.equal(hit.length, 1); assert.match(hit[0].label, /Al-Kahf/); assert.match(hit[0].label, /ayah 10/);
  // and the server parses the Bible ones
  const { parseReference } = require('../src/venue/bible.js');
  for (const r of ['John 3:16', '1 Corinthians 13', 'Psalm 119:105', 'Romans 8:28-39']) assert.ok(parseReference(r), r);
});

test('spoken dates -> datetime-local (chrono-node, speaker’s timezone, misheard months)', () => {
  const { parseSpokenDate } = require('../src/features/voice/date');
  const now = new Date('2026-11-15T04:00:00Z'); const tz = -60; // Lagos
  assert.deepEqual(parseSpokenDate('February 16 2027', { now, tzOffset: tz }).start, '2027-02-16T12:00');
  assert.equal(parseSpokenDate('February 16 2027', { now, tzOffset: tz }).hasTime, false);
  assert.equal(parseSpokenDate('februray 16 2027 at 6 p.m.', { now, tzOffset: tz }).start, '2027-02-16T18:00');
  assert.equal(parseSpokenDate('next friday at six pm', { now, tzOffset: tz }).start, '2026-11-20T18:00');
  const r = parseSpokenDate('tomorrow 10am to 12pm', { now, tzOffset: tz });
  assert.equal(r.start, '2026-11-16T10:00'); assert.equal(r.end, '2026-11-16T12:00');
  assert.equal(parseSpokenDate('11pm', { now: new Date('2026-11-15T21:30:00Z'), tzOffset: tz }).start, '2026-11-15T23:00', 'local wall time, not UTC');
  assert.equal(parseSpokenDate('a seminar on animal protection', { now, tzOffset: tz }), null);
});


test('Write it for me needs enough input; dates and venues are pulled out of free text', () => {
  const draft = require('../src/features/ai/draft');
  assert.equal(draft.wordCount(''), 0);
  assert.equal(draft.isRichInput('', ''), false, 'empty');
  assert.equal(draft.isRichInput('Meetup', 'A talk.'), false, 'thin — well under 15 words');
  assert.equal(draft.isRichInput('Sunday hangout', 'Come through.'), false, 'thin');
  const richTitle = 'A workshop for young founders building climate tools in Lagos';
  const richDesc = 'We will share lessons from shipping two products and leave time for questions.';
  assert.ok(draft.wordCount(richTitle + ' ' + richDesc) >= 15);
  assert.equal(draft.isRichInput(richTitle, richDesc), true, 'rich');
  assert.equal(draft.MIN_WORDS, 15);

  const now = new Date('2026-11-15T04:00:00Z'); const tz = -60; // Lagos
  const notes = 'A workshop for young founders in Lagos next Friday at 6pm at the Civic Centre.';
  const hints = draft.enrichDraft(notes, {}, { now, tzOffset: tz, category: 'workshop' });
  assert.equal(hints.start, '2026-11-20T18:00');
  assert.equal(hints.hasTime, true);
  assert.match(hints.venue, /Civic Centre/i);
  assert.equal(hints.category, 'workshop');
  assert.equal(draft.extractVenue('Join us at 6pm for a chat'), null, 'a time is not a venue');
  assert.equal(draft.extractVenue('Held at the National Theatre, Lagos'), 'National Theatre, Lagos');
});

test('create page: Write-it-for-me overlay when input is thin; covers generate only on click', async () => {
  const create = read('public/js/pages/create.js');
  const client = await import('../public/js/event-draft.js');
  assert.equal(client.MIN_WORDS, 15);
  assert.equal(client.isRichInput('', ''), false);
  assert.equal(client.isRichInput('Hi', 'There'), false);
  assert.equal(client.isRichInput('A workshop for young founders building climate tools in Lagos', 'We will share lessons from shipping two products and leave time for questions.'), true);
  assert.match(create, /isRichInput\(/);
  assert.match(create, /Tell us about your event/);
  assert.match(create, /What's it about, who's it for, when and where, who's speaking, anything special\?/);
  assert.match(create, /listenOn\(box\)/);
  assert.match(create, /Use this/);
  assert.match(create, /Try again/);
  assert.match(create, /'Edit'\)\)/);
  assert.match(create, /Replace the .+ I already filled/);
  assert.match(create, /Design with AI/);
  assert.match(create, /Upload your own/);
  assert.match(create, /of \$\{coverLimit\} left today/);
  assert.doesNotMatch(create, /IntersectionObserver/, 'covers are not generated when the step scrolls into view');
  assert.doesNotMatch(create, /autoDone/);
  // generateCovers is only wired to the Design with AI button, never after Write it for me
  assert.match(create, /if \(genBtn\) genBtn\.onclick = \(\) => generateCovers\(\)/);
  assert.doesNotMatch(create, /generateCovers\(\);\s*\n\s*toast/);
  const writeBlock = create.slice(create.indexOf("aiBtn.onclick"), create.indexOf("const submit ="));
  assert.ok(!writeBlock.includes('generateCovers('), 'Write it for me does not start a cover generation');
});

test('voice typing never listens in password / email / phone / code / payment fields', async () => {
  const { voiceKind } = await import('../public/js/voice-fields.js');
  const el = (tag, attrs = {}, extra = {}) => ({ tagName: tag, disabled: false, readOnly: false, dataset: {}, ...extra, getAttribute: (k) => (k in attrs ? attrs[k] : null), name: attrs.name || '', id: attrs.id || '', closest: (sel) => (sel === '.cmdbar' && extra.inBar ? {} : null) });
  assert.equal(voiceKind(el('INPUT', { type: 'text' })), 'text');
  assert.equal(voiceKind(el('TEXTAREA')), 'text');
  assert.equal(voiceKind(el('INPUT', { type: 'search' }, { inBar: true })), 'bar');
  assert.equal(voiceKind(el('INPUT', { type: 'datetime-local' })), 'date');
  for (const a of [{ type: 'password' }, { type: 'email' }, { type: 'tel' }, { type: 'number' }, { type: 'text', autocomplete: 'one-time-code' }, { type: 'text', autocomplete: 'cc-number' },
    { type: 'text', inputmode: 'numeric' }, { type: 'text', inputmode: 'email' }, { type: 'text', autocomplete: 'username' }, { type: 'text', name: 'otp' }, { type: 'text', 'aria-label': 'Card number' },
    { type: 'text', 'aria-label': 'Email or username' }, { type: 'text', name: 'phone' }, { type: 'text', id: 'invite-key' }]) assert.equal(voiceKind(el('INPUT', a)), null, JSON.stringify(a));
  assert.equal(voiceKind(el('INPUT', { type: 'text' }, { disabled: true })), null);
  assert.equal(voiceKind(el('INPUT', { type: 'text' }, { dataset: { voice: 'off' } })), null);
});

test('event colours: AI palette name wins, else topic keywords, else category; covers prompt is text-free 16:9', () => {
  const { pickPalette, PALETTE } = require('../src/lib/palette');
  assert.deepEqual(pickPalette({ suggestion: 'emerald' }), { name: 'Emerald', accent: '#059669', accent2: '#0891b2' });
  assert.ok(['Emerald', 'Teal'].includes(pickPalette({ title: 'A seminar on animal protection' }).name));
  assert.ok(['Violet', 'Gold'].includes(pickPalette({ title: 'Sunday service', category: 'sermon' }).name));
  const names = new Set(['Startup pitch night', 'Lagos design meetup', 'Book club', 'Coding for kids', 'Town hall', 'Mentorship chat'].map((t) => pickPalette({ title: t, category: 'other' }).name));
  assert.ok(names.size >= 3, 'events don’t all get one colour');
  const app = read('public/js/app.js');
  for (const [n, a, b] of PALETTE) assert.ok(app.includes(`['${n}', '${a}', '${b}']`), `palette in sync with ACCENTS: ${n}`);
  const { coverPrompt } = require('../src/features/covers/prompt');
  const p = coverPrompt({ title: 'A seminar on animal protection', category: 'seminar', accent: '#059669', accent2: '#0891b2' });
  assert.match(p, /animal protection/); assert.match(p, /no text/); assert.match(p, /16:9/); assert.match(p, /#059669/);
  assert.doesNotMatch(coverPrompt({ title: '"><script>' }), /[<>"]/);
});

test('Whisper input mapping: auto-detect by default, language hint when set, Igbo falls back to auto', () => {
  const stt = require('../src/venue/stt');
  const fast = 'vaibhavs10/incredibly-fast-whisper:abc';
  assert.equal(stt.replicateInput(fast, 'data:x', null).language, 'None');
  assert.equal(stt.replicateInput(fast, 'data:x', 'yo').language, 'yoruba');
  assert.equal(stt.replicateInput(fast, 'data:x', 'ha').language, 'hausa');
  assert.equal(stt.replicateInput(fast, 'data:x', 'ig').language, 'None');
  assert.equal(stt.replicateInput(fast, 'data:x', 'en').task, 'transcribe');
  assert.equal(stt.replicateInput('openai/whisper', 'data:x', null).language, 'auto');
  assert.equal(stt.replicateInput('openai/whisper', 'data:x', 'yo').language, 'yo');
  assert.equal(stt.replicateText({ text: ' hi ' }), ' hi ');
  assert.equal(stt.replicateText({ transcription: 'yo' }), 'yo');
  assert.equal(stt.replicateText({ segments: [{ text: 'a' }, { text: 'b' }] }), 'a b');
});

test('layout: / bar search is a fixed-size box and quick actions take the rest; Discover header; /u allows dots; Books API callers', () => {
  const css = read('public/css/app.css');
  assert.match(css, /\.cmdbar \.cmd-in\s*\{\s*flex:\s*0 1 320px;\s*min-width:\s*200px;/);
  assert.match(css, /\.cmdbar \.cmd-actions\s*\{\s*flex:\s*1 1 auto;/);
  assert.match(css, /\.cmdbar \.cmd-in\s*\{\s*flex:\s*0 0 46%;\s*min-width:\s*0;\s*\}/, 'phone keeps a usable search box');
  assert.match(css, /width: min\(1200px, calc\(100% - 24px\)\)/, 'bar is wide enough for the quick actions');
  assert.match(css, /@keyframes slashDance/);
  assert.match(css, /\.dz-head\s*\{[^}]*grid-template-areas:\s*"title filters" "search search"/);
  assert.match(css, /grid-template-areas:\s*"title search filters"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.dz-txt/);
  const disc = read('public/js/pages/discover.js');
  assert.match(disc, /export function filterPicker/);
  assert.ok(!/statusSeg|class: 'chips free-grid'/.test(disc), 'old rows 3–4 removed');
  const app = read('public/js/app.js');
  const m = app.match(/\[\/\^\\\/u\\\/\(([^)]*)\)/);
  assert.ok(m, 'profile route present');
  const re = new RegExp(`^\\/u\\/(${m[1]})\\/?$`);
  for (const u of ['chinedu.eze', 'adaeze', 'sarah.mensah', 'yusuf-abdullahi', 'a_b']) assert.ok(re.test(`/u/${u}`), u);
  for (const f of ['public/js/pages/bible.js', 'public/js/quran-cmd.js', 'public/js/room/stage.js', 'public/js/room/tools.js']) {
    const src = read(f);
    assert.ok(!src.includes('/api/bible/'), `${f} uses /api/books`);
    assert.ok(src.includes('/api/books/'), f);
  }
  const sw = read('public/sw.js');
  assert.doesNotMatch(sw, /v2[1-6]-/, 'service worker bumped past v26');
});

test('Discover filter picker: labels animate as hints only; filtering happens on pick (DOM-free check)', () => {
  const src = read('public/js/pages/discover.js');
  // the cycling timer only calls set() on the labels; onPick (which reloads results) is only wired to the menu
  const timer = src.slice(src.indexOf('const timer = setInterval'), src.indexOf('const open ='));
  assert.ok(!/onPick|sync\(|load\(/.test(timer), 'the label cycle never filters');
  assert.match(src, /run: \(\) => \{ cur\[kind\] = k; paint\(true\); onPick/);
  assert.match(src, /reduceMotion\(\)/);
  assert.match(src, /history\.replaceState/);
});

/* ------------------------------------------------------------ server, mocked Replicate */
function mockReplicate() {
  const calls = [];
  const img = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '), Buffer.alloc(3000, 7)]);
  let sttText = 'John chapter three verse sixteen';
  const srv = http.createServer(async (req, res) => {
    const parts = []; for await (const c of req) parts.push(c);
    const raw = Buffer.concat(parts).toString();
    const base = `http://127.0.0.1:${srv.address().port}`;
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { /* */ }
    calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization && req.headers.authorization !== 'Bearer r8_test_token') return json(401, { detail: 'bad token' });
    if (req.method === 'POST' && req.url === '/v1/predictions' && body && body.version) return json(201, { id: 's1', status: 'succeeded', output: { text: ' ' + sttText + ' ', chunks: [] }, metrics: { predict_time: 0.6 } });
    if (req.method === 'POST' && req.url === '/v1/models/black-forest-labs/flux-schnell/predictions') {
      const n = body.input.num_outputs || 1;
      return json(201, { id: 'c1', status: 'succeeded', output: Array.from({ length: n }, (_, i) => `${base}/out/c${i}.webp`) });
    }
    if (req.method === 'GET' && req.url.startsWith('/out/')) { res.writeHead(200, { 'content-type': 'image/webp', 'content-length': img.length }); return res.end(img); }
    json(404, { detail: 'not found' });
  });
  return { srv, calls, img, say: (t) => { sttText = t; } };
}

test('voice typing + captions via Whisper on Replicate: auth, language, caps, room guests, Web Speech fallback', { skip, timeout: 120000 }, async () => {
  const mock = mockReplicate();
  await new Promise((r) => mock.srv.listen(0, '127.0.0.1', r));
  const s = await boot({ REPLICATE_API_TOKEN: 'r8_test_token', REPLICATE_API_BASE: `http://127.0.0.1:${mock.srv.address().port}/v1`, STT_DAILY_SECONDS_PER_USER: '10', STT_DAILY_CAPTION_SECONDS_PER_USER: '30', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'stt-')) });
  const clip = Buffer.alloc(9000, 1); // ~3 s of 24 kbps opus
  const post = (qs, headers = {}, body = clip) => fetch(`${s.base}/api/stt?${qs}`, { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-audio-ms': '3000', ...headers }, body });
  try {
    const cfg = await (await fetch(s.base + '/api/config')).json();
    assert.equal(cfg.stt.primary, 'replicate');
    assert.equal(cfg.stt.server, true);
    assert.equal(cfg.stt.segmentMaxSeconds, 5);
    assert.ok(!JSON.stringify(cfg).includes('r8_test_token'));

    assert.equal((await post('mode=dictate')).status, 401, 'anonymous outside a room');
    assert.equal(mock.calls.length, 0);

    const c = client(s.base); await c.post('/api/signup', signupPayload());
    const cookie = c.jar.header();
    const r1 = await post('mode=dictate', { cookie });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.text, 'John chapter three verse sixteen');
    const call = mock.calls.at(-1);
    assert.equal(call.url, '/v1/predictions');
    assert.equal(call.body.version, 'c6433aab18b7318bbae316495f1a097fc067deef7d59dc2f33e45077ae5956c7');
    assert.equal(call.body.input.language, 'None', 'auto-detect by default');
    assert.match(call.body.input.audio, /^data:audio\/webm;base64,/);
    assert.equal(call.headers.authorization, 'Bearer r8_test_token');

    await post('mode=dictate&lang=yo', { cookie });
    assert.equal(mock.calls.at(-1).body.input.language, 'yoruba', 'language hint');
    const left = await (await fetch(s.base + '/api/stt/config', { headers: { cookie } })).json();
    assert.equal(left.secondsLeft, 4, '10 s cap, 6 s used');

    // over the daily cap: no Replicate call, 429 + fallback to the browser
    const before = mock.calls.length;
    const capped = await post('mode=dictate', { cookie, 'x-audio-ms': '5000' });
    assert.equal(capped.status, 429);
    assert.equal((await capped.json()).fallback, 'webspeech');
    assert.equal(mock.calls.length, before);
    // a lying X-Audio-Ms can't make a big clip count as tiny
    const c2 = client(s.base); await c2.post('/api/signup', signupPayload());
    assert.equal((await post('mode=dictate', { cookie: c2.jar.header(), 'x-audio-ms': '1' }, Buffer.alloc(120000, 1))).status, 429, '120 KB ≈ 15 s at 64 kbps > 10 s cap');

    // Whisper's phantom lines on silence are dropped
    mock.say('Thank you.');
    assert.equal((await (await post('mode=dictate', { cookie: c2.jar.header() })).json()).text, '');
    mock.say('John chapter three verse sixteen');

    // room guest: dictation (never broadcast) and captions, with the room credential
    const pid = 'guest-stt-' + Date.now();
    await fundTestWallet(s.base, cookie);
    const cr = await (await fetch(s.base + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'STT room', participantName: 'Ada Guest', participantId: pid }) })).json();
    const room = { 'X-Room-Code': cr.code, 'X-Participant-Id': pid, 'X-Room-Credential': cr.wsCredential };
    assert.equal((await post(`mode=dictate&code=${cr.code}`, room)).status, 200);
    assert.equal((await post(`mode=caption&code=${cr.code}`, room)).status, 200);
    assert.equal((await post('mode=caption', { cookie })).status, 401, 'captions need a room');
    assert.equal((await post(`mode=dictate&code=${cr.code}`, { ...room, 'X-Room-Credential': 'forged' })).status, 401);
    const gcfg = await (await fetch(s.base + '/api/stt/config', { headers: room })).json();
    assert.equal(gcfg.allowed, true); assert.equal(gcfg.captionSecondsLeft, 27);

    // spoken dates
    assert.equal((await client(s.base).post('/api/voice/date', { text: 'tomorrow 6pm' })).status, 401);
    const d = await c.post('/api/voice/date', { text: 'February 16 2027 at 6pm', tzOffset: -60 });
    assert.equal(d.status, 200); assert.equal(d.body.start, '2027-02-16T18:00');
    assert.equal((await c.post('/api/voice/date', { text: 'hello there' })).status, 422);
  } finally { await s.stop(); mock.srv.close(); }
});

test('no token: STT falls back to the browser, covers are off, app still works', { skip, timeout: 60000 }, async () => {
  const s = await boot({ REPLICATE_API_TOKEN: '' });
  try {
    const cfg = await (await fetch(s.base + '/api/config')).json();
    assert.equal(cfg.stt.primary, 'webspeech'); assert.equal(cfg.stt.fallback, 'webspeech');
    assert.equal(cfg.covers.enabled, false);
    const c = client(s.base); await c.post('/api/signup', signupPayload());
    const r = await fetch(`${s.base}/api/stt?mode=dictate`, { method: 'POST', headers: { cookie: c.jar.header(), 'content-type': 'audio/webm' }, body: Buffer.alloc(3000, 1) });
    assert.equal(r.status, 503); assert.equal((await r.json()).fallback, 'webspeech');
    assert.equal((await c.post('/api/covers/generate', { title: 'x' })).status, 503);
  } finally { await s.stop(); }
});

test('AI covers (flux-schnell 16:9) + Write for me colour: only the picked cover is saved (event + Materials), daily cap', { skip, timeout: 120000 }, async () => {
  const mock = mockReplicate();
  await new Promise((r) => mock.srv.listen(0, '127.0.0.1', r));
  const s = await boot({ REPLICATE_API_TOKEN: 'r8_test_token', REPLICATE_API_BASE: `http://127.0.0.1:${mock.srv.address().port}/v1`, AI_COVER_DAILY_LIMIT: '2', AI_COVER_OPTIONS: '2', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cov-')) });
  const db = require('../db');
  try {
    const c = client(s.base); const me = signupPayload(); await c.post('/api/signup', me);
    assert.equal((await client(s.base).post('/api/covers/generate', { title: 'x' })).status, 401);
    const cfg = await (await fetch(s.base + '/api/config')).json();
    assert.deepEqual(cfg.covers, { enabled: true, dailyLimit: 2, options: 2 });
    const quota = await c.get('/api/covers/config');
    assert.equal(quota.status, 200);
    assert.equal(quota.body.enabled, true);
    assert.equal(quota.body.dailyLimit, 2);
    assert.equal(quota.body.left, 2);
    assert.equal(quota.body.used, 0);
    const beforeGen = mock.calls.filter((x) => x.url.includes('flux-schnell')).length;
    assert.equal(beforeGen, 0, 'nothing is generated without a generate click / POST');

    const w = await c.post('/api/ai/title', { notes: 'A seminar on animal protection for young people in Lagos next Friday at 6pm at the Civic Centre', category: 'seminar', tzOffset: -60, now: '2026-11-15T04:00:00Z' });
    assert.equal(w.status, 200);
    assert.match(w.body.theme.accent, /^#[0-9a-f]{6}$/);
    assert.ok(['Emerald', 'Teal', 'Ocean'].includes(w.body.theme.name), w.body.theme.name);
    assert.equal(w.body.start, '2026-11-20T18:00', 'date pulled out of free text');
    assert.equal(w.body.hasTime, true);
    assert.match(w.body.venue || '', /Civic Centre/i);
    assert.equal(w.body.category, 'seminar');
    // thin / empty notes still get a response (the overlay decides whether to call), but not the old placeholder title
    const thin = await c.post('/api/ai/title', { notes: 'Talk shows', category: 'talk_show' });
    assert.equal(thin.status, 200);
    assert.doesNotMatch(thin.body.title || '', /Conversations on Category/i);

    const g = await c.post('/api/covers/generate', { title: 'A seminar on animal protection', category: 'seminar', accent: '#059669', accent2: '#0891b2' });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(g.body.options.length, 2); assert.equal(g.body.left, 1);
    assert.equal((await c.get('/api/covers/config')).body.left, 1);
    const input = mock.calls.find((x) => x.url.includes('flux-schnell')).body.input;
    assert.equal(input.aspect_ratio, '16:9'); assert.equal(input.num_outputs, 2); assert.equal(input.output_format, 'webp');
    assert.match(input.prompt, /animal protection/); assert.match(input.prompt, /no text/);

    const prev = await fetch(s.base + g.body.options[0].url, { headers: { cookie: c.jar.header() } });
    assert.equal(prev.status, 200); assert.equal(prev.headers.get('content-type'), 'image/webp');
    const other = client(s.base); await other.post('/api/signup', signupPayload());
    assert.equal((await fetch(s.base + g.body.options[0].url, { headers: { cookie: other.jar.header() } })).status, 404, 'previews are private');

    const uid = (await db.q('SELECT id FROM users WHERE username=$1', [me.username])).rows[0].id;
    assert.equal(Number((await db.q("SELECT COUNT(*) AS count FROM files WHERE owner_user_id=$1", [uid])).rows[0].count), 0, 'nothing stored before a pick');
    const pick = await c.post('/api/covers/pick', { token: g.body.options[1].token, title: 'A seminar on animal protection' });
    assert.equal(pick.status, 200, JSON.stringify(pick.body));
    assert.match(pick.body.url, /^\/files\/[\w-]+\/cover-a-seminar-on-animal-protection\.webp$/);
    assert.equal(Number((await db.q("SELECT COUNT(*) AS count FROM files WHERE owner_user_id=$1 AND purpose='cover'", [uid])).rows[0].count), 1, 'only the picked one');
    const mats = (await c.get('/api/materials')).body.materials;
    const m = mats.find((x) => x.id === pick.body.materialId);
    assert.ok(m && m.kind === 'image' && m.title.startsWith('Cover · '));
    assert.equal((await c.post('/api/covers/pick', { token: g.body.options[1].token })).status, 404, 'one-time token');
    const img = await fetch(s.base + pick.body.url);
    assert.equal(img.status, 200); assert.deepEqual(Buffer.from(await img.arrayBuffer()), mock.img);

    const ev = await c.post('/api/events', { title: 'A seminar on animal protection', category: 'seminar', coverUrl: pick.body.url, theme: { accent: w.body.theme.accent, accent2: w.body.theme.accent2 } });
    assert.ok(ev.status === 200 || ev.status === 201, JSON.stringify(ev.body));
    assert.equal(ev.body.coverUrl, pick.body.url); assert.equal(ev.body.theme.accent, w.body.theme.accent);

    assert.equal((await c.post('/api/covers/generate', { title: 'again' })).status, 200);
    const cap = await c.post('/api/covers/generate', { title: 'third' });
    assert.equal(cap.status, 429); assert.match(cap.body.error, /2 covers today/);
  } finally { await s.stop(); mock.srv.close(); }
});

test('promotions: admin picks, 3 per sidebar, dates respected, views/clicks counted; Books API + legacy alias', { skip, timeout: 120000 }, async () => {
  const admin = signupPayload();
  const s = await boot({ ADMIN_EMAILS: admin.email });
  try {
    const c = client(s.base);
    await c.post('/api/signup', admin);
    await c.post('/api/auth/verify-email', { token: tokenOf(await s.mailLink(admin.email, /Confirm your email/)) });
    assert.equal((await c.get('/api/session')).body.user.isAdmin, true);
    const u = client(s.base); await u.post('/api/signup', signupPayload());
    // the test DB is shared across runs: pause promotions left over from earlier runs so counts are exact
    for (const old of (await c.get('/api/admin/promotions')).body.promotions.filter((x) => x.active)) await c.patch(`/api/admin/promotions/${old.id}`, { active: false });

    const evs = [];
    for (let i = 0; i < 4; i++) evs.push((await c.post('/api/events', { title: `Promo event ${i} ${Date.now()}`, category: 'seminar', visibility: 'public', startsAt: new Date(Date.now() + 864e5).toISOString() })).body);
    const priv = (await c.post('/api/events', { title: `Private ${Date.now()}`, category: 'meeting', visibility: 'private' })).body;
    const post = (await c.post('/api/posts', { body: 'Come to our conference!' })).body;

    assert.equal((await u.post('/api/admin/promotions', { type: 'event', targetId: evs[0].id })).status, 403);
    assert.equal((await u.get('/api/admin/promotions')).status, 403);
    assert.equal((await c.post('/api/admin/promotions', { type: 'event', targetId: priv.id })).status, 400, 'private events cannot be promoted');
    const cand = await c.get('/api/admin/promotions/candidates?type=event&q=Promo%20event');
    assert.ok(cand.body.items.length >= 4);

    const made = [];
    for (const e of evs) { const r = await c.post('/api/admin/promotions', { type: 'event', targetId: e.id, placements: ['discover', 'books'] }); assert.equal(r.status, 201, JSON.stringify(r.body)); made.push(r.body); }
    const pp = await c.post('/api/admin/promotions', { type: 'post', targetId: post.id, placements: ['feed'] });
    assert.equal(pp.status, 201);
    const future = await c.post('/api/admin/promotions', { type: 'event', targetId: evs[0].id, placements: ['venues'], startsAt: new Date(Date.now() + 7 * 864e5).toISOString() });
    assert.equal(future.status, 201);
    assert.equal((await c.post('/api/admin/promotions', { type: 'event', targetId: evs[0].id, startsAt: '2027-01-02', endsAt: '2027-01-01' })).status, 400);

    const d = await fetch(s.base + '/api/promotions?placement=discover').then((r) => r.json());
    assert.equal(d.items.length, 3, '3 per sidebar');
    assert.ok(d.items.every((x) => x.type === 'event' && x.event.slug && x.event.title));
    const f = await fetch(s.base + '/api/promotions?placement=feed').then((r) => r.json());
    assert.ok(f.items.length === 1 && f.items.every((x) => x.type === 'post'), 'feed placement only gets the post');
    assert.ok(f.items.some((x) => x.id === pp.body.id && x.post.body === 'Come to our conference!'));
    const ven = await fetch(s.base + '/api/promotions?placement=venues').then((r) => r.json());
    assert.ok(!ven.items.some((x) => x.id === future.body.id), 'not started yet');
    assert.equal((await fetch(s.base + '/api/promotions?placement=nope')).status, 400);

    await fetch(s.base + '/api/promotions/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [made[0].id, made[1].id, made[0].id] }) });
    await fetch(`${s.base}/api/promotions/${made[0].id}/click`, { method: 'POST' });
    const pause = await fetch(`${s.base}/api/admin/promotions/${made[1].id}`, { method: 'PATCH', headers: { cookie: c.jar.header(), 'content-type': 'application/json' }, body: JSON.stringify({ active: false }) });
    assert.equal(pause.status, 200);
    const list = (await c.get('/api/admin/promotions')).body.promotions;
    const p0 = list.find((x) => x.id === made[0].id); const p1 = list.find((x) => x.id === made[1].id);
    assert.equal(p0.views, 1); assert.equal(p0.clicks, 1); assert.equal(p1.views, 1); assert.equal(p1.active, false); assert.equal(p1.live, false);
    const books = await fetch(s.base + '/api/promotions?placement=books').then((r) => r.json());
    assert.equal(books.items.length, 3);
    for (let i = 0; i < 20; i++) assert.ok(!(await fetch(s.base + '/api/promotions?placement=books').then((r) => r.json())).items.some((x) => x.id === made[1].id), 'paused never shows');
    assert.equal((await c.del(`/api/admin/promotions/${made[2].id}`)).status, 200);
    assert.equal((await c.del(`/api/admin/promotions/${made[2].id}`)).status, 404);

    // Books API: new prefix + legacy alias answer the same
    const a = await fetch(s.base + '/api/books/books').then((r) => r.json());
    const b = await fetch(s.base + '/api/bible/books').then((r) => r.json());
    assert.ok(a.books.length > 66); assert.deepEqual(a, b);
    const t1 = await fetch(s.base + '/api/books/translations').then((r) => r.json());
    assert.deepEqual(t1, await fetch(s.base + '/api/bible/translations').then((r) => r.json()));
  } finally { await s.stop(); }
});
