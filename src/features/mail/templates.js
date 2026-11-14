/**
 * Branded transactional emails: each template returns { subject, text, html }.
 * Plain text is the source of truth; HTML is a simple, table-free card that renders in Gmail,
 * Outlook and phone mail apps. Every value is escaped.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ app, url, title, intro, button, link, outro }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;margin:0 0 16px"><span style="color:#2563eb">●</span> ${esc(app)}</div>
  <div style="background:#ffffff;border-radius:16px;padding:28px 24px;box-shadow:0 1px 3px rgba(15,23,42,.08)">
    <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
    <p style="font-size:15px;line-height:1.55;margin:0 0 20px;color:#334155">${esc(intro)}</p>
    ${button ? `<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(button)}</a></p>
    <p style="font-size:12px;line-height:1.5;color:#64748b;margin:0 0 16px;word-break:break-all">Or paste this link into your browser:<br>${esc(link)}</p>` : ''}
    ${outro ? `<p style="font-size:13px;line-height:1.5;color:#64748b;margin:0">${esc(outro)}</p>` : ''}
  </div>
  <p style="font-size:12px;color:#94a3b8;margin:16px 4px 0">${esc(app)}${url ? ` · <a href="${esc(url)}" style="color:#94a3b8">${esc(url.replace(/^https?:\/\//, ''))}</a>` : ''}</p>
</div></body></html>`;
  const text = [title, '', intro, ...(button ? ['', `${button}: ${link}`] : []), ...(outro ? ['', outro] : []), '', `— ${app}${url ? ' ' + url : ''}`].join('\n');
  return { subject: title, text, html };
}

const T = {
  verify: (d) => layout({ ...d, title: `Confirm your email for ${d.app}`, intro: `Hi ${d.name || 'there'}, please confirm that this is your email address.`, button: 'Confirm email', link: d.link, outro: `This link expires in ${d.expires}. If you didn't create an account, you can ignore this email.` }),
  reset: (d) => layout({ ...d, title: `Reset your ${d.app} password`, intro: `Someone (hopefully you) asked to reset the password for this email address.`, button: 'Choose a new password', link: d.link, outro: `This link works once and expires in ${d.expires}. Resetting signs you out on every device. If you didn't ask for this, ignore this email; your password stays the same.` }),
  welcome: (d) => layout({ ...d, title: `Welcome to ${d.app}`, intro: `Hi ${d.name || 'there'}, your account is ready. Host events and meetings, join rooms, and keep your sessions in one place.`, button: `Open ${d.app}`, link: d.link }),
  setPassword: (d) => layout({ ...d, title: `Set a password for ${d.app}`, intro: `Your ${d.app} account doesn't have a password yet. Your account and everything in it are here; choose a password to sign in (or use "Continue with Google" with this same email).`, button: 'Set my password', link: d.link, outro: `This link works once and expires in ${d.expires}. If you didn't ask for this, you can ignore this email.` }),
  accountExists: (d) => layout({ ...d, title: `You already have a ${d.app} account`, intro: 'Someone tried to create a new account with this email address, but it already has one. If that was you, sign in, or reset your password if you have forgotten it.', button: 'Sign in', link: d.link, outro: "If it wasn't you, you can ignore this email. Nothing has changed." }),
  emailChanged: (d) => layout({ ...d, title: `Your ${d.app} email is changing`, intro: `A request was made to change the email on your account to ${d.newEmail}. The change takes effect once the new address is confirmed.`, outro: 'If this was not you, reset your password right away; that also signs out every device.' }),
};

function render(kind, data) {
  const fn = T[kind];
  if (!fn) throw new Error('Unknown email template: ' + kind);
  return fn(data);
}

module.exports = { render, kinds: Object.keys(T), esc };
