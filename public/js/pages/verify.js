// /verify-email?token=…  confirms a new account's email, or a changed email.
import { h, api } from '../ui.js';
import { state, refreshSession } from '../app.js';
import { authCard, notice } from './login.js';

export async function mount(view, params) {
  const box = h('div', { class: 'col', style: { gap: '.8rem' } }, notice('info', 'Confirming your email…'));
  view.append(authCard('Confirm your email', null, box));
  history.replaceState({}, '', '/verify-email'); // drop the token from the address bar
  try {
    const r = await api('/api/auth/verify-email', { method: 'POST', body: { token: params.token || '' } });
    await refreshSession().catch(() => {});
    box.replaceChildren(notice('ok', `${r.email} is confirmed. Thank you!`),
      state.user ? h('a', { class: 'au-btn au-primary', href: '/dashboard', 'data-link': '' }, 'Go to your dashboard')
        : h('a', { class: 'au-btn au-primary', href: '/login?verified=1', 'data-link': '' }, 'Log in'));
  } catch (er) {
    box.replaceChildren(notice('error', er.message || 'This link did not work.'),
      state.user ? h('a', { class: 'au-btn au-outline', href: '/settings#account', 'data-link': '' }, 'Send a new link from Settings')
        : h('a', { class: 'au-btn au-outline', href: '/login', 'data-link': '' }, 'Log in to get a new link'));
  }
}
