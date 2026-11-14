// /reset-password?token=…  (also used by "set a password" emails for accounts without a password)
import { h, api, toastErr, toast } from '../ui.js';
import { state, navigate, refreshSession } from '../app.js';
import { authCard, passwordInput, notice } from './login.js';

export async function mount(view, params) {
  const token = params.token || '';
  const min = state.config?.auth?.passwordMin || 8;
  if (!token) {
    view.append(authCard('Link missing', 'Open the link from your email again, or ask for a new one.', h('a', { class: 'btn primary block', href: '/login?mode=forgot', 'data-link': '' }, 'Email me a new link')));
    return;
  }
  const pw = passwordInput('New password', 'new-password');
  const pw2 = passwordInput('Repeat new password', 'new-password');
  const msg = h('div', { class: 'auth-msg' });
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' }, 'Save password');
  const form = h('form', { class: 'col', style: { gap: '.7rem' }, novalidate: true }, msg, pw.el, pw2.el,
    h('p', { class: 'tiny faint', style: { margin: '-.2rem 0 0' } }, `At least ${min} characters. Saving signs you out on every other device.`), btn);
  form.onsubmit = async (e) => {
    e.preventDefault(); msg.replaceChildren();
    if (pw.input.value.length < min) return msg.append(notice('error', `Use at least ${min} characters.`));
    if (pw.input.value !== pw2.input.value) return msg.append(notice('error', 'The two passwords don’t match.'));
    btn.disabled = true;
    try {
      await api('/api/auth/reset', { method: 'POST', body: { token, password: pw.input.value } });
      history.replaceState({}, '', '/reset-password'); // drop the token from the address bar
      await refreshSession();
      toast('Password saved. Other devices were signed out.', { icon: 'check' });
      navigate(state.user ? '/dashboard' : '/login?reset=1', { replace: true });
    } catch (er) {
      if (er.status === 400) msg.append(notice('error', er.message), h('p', { class: 'small', style: { margin: 0 } }, h('a', { href: '/login?mode=forgot', 'data-link': '' }, 'Email me a new link')));
      else toastErr(er);
    } finally { btn.disabled = false; }
  };
  view.append(authCard('Choose a new password', 'Make it something you don’t use anywhere else.', form));
  pw.input.focus();
}
