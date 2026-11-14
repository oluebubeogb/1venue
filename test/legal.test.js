'use strict';
// Public legal pages must be reachable without auth or a database.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { serveStatic } = require('../src/http/static');

test('GET /privacy and /terms return 200 text/html without auth', async () => {
  const srv = http.createServer((req, res) => serveStatic(req, res, new URL(req.url, 'http://127.0.0.1').pathname));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const p of ['/privacy', '/terms', '/privacy.html', '/terms.html', '/privacy/']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type') || '', /text\/html/, p);
      const body = await r.text();
      assert.match(body, /1venue/, p);
      assert.match(body, /legal@1venue\.live/, p);
      assert.doesNotMatch(body, /1venue needs JavaScript to run/, p + ' must not be the SPA shell');
    }
    const privacy = await (await fetch(base + '/privacy')).text();
    const terms = await (await fetch(base + '/terms')).text();
    assert.match(privacy, /Privacy policy/);
    assert.match(privacy, /Google API Services User Data Policy/);
    assert.match(terms, /Terms of service/);
    assert.match(terms, /Federal Republic of Nigeria/);
    // Extensionless app routes still fall back to the SPA shell
    const spa = await fetch(base + '/discover');
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /1venue needs JavaScript to run/);
  } finally {
    srv.close();
  }
});
