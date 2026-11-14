// Sign in, create account, forgot password. Also hosts "Continue with Google" when configured.
import { LOGO, icon } from '../icons.js';
import { h, api, toastErr, toast } from '../ui.js';
import { state, navigate, refreshSession } from '../app.js';

export const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

const GOOGLE_ERRORS = {
  'google-cancelled': 'Google sign-in was cancelled.',
  'google-expired': 'That Google sign-in took too long. Please try again.',
  'google-state': 'That Google sign-in could not be confirmed. Please try again.',
  'google-unverified': 'Your Google email address is not verified yet.',
  'google-signup-closed': 'There is no 1venue account for that Google email yet.',
  'google-off': 'Google sign-in is not set up on this server.',
  'google-unavailable': 'Google is not reachable right now. Try again, or use your email and password.',
  google: 'Google sign-in did not work. Please try again.',
  rate: 'Too many attempts. Wait a minute and try again.',
};

export function safeNext(raw) {
  if (!raw) return '/dashboard';
  const s = String(raw);
  if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return s;
  try { const u = new URL(s, location.origin); if (u.origin === location.origin) return u.pathname + u.search; } catch { /* ignore */ }
  return '/dashboard';
}

/** "Continue with Google" button (only when the server has it configured). */
export function googleButton(next, label = 'Continue with Google') {
  if (!state.config?.auth?.google) return null;
  return h('a', { class: 'btn block lg google-btn', href: '/auth/google/start?next=' + encodeURIComponent(next), html: GOOGLE_G + '<span>' + label + '</span>' });
}

export const passwordInput = (placeholder = 'Password', autocomplete = 'current-password') => {
  const inp = h('input', { class: 'input', type: 'password', placeholder, autocomplete, 'aria-label': placeholder, required: true, maxlength: 128 });
  const eye = h('button', { class: 'icon-btn pw-eye', type: 'button', 'aria-label': 'Show password', html: icon('eye', { size: 18 }) });
  eye.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye.innerHTML = icon(show ? 'eyeOff' : 'eye', { size: 18 }); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
  return { input: inp, el: h('div', { class: 'pw-wrap' }, inp, eye) };
};

export const legalLinks = () => h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '1rem' } },
  h('a', { href: '/privacy' }, 'Privacy policy'), ' · ', h('a', { href: '/terms' }, 'Terms of service'));

export const authCard = (title, subtitle, ...kids) => h('div', { class: 'auth-wrap' }, h('div', { class: 'card pad-lg auth-card' },
  h('div', { class: 'auth-logo', html: LOGO(56) }),
  h('h1', { style: { textAlign: 'center', fontSize: '1.6rem' } }, title),
  subtitle ? h('p', { class: 'muted small', style: { textAlign: 'center', margin: '.3rem 0 1.3rem' } }, subtitle) : null,
  ...kids, legalLinks()));

export const notice = (kind, text) => h('div', { class: `auth-note ${kind}`, role: kind === 'error' ? 'alert' : 'status', html: icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'mail', { size: 18 }) }, h('span', null, text));

