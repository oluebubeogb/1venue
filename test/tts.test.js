'use strict';
// Text-to-speech feature against a mocked Replicate API (no network, no cost).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { allowedLanguages, normLang, DOCUMENTED } = require('../src/features/tts/languages');

test('language allowlist: documented list, aliases, env override', () => {
  const langs = allowedLanguages('');
  for (const c of ['en', 'ar', 'ha', 'ig', 'sw', 'fr', 'pt', 'de', 'es']) assert.ok(langs.includes(c), c);
  assert.ok(!langs.includes('yo'), 'Yorùbá is not in Google’s list for this model');
  assert.ok(DOCUMENTED.length >= 120);
  assert.equal(normLang('ar-EG'), 'ar');
  assert.equal(normLang('HA_NG'), 'ha');
  assert.equal(normLang('tl'), 'fil');
  assert.deepEqual(allowedLanguages('en, ig ,ha-NG,ar,bad-lang-tag,!!'), ['en', 'ig', 'ha', 'ar', 'bad']);
});

const freePort = () => new Promise((resolve, reject) => {
  const srv = require('node:net').createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const stop = (child) => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode) return resolve(); child.once('exit', resolve); child.kill(); });
const skip = !process.env.DATABASE_URL ? 'set DATABASE_URL' : false;

function mockReplicate() {
  const calls = [];
  const audio = Buffer.from('ID3' + 'x'.repeat(2000));
  let slowNext = false;
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const base = `http://127.0.0.1:${srv.address().port}`;
    calls.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1/models/google/gemini-3.8-flash-tts/predictions') {
      if (req.headers.authorization !== 'Bearer r8_test_token') return json(401, { detail: 'Invalid token' });
      if (slowNext) { slowNext = false; return json(201, { id: 'p2', status: 'starting', urls: { get: `${base}/v1/predictions/p2` } }); }
      return json(201, { id: 'p1', status: 'succeeded', output: `${base}/out/p1.mp3` });
    }
    if (req.method === 'GET' && req.url === '/v1/predictions/p2') return json(200, { id: 'p2', status: 'succeeded', output: `${base}/out/p2.mp3` });
    if (req.method === 'GET' && req.url.startsWith('/out/')) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length }); return res.end(audio); }
    json(404, { detail: 'not found' });
  });
  return { srv, calls, audio, slow: () => { slowNext = true; } };
}

