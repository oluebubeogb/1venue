import { icon, LOGO } from '../icons.js';
import { h, api, toastErr, toast, frag } from '../ui.js';
import { state, navigate, refreshSession } from '../app.js';

export async function mount(view, params) {
  const next = params.next && params.next.startsWith('/') ? params.next : '/dashboard';
  if (state.user) { navigate(next, { replace: true }); return; }
  const cfg = state.config || {};
  const ssoUrl = cfg.accountsLoginUrl ? `${cfg.accountsLoginUrl}?next=${encodeURIComponent((cfg.publicUrl || location.origin) + next)}` : null;
  let mode = 'login';
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', 'aria-label': 'Email' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const name = h('input', { class: 'input hidden', placeholder: 'Display name', autocomplete: 'name', 'aria-label': 'Display name' });
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' }, 'Sign in');
  const swap = h('button', { class: 'btn ghost sm', type: 'button' });
  const paint = () => { name.classList.toggle('hidden', mode !== 'signup'); btn.textContent = mode === 'signup' ? 'Create account' : 'Sign in'; swap.textContent = mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'; pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password'; };
  swap.onclick = () => { mode = mode === 'signup' ? 'login' : 'signup'; paint(); };
  paint();
  const form = h('form', { class: 'col', style: { gap: '.7rem' } }, name, email, pass, btn, cfg.allowLocalSignup !== false ? swap : null);
  form.onsubmit = async (e) => {
    e.preventDefault(); btn.disabled = true;
    try {
      const path = mode === 'signup' ? '/api/signup' : '/api/login';
      const em = email.value.trim();
      const uname = (em.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 18) || 'user') + '_' + Math.floor(1000 + Math.random() * 9000);
      await api(path, { method: 'POST', body: mode === 'signup' ? { email: em, username: uname, password: pass.value } : { login: em, password: pass.value } });
      if (mode === 'signup' && name.value.trim()) await api('/api/profile', { method: 'PATCH', body: { displayName: name.value.trim() } }).catch(() => {});
      await refreshSession();
      if (!state.user) throw new Error('Signed in, but the session cookie was not accepted. Check PUBLIC_URL / HTTPS settings.');
      toast(`Welcome, ${state.user.displayName}`, { icon: 'check' });
      navigate(next, { replace: true });
    } catch (er) { toastErr(er); } finally { btn.disabled = false; }
  };
  view.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card pad-lg auth-card' },
    h('div', { class: 'auth-logo', html: LOGO(56) }),
    h('h1', { style: { textAlign: 'center', fontSize: '1.6rem' } }, 'Sign in to 1venue'),
    h('p', { class: 'muted small', style: { textAlign: 'center', margin: '.3rem 0 1.3rem' } }, 'One Collab account for every app in the suite.'),
    ssoUrl ? h('a', { class: 'btn primary block lg', href: ssoUrl, html: icon('shield', { size: 20 }) + 'Continue with Collab Accounts' }) : null,
    ssoUrl ? h('div', { class: 'divider' }, h('span', null, 'or use email')) : null,
    form,
    h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '1rem' } }, 'You can still join any room as a guest with just a name.'),
    ssoUrl ? h('p', { class: 'tiny', style: { textAlign: 'center', marginTop: '.4rem' } }, h('a', { href: ssoUrl.replace('/login', '/forgot-password'), class: 'muted' }, 'Forgot password?')) : null)));
}
