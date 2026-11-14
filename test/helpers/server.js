'use strict';
// Boot a real 1venue server for an integration test, capture its output (mail links are
// printed there when SMTP is not configured), and stop it cleanly.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

async function boot(env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'test-secret', PUBLIC_URL: base, AI_MOCK: 'true', METRICS_LOG: 'false', NODE_ENV: 'test', BCRYPT_COST: '4', AUTH_RATE_PER_MIN: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch {}
    if (child.exitCode !== null) throw new Error('server exited: ' + out);
    await new Promise((r) => setTimeout(r, 250));
  }
  const stop = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode) return resolve(); child.once('exit', resolve); child.kill(); });
  /** Wait for a "[mail]" console line to `to` (optionally matching subject) and return its link. */
  async function mailLink(to, subjectRe = /./, { after = 0, timeout = 5000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const lines = out.slice(after).split('\n').filter((l) => l.startsWith('[mail]') && l.includes(`to=${to} `));
      const hit = lines.reverse().find((l) => subjectRe.test(l));
      if (hit) { const m = / link=(\S+)/.exec(hit); return m ? m[1] : ''; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }
  return { base, port, child, stop, output: () => out, mark: () => out.length, mailLink };
}

/** Minimal cookie jar for fetch(). */
function jar() {
  const c = new Map();
  return {
    header: () => [...c].map(([k, v]) => `${k}=${v}`).join('; '),
    take(res) {
      for (const sc of res.headers.getSetCookie()) {
        const [pair] = sc.split(';'); const i = pair.indexOf('=');
        const k = pair.slice(0, i); const v = pair.slice(i + 1);
        if (/Max-Age=0/.test(sc) || v === '') c.delete(k); else c.set(k, v);
      }
      return res;
    },
    get: (k) => c.get(k), set: (k, v) => c.set(k, v), delete: (k) => c.delete(k), clone() { const j = jar(); for (const [k, v] of c) j.set(k, v); return j; },
  };
}

function client(base, j = jar()) {
  const call = async (method, p, body, extra = {}) => {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: { cookie: j.header(), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    j.take(res);
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, body: json, res };
  };
  return { jar: j, get: (p, h) => call('GET', p, null, h), post: (p, b, h) => call('POST', p, b || {}, h), del: (p) => call('DELETE', p) };
}

/** Unique, valid local-signup body (username + Nigerian E.164 phone). Extra overrides any field. */
function signupPayload(extra = {}) {
  const username = extra.username !== undefined ? extra.username : ('u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 30);
  return {
    username,
    email: extra.email || `${username || 'u' + Date.now().toString(36)}@ex.test`,
    password: extra.password || 'Passw0rd!long',
    phone: extra.phone !== undefined ? extra.phone : '+2348031234567',
    country: extra.country !== undefined ? extra.country : 'NG',
    ...extra,
  };
}

module.exports = { boot, jar, client, freePort, signupPayload };