test('POST /api/tts: auth, language gating, caching, limits, polling (mock Replicate)', { skip }, async () => {
  const mock = mockReplicate();
  await new Promise((r) => mock.srv.listen(0, '127.0.0.1', r));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'test-secret', PUBLIC_URL: base, AI_MOCK: 'true', METRICS_LOG: 'false',
      STORAGE_DRIVER: 'local', STORAGE_DIR: storeDir, REPLICATE_API_TOKEN: 'r8_test_token', REPLICATE_API_BASE: `http://127.0.0.1:${mock.srv.address().port}/v1`,
      TTS_RATE_PER_MIN: '4', TTS_MAX_CHARS: '200', TTS_LANGUAGES: '' },
    stdio: 'ignore',
  });
  const n = ' ' + Date.now().toString(36); // texts are unique per run: the cache lives in the database
  const post = (body, headers = {}) => fetch(base + '/api/tts', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

    const cfgRes = await fetch(base + '/api/tts/config');
    const cfgText = await cfgRes.text();
    assert.ok(!cfgText.includes('r8_test_token'), 'token never sent to the browser');
    const cfg = JSON.parse(cfgText);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.model, 'google/gemini-3.8-flash-tts');
    assert.equal(cfg.maxChars, 200);
    for (const c of ['ig', 'ha', 'ar', 'en']) assert.ok(cfg.languages.includes(c), c);
    assert.ok(!cfg.languages.includes('yo'));

    assert.equal((await post({ text: 'Ndewo', lang: 'ig' })).status, 401, 'anonymous outside a room');

    const u = 't' + Date.now().toString(36);
    const su = await fetch(base + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, email: `${u}@ex.test`, password: 'Passw0rd!long' }) });
    const cookie = su.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

    const yo = await post({ text: 'Ní àtètèkọ́ṣe', lang: 'yo' }, { cookie });
    assert.equal(yo.status, 400);
    assert.match((await yo.json()).error, /not available for this language/);
    assert.equal((await post({ text: 'Hello', lang: '' }, { cookie })).status, 400, 'unknown language');
    assert.equal((await post({ text: 'x'.repeat(201), lang: 'en' }, { cookie })).status, 413);
    assert.equal(mock.calls.length, 0, 'rejected requests never reach Replicate');

    const r1 = await post({ text: '  Na mmalite, Chineke kere  eluigwe na ụwa. ' + n, lang: 'ig-NG' }, { cookie });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.cached, false);
    assert.match(j1.url, /^\/files\/[\w-]+\/tts-[0-9a-f]{16}\.mp3$/);
    const create = mock.calls.find((c) => c.method === 'POST');
    assert.equal(create.headers.authorization, 'Bearer r8_test_token');
    assert.equal(create.headers.prefer, 'wait=60');
    assert.deepEqual(create.body, { input: { text: 'Na mmalite, Chineke kere eluigwe na ụwa.' + n, voice: 'Kore', output_format: 'mp3' } });
    const audio = await fetch(base + j1.url);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), mock.audio);

    // same text (whitespace-normalised, same language) -> cache hit, no new prediction
    const before = mock.calls.length;
    const j2 = await (await post({ text: 'Na mmalite, Chineke kere eluigwe na ụwa.' + n, lang: 'ig' }, { cookie })).json();
    assert.equal(j2.cached, true);
    assert.equal(j2.url, j1.url);
    assert.equal(mock.calls.length, before);

    // a still-running prediction is polled until it succeeds
    mock.slow();
    const j3 = await (await post({ text: 'Allah ya albarkace ka' + n, lang: 'ha', voice: 'Puck' }, { cookie })).json();
    assert.equal(j3.cached, false);
    assert.ok(mock.calls.some((c) => c.url === '/v1/predictions/p2'));
    assert.equal(mock.calls.filter((c) => c.method === 'POST').pop().body.input.voice, 'Puck');

    // rate limit counts new audio only (limit 4/min: 2 used above)
    assert.equal((await post({ text: 'بسم الله الرحمن الرحيم' + n, lang: 'ar' }, { cookie })).status, 200);
    assert.equal((await post({ text: 'Fourth new line' + n, lang: 'en' }, { cookie })).status, 200);
    assert.equal((await post({ text: 'Fifth new line' + n, lang: 'en' }, { cookie })).status, 429);
    assert.equal((await post({ text: 'Na mmalite, Chineke kere eluigwe na ụwa.' + n, lang: 'ig' }, { cookie })).status, 200, 'cache hits still work when rate-limited');

    // room participants (guests) can use it with their room credential
    const pid = 'host-tts-' + Date.now();
    const cr = await (await fetch(base + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'TTS room', participantName: 'Guest Host', participantId: pid }) })).json();
    const roomHeaders = { 'X-Room-Code': cr.code, 'X-Participant-Id': pid, 'X-Room-Credential': cr.wsCredential };
    const rr = await post({ text: 'Hello from the room' + n, lang: 'en' }, roomHeaders);
    assert.equal(rr.status, 200);
    // model directions in content (<tags>, |pipes|, /IPA/) are neutralised so text is read, not performed
    assert.equal((await post({ text: 'Ah <laugh> and/or |yes| /niːv/' + n, lang: 'en' }, roomHeaders)).status, 200);
    assert.equal(mock.calls.filter((c) => c.method === 'POST').pop().body.input.text, 'Ah laugh and or yes niːv' + n);
    assert.equal((await post({ text: 'Hello', lang: 'en' }, { ...roomHeaders, 'X-Room-Credential': 'forged' })).status, 401);
  } finally {
    await stop(child);
    mock.srv.close();
  }
});

