// Settings → Account: email (verify / change), password (change / set), Google, devices, sign out.
import { icon } from '../icons.js';
import { h, api, toast, toastErr, sheet, confirmDlg, timeAgo } from '../ui.js';
import { logout, refreshSession, navigate } from '../app.js';
import { passwordInput, notice, GOOGLE_G, usernameField, phoneField } from './login.js';

function deviceName(ua) {
  const s = String(ua || '');
  const os = /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' on ') || 'Unknown device';
}

function formSheet({ title, ic, fields, submit, onSubmit, note }) {
  const s = sheet({ title, icon: ic, group: 'admin' });
  const msg = h('div', { class: 'auth-msg' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, submit);
  const form = h('form', { class: 'col', style: { gap: '.7rem' }, novalidate: true }, msg, ...fields, note ? h('p', { class: 'tiny faint', style: { margin: 0 } }, note) : null, btn);
  form.onsubmit = async (e) => {
    e.preventDefault(); msg.replaceChildren(); btn.disabled = true;
    try { await onSubmit(s, (k, t) => msg.replaceChildren(notice(k, t))); } catch (er) { if (er.status && er.status < 500) msg.replaceChildren(notice('error', er.message)); else toastErr(er); } finally { btn.disabled = false; }
  };
  s.body.append(form);
  return s;
}

export async function accountCard(card, row) {
  const box = h('div', { class: 'col', style: { gap: 0 } }, h('p', { class: 'tiny faint' }, 'Loading…'));
  const section = card('Account', 'user', box);
  section.id = 'account';
  const paint = async () => {
    let acc;
    try { acc = await api('/api/auth/account'); } catch (e) { box.replaceChildren(h('p', { class: 'small muted' }, e.message)); return; }
    const u = acc.user;
    const min = acc.passwordMin || 8;
    const verified = u.emailVerified;
    const chip = h('span', { class: 'chip', style: { '--g': verified ? '#059669' : '#d97706', color: 'var(--g)', fontSize: '.7rem', padding: '.1rem .45rem', minHeight: 0 } }, verified ? 'Confirmed' : 'Not confirmed');
    const resend = !verified ? h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await api('/api/auth/resend-verification', { method: 'POST' }); toast(r.message, { icon: 'mail' }); } catch (er) { toastErr(er); } } }, 'Resend link') : null;

    const changeUsername = () => {
      const field = usernameField({ value: u.username, current: u.username });
      formSheet({
        title: 'Change username', ic: 'user', submit: 'Save username',
        fields: [field.el],
        note: '3–30 characters. Lowercase letters, numbers, underscores or periods.',
        onSubmit: async (s) => {
          await api('/api/auth/change-username', { method: 'POST', body: { username: field.input.value.trim() } });
          s.close(); toast('Username saved', { icon: 'check' });
          await refreshSession(); paint();
        },
      });
    };
    const changePhone = () => {
      const field = phoneField({ required: true, value: u.phone || '', country: 'NG' });
      formSheet({
        title: u.phone ? 'Change phone number' : 'Add a phone number', ic: 'user', submit: 'Save phone number',
        fields: [field.el],
        note: 'Stored only as contact information for your account. We do not share it or use it for marketing.',
        onSubmit: async (s) => {
          const r = await api('/api/auth/change-phone', { method: 'POST', body: { phone: field.input.value.trim(), country: field.select.value } });
          s.close(); toast('Phone number saved', { icon: 'check' });
          u.phone = r.phone;
          paint();
        },
      });
    };
    const changeEmail = () => {
      const em = h('input', { class: 'input', type: 'email', placeholder: 'New email address', autocomplete: 'email', 'aria-label': 'New email' });
      const pw = passwordInput('Current password');
      formSheet({
        title: 'Change email', ic: 'mail', submit: 'Send confirmation link',
        fields: [em, ...(u.hasPassword ? [pw.el] : [])],
        note: 'We’ll email the new address. Your email changes once you open that link; your old address gets a notice.',
        onSubmit: async (s, show) => { const r = await api('/api/auth/change-email', { method: 'POST', body: { email: em.value.trim(), password: pw.input.value } }); show('info', r.message); },
      });
    };
    const changePassword = () => {
      const cur = passwordInput('Current password', 'current-password');
      const nw = passwordInput('New password', 'new-password');
      const nw2 = passwordInput('Repeat new password', 'new-password');
      formSheet({
        title: u.hasPassword ? 'Change password' : 'Set a password', ic: 'key', submit: 'Save password',
        fields: [...(u.hasPassword ? [cur.el] : []), nw.el, nw2.el],
        note: `At least ${min} characters. Other devices will be signed out.`,
        onSubmit: async (s, show) => {
          if (nw.input.value.length < min) return show('error', `Use at least ${min} characters.`);
          if (nw.input.value !== nw2.input.value) return show('error', 'The two passwords don’t match.');
          const r = await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur.input.value, newPassword: nw.input.value } });
          s.close(); toast(r.otherSessionsSignedOut ? `Password saved. ${r.otherSessionsSignedOut} other device(s) signed out.` : 'Password saved', { icon: 'check' });
          await refreshSession(); paint();
        },
      });
    };
    const google = acc.identities.find((i) => i.provider === 'google');
    const devices = h('div', { class: 'col', style: { gap: '.4rem' } });
    const loadDevices = async () => {
      try {
        const { sessions } = await api('/api/auth/sessions');
        devices.replaceChildren(...sessions.map((x) => h('div', { class: 'row session-row' },
          h('span', { class: 'faint', html: icon('laptop', { size: 18 }) }),
          h('div', { class: 'grow' },
            h('div', { class: 'small', style: { fontWeight: 600 } }, deviceName(x.userAgent), x.current ? h('span', { class: 'chip', style: { marginLeft: '.4rem', fontSize: '.7rem' } }, 'This device') : null),
            h('div', { class: 'tiny faint' }, `${x.method === 'google' ? 'Google · ' : ''}Active ${timeAgo(x.lastSeenAt)}${x.ip ? ' · ' + x.ip : ''}`)),
          x.current ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await api('/api/auth/sessions/' + x.id, { method: 'DELETE' }); toast('Signed out that device', { icon: 'logout' }); loadDevices(); } catch (er) { toastErr(er); } } }, 'Sign out'))));
      } catch (er) { devices.replaceChildren(h('p', { class: 'tiny muted' }, er.message)); }
    };
    const everywhere = async () => {
      if (!(await confirmDlg('Sign out on every device, including this one?', { ok: 'Sign out everywhere', danger: true }))) return;
      try { await api('/api/auth/logout-all', { method: 'POST' }); } catch (er) { toastErr(er); return; }
      await refreshSession(); toast('Signed out everywhere', { icon: 'logout' }); navigate('/login');
    };

    box.replaceChildren(
      row('user', 'people', u.displayName, '@' + u.username, h('a', { class: 'btn sm', href: '/me?edit=1', 'data-link': '' }, 'Edit profile')),
      row('user', 'people', 'Username', '@' + u.username, h('button', { class: 'btn sm', type: 'button', onclick: changeUsername }, 'Change')),
      row('mail', 'people', 'Phone', u.phone || 'Not set', h('button', { class: 'btn sm', type: 'button', onclick: changePhone }, u.phone ? 'Change' : 'Add')),
      row('mail', 'people', h('span', { class: 'row', style: { gap: '.4rem', flexWrap: 'wrap' } }, 'Email', chip), h('span', { style: { wordBreak: 'break-all' } }, u.email),
        h('div', { class: 'col', style: { gap: '.3rem', alignItems: 'flex-end' } }, h('button', { class: 'btn sm', type: 'button', onclick: changeEmail }, 'Change'), resend)),
      row('key', 'admin', 'Password', u.hasPassword ? 'Used with your email or username' : 'Not set: you sign in with Google', h('button', { class: 'btn sm', type: 'button', onclick: changePassword }, u.hasPassword ? 'Change' : 'Set password')),
      acc.google || google ? row('login', 'nav', 'Google', google ? `Connected (${google.email})` : 'Use “Continue with Google” with this same email to connect it', google ? h('span', { class: 'chip', html: GOOGLE_G + ' Connected' }) : null) : null,
      h('div', { class: 'set-row', style: { alignItems: 'flex-start' } },
        h('span', { class: 'ico', style: { '--g': 'var(--g-admin)' }, html: icon('shield') }),
        h('div', { class: 'grow col', style: { gap: '.5rem' } },
          h('div', null, h('div', { style: { fontWeight: 650 } }, 'Where you’re signed in'), h('div', { class: 'tiny faint' }, 'Sign out any device you don’t recognise.')),
          devices,
          h('div', { class: 'row', style: { gap: '.5rem', flexWrap: 'wrap' } },
            h('button', { class: 'btn sm', type: 'button', onclick: logout }, 'Sign out'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: everywhere }, 'Sign out everywhere')))),
    );
    loadDevices();
  };
  await paint();
  return section;
}
