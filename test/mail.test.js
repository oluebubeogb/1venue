'use strict';
// Mail feature: templates, SMTP transport (mocked), console fallback when SMTP is unset.
const test = require('node:test');
const assert = require('node:assert/strict');

const mailer = require('../src/features/mail/mailer');
const { render, kinds } = require('../src/features/mail/templates');

test('every template has subject, text and escaped HTML with the link', () => {
  for (const k of kinds) {
    const m = render(k, { app: '1venue', url: 'https://1venue.example.com', name: '<b>Ada</b>', link: 'https://1venue.example.com/x?t=a&b=1', expires: '1 hour', newEmail: 'n@ex.test' });
    assert.ok(m.subject && m.text && m.html, k);
    assert.ok(!m.html.includes('<b>Ada</b>'), k + ': name is escaped');
    if (k !== 'emailChanged') {
      assert.ok(m.text.includes('https://1venue.example.com/x?t=a&b=1'), k + ': text has the raw link');
      assert.ok(m.html.includes('https://1venue.example.com/x?t=a&amp;b=1'), k + ': html has the escaped link');
    }
  }
});

test('send() uses the transport with from/to/subject/text/html', async () => {
  const sent = [];
  mailer._setTransport({ sendMail: async (m) => { sent.push(m); return { messageId: 'm1' }; } });
  try {
    const r = await mailer.send('reset', 'ada@ex.test', { link: 'https://app/reset?token=abc', expires: '1 hour' });
    assert.deepEqual(r, { sent: true, id: 'm1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ada@ex.test');
    assert.match(sent[0].subject, /Reset your .* password/);
    assert.match(sent[0].text, /https:\/\/app\/reset\?token=abc/);
    assert.match(sent[0].html, /<a href="https:\/\/app\/reset\?token=abc"/);
    assert.ok(sent[0].from);
  } finally { mailer._setTransport(null); }
});

test('send() never throws when SMTP fails', async () => {
  mailer._setTransport({ sendMail: async () => { throw Object.assign(new Error('auth failed'), { code: 'EAUTH' }); } });
  const orig = console.error; const logs = []; console.error = (...a) => logs.push(a.join(' '));
  try {
    const r = await mailer.send('verify', 'ada@ex.test', { link: 'https://app/verify?token=secret123', expires: '2 days' });
    assert.deepEqual(r, { sent: false, reason: 'error' });
    assert.ok(!logs.join('\n').includes('secret123'), 'links are not logged on failure');
  } finally { console.error = orig; mailer._setTransport(null); }
});

test('real nodemailer message is built (stream transport, nothing sent)', async () => {
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  mailer._setTransport(t);
  try {
    const orig = t.sendMail.bind(t); let raw = '';
    t.sendMail = async (m) => { const info = await orig(m); raw = info.message.toString(); return info; };
    const r = await mailer.send('welcome', 'ada@ex.test', { name: 'Ada', link: 'https://1venue.example.com/' });
    assert.equal(r.sent, true);
    assert.match(raw, /^To: ada@ex\.test$/m);
    assert.match(raw, /multipart\/alternative/);
  } finally { mailer._setTransport(null); }
});

test('without SMTP_HOST: links are printed outside production, hidden in production', async () => {
  const saved = { SMTP_HOST: process.env.SMTP_HOST, NODE_ENV: process.env.NODE_ENV, MAIL_LOG_LINKS: process.env.MAIL_LOG_LINKS };
  delete process.env.SMTP_HOST; delete process.env.MAIL_LOG_LINKS;
  const out = []; const ol = console.log; const ow = console.warn;
  console.log = (...a) => out.push(a.join(' ')); console.warn = (...a) => out.push(a.join(' '));
  try {
    process.env.NODE_ENV = 'development';
    assert.equal((await mailer.send('verify', 'ada@ex.test', { link: 'https://x/verify?token=dev1', expires: '2 days' })).reason, 'not-configured');
    assert.ok(out.some((l) => l.includes('link=https://x/verify?token=dev1')));
    out.length = 0;
    process.env.NODE_ENV = 'production';
    await mailer.send('reset', 'ada@ex.test', { link: 'https://x/reset?token=prod1', expires: '1 hour' });
    assert.ok(!out.join('\n').includes('prod1'), 'no live reset links in production logs');
    assert.ok(out.some((l) => /SMTP not configured/.test(l) && l.includes('a***@ex.test')));
  } finally {
    console.log = ol; console.warn = ow;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