export async function mount(view, params) {
  const next = safeNext(params.next);
  if (!state.user) { try { await refreshSession(); } catch { /* offline */ } }
  if (state.user) { navigate(next, { replace: true }); return; }
  const cfg = state.config || {};
  const canSignup = cfg.auth?.allowSignup !== false;
  let mode = params.mode === 'signup' || location.pathname.startsWith('/signup') ? 'signup' : params.mode === 'forgot' ? 'forgot' : 'login';
  if (mode === 'signup' && !canSignup) mode = 'login';
  const min = cfg.auth?.passwordMin || 8;

  const msg = h('div', { class: 'auth-msg' });
  const show = (kind, text) => { msg.replaceChildren(text ? notice(kind, text) : ''); };

  const name = h('input', { class: 'input', placeholder: 'Your name', autocomplete: 'name', 'aria-label': 'Your name', maxlength: 80 });
  const email = h('input', { class: 'input', type: 'text', inputmode: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email', required: true, maxlength: 320 });
  if (params.email) email.value = params.email;
  const pw = passwordInput();
  const btn = h('button', { class: 'btn primary block lg', type: 'submit' });
  const rules = h('p', { class: 'tiny faint', style: { margin: '-.2rem 0 0' } }, `At least ${min} characters. A short sentence is easy to remember.`);
  const forgot = h('a', { href: '#', class: 'tiny muted', onclick: (e) => { e.preventDefault(); setMode('forgot'); } }, 'Forgot password?');
  const swap = h('p', { class: 'small muted', style: { textAlign: 'center', margin: '.9rem 0 0' } });
  const title = h('h1', { style: { textAlign: 'center', fontSize: '1.6rem' } });
  const sub = h('p', { class: 'muted small', style: { textAlign: 'center', margin: '.3rem 0 1.1rem' } });
  const google = googleButton(next, 'Continue with Google');
  const or = google ? h('div', { class: 'auth-or' }, h('span', null, 'or')) : null;
  const form = h('form', { class: 'col', style: { gap: '.7rem' }, novalidate: true });

  function setMode(m) {
    mode = m; show();
    const titles = { login: ['Sign in to 1venue', 'Welcome back.'], signup: ['Create your account', 'Free. Host and join events in minutes.'], forgot: ['Reset your password', 'We’ll email you a link to choose a new one.'] };
    title.textContent = titles[m][0]; sub.textContent = titles[m][1];
    btn.textContent = m === 'signup' ? 'Create account' : m === 'forgot' ? 'Email me a link' : 'Sign in';
    email.autocomplete = m === 'signup' ? 'email' : 'username';
    email.placeholder = m === 'login' ? 'Email or username' : 'Email';
    pw.input.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    pw.input.placeholder = m === 'signup' ? 'Create a password' : 'Password';
    form.replaceChildren(...[
      m === 'signup' ? name : null, email,
      m !== 'forgot' ? pw.el : null, m === 'signup' ? rules : null,
      m === 'login' ? h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '-.2rem' } }, forgot) : null,
      btn,
    ].filter(Boolean));
    swap.replaceChildren(...(m === 'login'
      ? (canSignup ? ['New here? ', link('Create an account', 'signup')] : [])
      : ['Have an account? ', link('Sign in', 'login')]));
    if (google) { google.style.display = m === 'forgot' ? 'none' : ''; or.style.display = m === 'forgot' ? 'none' : ''; }
    history.replaceState({}, '', m === 'signup' ? `/signup?next=${encodeURIComponent(next)}` : `/login?${m === 'forgot' ? 'mode=forgot&' : ''}next=${encodeURIComponent(next)}`);
    document.title = `${titles[m][0]} — 1venue`;
  }
  const link = (text, m) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); setMode(m); } }, text);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const em = email.value.trim();
    if (!em) { email.focus(); return show('error', mode === 'login' ? 'Enter your email or username.' : 'Enter your email address.'); }
    if (mode !== 'forgot' && !pw.input.value) { pw.input.focus(); return show('error', 'Enter your password.'); }
    if (mode === 'signup' && pw.input.value.length < min) { pw.input.focus(); return show('error', `Use at least ${min} characters for your password.`); }
    btn.disabled = true; show();
    try {
      if (mode === 'forgot') {
        const r = await api('/api/auth/forgot', { method: 'POST', body: { email: em } });
        show('info', r.message);
        return;
      }
      if (mode === 'signup') {
        const r = await api('/api/signup', { method: 'POST', body: { email: em, password: pw.input.value, displayName: name.value.trim() || undefined } });
        if (r.checkEmail) { show('info', r.message || 'Check your inbox to continue.'); return; }
      } else {
        await api('/api/login', { method: 'POST', body: { login: em, password: pw.input.value } });
      }
      await refreshSession();
      if (!state.user) throw new Error('You are signed in, but this browser did not keep the session. Check that cookies are allowed for this site.');
      toast(mode === 'signup' ? `Welcome to 1venue, ${state.user.displayName}` : `Welcome back, ${state.user.displayName}`, { icon: 'check' });
      navigate(next, { replace: true });
    } catch (er) {
      if (er.status === 401) show('error', [er.message, er.data?.hint].filter(Boolean).join(' '));
      else if (er.status === 403 && er.data?.code === 'email-unverified') show('info', er.message);
      else if (er.status === 400 || er.status === 409 || er.status === 429) show('error', er.message);
      else toastErr(er);
    } finally { btn.disabled = false; }
  };

  const card = h('div', { class: 'card pad-lg auth-card' },
    h('div', { class: 'auth-logo', html: LOGO(56) }), title, sub, msg,
    google, or, form, swap,
    h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '1rem' } }, 'You can still join any room as a guest with just a name.'),
    legalLinks());
  view.append(h('div', { class: 'auth-wrap' }, card));
  setMode(mode);
  if (params.error) show('error', GOOGLE_ERRORS[params.error] || GOOGLE_ERRORS.google);
  else if (params.verified) show('ok', 'Email confirmed. Sign in to continue.');
  else if (params.reset) show('ok', 'Password saved. You are signed out everywhere else.');
  (mode === 'signup' ? name : email).focus();
}
