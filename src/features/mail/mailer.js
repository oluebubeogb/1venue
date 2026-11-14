/**
 * SMTP mailer. Settings (all env):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for port 465), SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_REPLY_TO
 * Without SMTP_HOST nothing is sent: outside production the message (with its link) is printed
 * to the console so local sign-up / reset can be tested; in production only a warning is logged
 * (never the link, which would put live reset links in logs) unless MAIL_LOG_LINKS=true.
 */
const config = require('../../config');
const { render } = require('./templates');

const env = config.env;
function settings() {
  const port = parseInt(env('SMTP_PORT', '587'), 10) || 587;
  const appName = config.APP_NAME || '1venue';
  return {
    host: env('SMTP_HOST', ''),
    port,
    secure: config.bool('SMTP_SECURE', port === 465),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('MAIL_FROM', `${appName} <no-reply@${hostOf(config.PUBLIC_URL) || 'localhost'}>`),
    replyTo: env('MAIL_REPLY_TO', ''),
    logLinks: config.bool('MAIL_LOG_LINKS', process.env.NODE_ENV !== 'production'),
  };
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

let transport = null; // lazily created; tests can swap it with _setTransport()
function getTransport(s) {
  if (transport) return transport;
  if (!s.host) return null;
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
  return transport;
}

const configured = () => !!(transport || settings().host);

/**
 * Send a templated email. Returns { sent, id } or { sent: false, reason }. Never throws.
 * data.link is the action URL; app/url are filled in from config.
 */
async function send(kind, to, data = {}) {
  const s = settings();
  const msg = render(kind, { app: config.APP_NAME || '1venue', url: config.PUBLIC_URL || '', ...data });
  const t = getTransport(s);
  if (!t) {
    if (s.logLinks) console.log(`[mail] (SMTP not configured) to=${to} subject="${msg.subject}"${data.link ? ' link=' + data.link : ''}`);
    else console.warn(`[mail] SMTP not configured; "${kind}" email to ${String(to).replace(/^(.).*(@.*)$/, '$1***$2')} was not sent`);
    return { sent: false, reason: 'not-configured' };
  }
  try {
    const info = await t.sendMail({ from: s.from, to, replyTo: s.replyTo || undefined, subject: msg.subject, text: msg.text, html: msg.html });
    return { sent: true, id: info && info.messageId };
  } catch (e) {
    console.error('[mail] send failed:', kind, e.code || '', e.message); // never logs credentials or links
    return { sent: false, reason: 'error' };
  }
}

/** Fire and forget, so response time doesn't reveal whether an email went out. */
function sendLater(kind, to, data) { setImmediate(() => { send(kind, to, data).catch(() => {}); }); }

/** Check the SMTP connection (used at boot when configured). */
async function verify() {
  const s = settings();
  const t = getTransport(s);
  if (!t || typeof t.verify !== 'function') return false;
  try { await t.verify(); console.log(`[mail] SMTP ready (${s.host}:${s.port})`); return true; } catch (e) { console.warn('[mail] SMTP check failed:', e.code || '', e.message); return false; }
}

module.exports = { send, sendLater, verify, configured, settings, _setTransport: (t) => { transport = t; } };
