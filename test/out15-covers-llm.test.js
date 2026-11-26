'use strict';
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('out15 AI calls and cover library', () => {
  it('does not label non-429 Replicate errors as busy', () => {
    const { messageFor } = require('../src/lib/replicate');
    assert.match(messageFor(429), /busy/);
    assert.doesNotMatch(messageFor(404), /busy/i);
    assert.doesNotMatch(messageFor(422), /busy/i);
    assert.doesNotMatch(messageFor(502), /busy/i);
    assert.doesNotMatch(messageFor(504), /busy/i);
    assert.match(messageFor(404), /model/i);
  });

  it('remaps the retired Llama 3 70B default to Llama 4 Scout', () => {
    const { resolveLlm, DEFAULT_LLM, llmInput } = require('../src/lib/replicate');
    assert.equal(DEFAULT_LLM, 'meta/llama-4-scout-instruct');
    assert.equal(resolveLlm('meta/meta-llama-3-70b-instruct'), DEFAULT_LLM);
    assert.equal(resolveLlm('meta/llama-4-scout-instruct'), 'meta/llama-4-scout-instruct');
    assert.equal(resolveLlm('my/org-model'), 'my/org-model');
    const input = llmInput({ prompt: 'Hi', system: 'Be brief', maxTokens: 400, temperature: 0.4 });
    assert.equal(input.prompt, 'Hi');
    assert.equal(input.system_prompt, 'Be brief');
    assert.equal(input.max_tokens, 400);
  });

  it('polls the same prediction after Prefer: wait and retries 429 with a new create', async () => {
    const { run } = require('../src/lib/replicate');
    const hits = [];
    const srv = http.createServer((req, res) => {
      const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      hits.push(req.method + ' ' + req.url);
      if (req.method === 'POST' && req.url === '/v1/models/test/mod/predictions') {
        const n = hits.filter((x) => x.startsWith('POST /v1/models')).length;
        if (n === 1) return json(429, { detail: 'rate limited' });
        return json(201, { id: 'p1', status: 'starting', urls: { get: `http://127.0.0.1:${srv.address().port}/v1/predictions/p1` } });
      }
      if (req.method === 'GET' && req.url === '/v1/predictions/p1') {
        return json(200, { id: 'p1', status: 'succeeded', output: 'ok', metrics: {} });
      }
      json(404, {});
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${srv.address().port}/v1`;
      const out = await run({ token: 't', apiBase: base, model: 'test/mod', input: { prompt: 'x' }, timeoutMs: 8000, tag: 'test', wait: 1, retries: 2 });
      assert.equal(out.output, 'ok');
      assert.equal(out.id, 'p1');
      assert.equal(hits.filter((x) => x.startsWith('POST /v1/models')).length, 2, 'one 429 then one create');
      assert.ok(hits.includes('GET /v1/predictions/p1'), 'polls the same id');
    } finally { srv.close(); }
  });

  it('category clash and reuse attempts, and cover prompt leads with the scene', () => {
    const lib = require('../src/features/covers/library');
    assert.equal(lib.categoryClash('sermon', 'concert'), true);
    assert.equal(lib.categoryClash('seminar', 'webinar'), false);
    assert.equal(lib.cosine([1, 0], [1, 0]), 1);
    assert.ok(lib.cosine([1, 0], [0, 1]) < 0.1);
    const scored = [
      { row: { id: 1 }, score: 0.95 },
      { row: { id: 2 }, score: 0.9 },
      { row: { id: 3 }, score: 0.7 },
    ];
    assert.equal(lib.pickReuse({ attempt: 1, scored, threshold: 0.85, excludeIds: [] }).row.id, 1);
    assert.equal(lib.pickReuse({ attempt: 2, scored, threshold: 0.85, excludeIds: [1] }).row.id, 2);
    assert.equal(lib.pickReuse({ attempt: 3, scored, threshold: 0.85, excludeIds: [] }), null);
    const { coverPrompt } = require('../src/features/covers/prompt');
    const p = coverPrompt({ title: 'Music as Inner Peace', category: 'talk_show', scene: 'a young person with headphones, eyes closed' });
    assert.match(p, /young person with headphones/);
    assert.doesNotMatch(p, /lounge chairs/i);
    assert.match(p, /Mood and lighting only/);
  });

  it('rejects empty or oversized turn audio and keeps slash-free data URIs', () => {
    const { decodeTurnAudio } = require('../src/features/messages/ai-calls');
    assert.equal(decodeTurnAudio('', 'audio/webm'), null);
    const small = Buffer.from('abcd').toString('base64');
    assert.equal(decodeTurnAudio(small, 'audio/webm').buf.toString(), 'abcd');
    const uri = 'data:audio/webm;base64,' + small;
    assert.equal(decodeTurnAudio(uri).mime, 'audio/webm');
    assert.throws(() => decodeTurnAudio(Buffer.alloc(5 * 1048576), 'audio/webm'), /too large/);
  });

  it('UI shows From library or New, Regenerate, one image, and a one-moment filler', () => {
    const create = read('public/js/pages/create.js');
    assert.match(create, /coverAttempt/);
    assert.match(create, /From library/);
    assert.match(create, /'New'/);
    assert.match(create, /Regenerate/);
    assert.match(create, /attempt: coverAttempt/);
    assert.doesNotMatch(create, /options \|\| 2/);
    const css = read('public/css/src/20-pages/create.css');
    assert.match(css, /\.cover-src \{/);
    assert.match(read('public/css/app.css'), /\.cover-src \{/);
    const call = read('public/js/messages/call.js');
    assert.match(call, /One moment/);
    assert.match(call, /timeoutMs: 25000/);
    assert.match(read('public/js/ui.js'), /timeoutMs/);
  });

  it('bumps the cache versions and default models', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
    assert.match(read('src/config.js'), /ideogram-ai\/ideogram-v3-turbo/);
    assert.match(read('src/config.js'), /AI_EMBED_MODEL/);
    assert.match(read('src/config.js'), /AI_COVER_REUSE_MIN/);
    assert.match(read('src/lib/replicate.js'), /llama-4-scout-instruct/);
  });
});
