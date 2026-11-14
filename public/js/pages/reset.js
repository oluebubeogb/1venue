// /reset-password?token=…  (also used by "set a password" emails for accounts without a password)
import { h, api, toastErr, toast } from '../ui.js';
import { state, navigate, refreshSession } from '../app.js';
import { authCard, passwordInput, field } from './login.js';

export async function mount(view, params) {
  const token = params.token || '';
  const min = state.config?.auth?.passwordMin || 8;
  if (!token) {
    view.append(authCard('Link missing', 'Open the link from your email again, or ask for a new one.', h('a', { class: 'au-btn au-primary', href: '/login?mode=forgot', 'data-link': '' }, 'Email me a new link')));
    return;
  }
  const mk = (label) => { const pw = passwordInput(label, 'new-password'); const f = field(pw.input, label); f.el.querySelector('.au-float').append(pw.el.querySelector('.pw-eye')); return f; };
  const pw = mk('New password');
  const pw2 = mk('Repeat new password');
  const btn = h('button', { class: 'au-btn au-primary', type: 'submit' }, 'Save password');
  const form = h('form', { class: 'au-form', novalidate: true }, pw.el, pw2.el, btn);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (pw.input.value.length < min) { pw.setError(`Use at least ${min} characters.`); pw.input.focus(); return; }
    if (pw.input.value !== pw2.input.value) { pw2.setError('The two passwords don’t match.'); pw2.input.focus(); return; }
    btn.disabled = true;
    try {
      await api('/api/auth/reset', { method: 'POST', body: { token, password: pw.input.value } });
      history.replaceState({}, '', '/reset-password'); // drop the token from the address bar
      await refreshSession();
      toast('Password saved. Other devices were signed out.', { icon: 'check' });
      navigate(state.user ? '/dashboard' : '/login?reset=1', { replace: true });
    } catch (er) {
      if (er.status === 400) pw2.setError(er.message);
      else toastErr(er);
    } finally { btn.disabled = false; }
  };
  view.append(authCard('Choose a new password', 'You’ll be signed out on your other devices.', form));
  pw.input.focus();
}