test('POST /api/tts is 503 when REPLICATE_API_TOKEN is unset', { skip }, async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), JWT_SECRET: 'test-secret', REPLICATE_API_TOKEN: '', METRICS_LOG: 'false' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
    assert.equal((await (await fetch(base + '/api/tts/config')).json()).enabled, false);
    assert.equal((await fetch(base + '/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi","lang":"en"}' })).status, 503);
  } finally { await stop(child); }
});

// ---- browser-side language detection and gating (src/features/tts/client/lang.js, plain ES module)
async function langModule() {
  const src = fs.readFileSync(path.join(__dirname, '../src/features/tts/client/lang.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

test('client detectLang: metadata wins; only unambiguous scripts are guessed; Latin never', async () => {
  const { detectLang } = await langModule();
  assert.deepEqual(detectLang('Na mmalite Chineke kere eluigwe na ụwa', 'ig'), { lang: 'ig', source: 'metadata' });
  assert.deepEqual(detectLang('anything', 'ha-NG'), { lang: 'ha', source: 'metadata' });
  assert.deepEqual(detectLang('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'), { lang: 'ar', source: 'script' });
  assert.equal(detectLang('در آغاز خدا آسمان‌ها و زمین را آفرید').lang, 'fa');
  assert.equal(detectLang('ابتدا میں خدا نے آسمان اور زمین کو پیدا کیا۔').lang, 'ur');
  assert.equal(detectLang('בְּרֵאשִׁית בָּרָא אֱלֹהִים').lang, 'he');
  assert.equal(detectLang('太初有道，道与神同在').lang, 'zh');
  assert.equal(detectLang('はじめに神は天と地とを創造された').lang, 'ja');
  // Latin script (English, Igbo, Hausa, Yorùbá) and shared scripts are not guessed
  for (const t of ['In the beginning God created the heaven and the earth.', 'Na mmalite Chineke kere eluigwe na ụwa.',
    'A cikin farko Allah ya halicci sama da ƙasa.', 'Ní àtètèkọ́ṣe Ọlọ́run dá ọ̀run àti ayé.', 'В начале сотворил Бог небо и землю.', 'आदि में परमेश्वर ने आकाश और पृथ्वी की सृष्टि की।', '12 3']) {
    assert.equal(detectLang(t).lang, null, t);
  }
  assert.equal(detectLang('In the beginning, اللَّه').lang, null, 'mixed scripts below 60% are not guessed');
});

test('client chooseEngine: cloud for allowlisted languages, device voice only for an exact match, else hidden', async () => {
  const { chooseEngine } = await langModule();
  const cloud = { cloudEnabled: true, cloudLanguages: ['en', 'ar', 'ha', 'ig'], canUseCloud: true, browserLangs: ['en-US', 'fr-FR'] };
  assert.equal(chooseEngine('ig', cloud), 'cloud');
  assert.equal(chooseEngine('ar-SA', cloud), 'cloud');
  assert.equal(chooseEngine('fr', cloud), 'browser', 'not on the allowlist, but the device has a French voice');
  assert.equal(chooseEngine('yo', cloud), null, 'Yorùbá: no cloud support and no device voice -> hidden');
  assert.equal(chooseEngine(null, cloud), null);
  assert.equal(chooseEngine('ig', { ...cloud, canUseCloud: false }), null, 'signed-out visitor, no Igbo device voice -> hidden');
  assert.equal(chooseEngine('en', { ...cloud, cloudEnabled: false }), 'browser');
  assert.equal(chooseEngine('ha', { ...cloud, cloudEnabled: false, browserLangs: ['en-GB'] }), null, 'never an English voice for Hausa');
});
