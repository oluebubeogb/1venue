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

/** "Continue with Google" button (only when the server has it configured).
 *  Full-page href: /auth/* is excluded from the SPA click interceptor and the service worker. */
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

export const DEFAULT_PHONE_COUNTRY = 'NG';
export const PHONE_COUNTRIES = [
  { iso: 'NG', dial: '+234', name: 'Nigeria' },
  { iso: 'GH', dial: '+233', name: 'Ghana' },
  { iso: 'KE', dial: '+254', name: 'Kenya' },
  { iso: 'ZA', dial: '+27', name: 'South Africa' },
  { iso: 'EG', dial: '+20', name: 'Egypt' },
  { iso: 'CM', dial: '+237', name: 'Cameroon' },
  { iso: 'TZ', dial: '+255', name: 'Tanzania' },
  { iso: 'UG', dial: '+256', name: 'Uganda' },
  { iso: 'US', dial: '+1', name: 'United States' },
  { iso: 'GB', dial: '+44', name: 'United Kingdom' },
  { iso: 'CA', dial: '+1', name: 'Canada' },
  { iso: 'IN', dial: '+91', name: 'India' },
  { iso: 'AE', dial: '+971', name: 'United Arab Emirates' },
  { iso: 'DE', dial: '+49', name: 'Germany' },
  { iso: 'FR', dial: '+33', name: 'France' },
  { iso: 'NL', dial: '+31', name: 'Netherlands' },
  { iso: 'AU', dial: '+61', name: 'Australia' },
  { iso: 'BR', dial: '+55', name: 'Brazil' },
  { iso: '', dial: '+', name: 'Other (full number with country code)' },
];

/** Live availability check (~300ms debounce) under a username input. */
export function bindUsernameCheck(input, status, { current } = {}) {
  let t = 0, ac = null;
  const paint = (text, kind) => {
    status.textContent = text;
    status.className = 'tiny username-status' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : ' faint');
  };
  const check = () => {
    const u = input.value.trim().toLowerCase();
    if (input.value !== u) input.value = u;
    clearTimeout(t);
    if (ac) ac.abort();
    if (!u) { paint('', ''); return; }
    if (current && u === String(current).toLowerCase()) { paint('✓ Current username', 'ok'); return; }
    t = setTimeout(async () => {
      ac = new AbortController();
      try {
        const r = await fetch('/api/auth/username-available?u=' + encodeURIComponent(u), { signal: ac.signal, credentials: 'same-origin' });
        const body = await r.json();
        if (body.available) paint(`✓ @${u} is available`, 'ok');
        else paint((body.message || 'Not available') + (body.suggestions?.length ? ' · try ' + body.suggestions.join(', ') : ''), 'err');
      } catch (e) { if (e.name !== 'AbortError') paint('', ''); }
    }, 300);
  };
  input.addEventListener('input', check);
  return check;
}

export function usernameField(opts = {}) {
  const input = h('input', { class: 'input', type: 'text', name: 'username', placeholder: 'Username', autocomplete: 'username', 'aria-label': 'Username', maxlength: 30, spellcheck: 'false', autocapitalize: 'none', required: true });
  if (opts.value) input.value = opts.value;
  const status = h('p', { class: 'tiny faint username-status', role: 'status' });
  bindUsernameCheck(input, status, opts);
  return { input, status, el: h('div', { class: 'col', style: { gap: '.15rem' } }, input, status) };
}

const flag = (iso) => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));

export function phoneField({ required = true, value = '', country = DEFAULT_PHONE_COUNTRY } = {}) {
  const select = h('select', { class: 'input', name: 'country', 'aria-label': 'Country calling code' },
    ...PHONE_COUNTRIES.map((c) => h('option', { value: c.iso, title: c.name }, c.iso ? `${flag(c.iso)} ${c.dial}` : '🌐 Other')));
  select.value = country;
  const input = h('input', { class: 'input', type: 'tel', name: 'phone', placeholder: 'Phone number', autocomplete: 'tel-national', inputmode: 'tel', 'aria-label': 'Phone number' });
  if (required) input.required = true;
  if (value) input.value = value;
  return { input, select, el: h('div', { class: 'phone-row' }, select, input) };
}

export const legalLinks = () => h('p', { class: 'au-legal' },
  h('a', { href: '/terms' }, 'Terms of use'), h('span', { 'aria-hidden': 'true' }, ' | '), h('a', { href: '/privacy' }, 'Privacy policy'));

/** Standalone auth page card (sign-up, verify, reset): logo, title, one short line, content. */
export const authCard = (title, subtitle, ...kids) => h('div', { class: 'au-page' }, h('div', { class: 'au-card' },
  h('div', { class: 'au-logo', html: LOGO(44) }),
  h('h1', { class: 'au-title' }, title),
  subtitle ? h('p', { class: 'au-sub' }, subtitle) : null,
  ...kids, legalLinks()));

export const notice = (kind, text) => h('div', { class: `auth-note ${kind}`, role: kind === 'error' ? 'alert' : 'status', html: icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'mail', { size: 18 }) }, h('span', null, text));

/** Outlined field with a floating label (ChatGPT-style). Returns { el, input, err, setError }. */
export function field(input, label) {
  input.classList.add('au-in');
  if (!input.placeholder || input.placeholder === label) input.placeholder = ' ';
  const err = h('p', { class: 'au-err', role: 'alert' });
  const el = h('div', { class: 'au-field' }, h('label', { class: 'au-float' }, input, h('span', null, label)), err);
  const setError = (t) => { err.textContent = t || ''; el.classList.toggle('bad', !!t); };
  input.addEventListener('input', () => setError(''));
  return { el, input, err, setError };
}
const brandBtn = (text, type = 'submit') => h('button', { class: 'au-btn au-primary', type }, text);
const orLine = () => h('div', { class: 'au-or' }, h('span', null, 'OR'));
export const AUTH_SUB = 'Get the full 1venue experience: host live rooms, share files and images, and more.';

function googlePill(next) {
  if (!state.config?.auth?.google) return null;
  return h('a', { class: 'au-btn au-outline', href: '/auth/google/start?next=' + encodeURIComponent(next), html: GOOGLE_G + '<span>Continue with Google</span>' });
}

async function finishSignIn(next, { signup = false } = {}) {
  await refreshSession();
  if (!state.user) throw new Error('You are signed in, but this browser did not keep the session. Check that cookies are allowed for this site.');
  toast(signup ? `Welcome to 1venue, ${state.user.displayName}` : `You’re in, ${state.user.displayName}`, { icon: 'check' });
  const here = location.pathname + location.search;
  if (/^\/(login|signup|forgot-password)\b/.test(location.pathname) || next !== here) navigate(next, { replace: true });
  else navigate(here, { replace: true }); // re-render the page now that we are signed in
}

/* ---------------------------------------------------------------- login overlay */
let open = null; // the one overlay on screen
const MESSAGES = { verified: ['ok', 'Email confirmed. Log in to continue.'], reset: ['ok', 'Password saved. Log in with your new password.'] };

/**
 * Log-in overlay over a blurred page. mode: 'login' | 'forgot'. Opening again reuses it.
 * Closing returns to the page underneath (or home when it was opened from /login).
 */
export function openAuth({ next, mode = 'login', email = '', error = '', message = '' } = {}) {
  next = safeNext(next || (/^\/(login|signup)/.test(location.pathname) ? '/dashboard' : location.pathname + location.search));
  if (open) { open.go(mode === 'forgot' ? 'forgot' : 'start', { email, next }); return open; }
  const cfg = state.config || {};
  const canSignup = cfg.auth?.allowSignup !== false;
  const scrim = h('div', { class: 'au-scrim' });
  const closeBtn = h('button', { class: 'icon-btn au-x', type: 'button', 'aria-label': 'Close', html: icon('x', { size: 20 }) });
  const box = h('div', { class: 'au-body' });
  const modal = h('div', { class: 'au-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'au-title' }, closeBtn, box);
  const prevFocus = document.activeElement;
  let ident = email || '';

  const close = (signedIn = false) => {
    if (!open) return;
    open = null;
    modal.classList.add('out'); scrim.classList.add('out');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => { modal.remove(); scrim.remove(); }, 200);
    document.documentElement.classList.remove('au-lock');
    if (!signedIn && /^\/(login|forgot-password)\b/.test(location.pathname)) navigate('/', { replace: true });
    else prevFocus?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...modal.querySelectorAll('a[href],button:not([disabled]),input,select')].filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  scrim.onclick = () => close();
  closeBtn.onclick = () => close();

  const head = (title, sub) => [h('div', { class: 'au-logo', html: LOGO(40) }), h('h2', { class: 'au-title', id: 'au-title' }, title), sub ? h('p', { class: 'au-sub' }, sub) : null];
  const top = (kind, text) => (text ? h('div', { class: `au-msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text) : null);

  function start({ msg } = {}) {
    const inp = h('input', { type: 'text', inputmode: 'email', autocomplete: 'username', 'aria-label': 'Email or username', placeholder: 'Email or username', class: 'au-pill', maxlength: 320, value: ident });
    const err = h('p', { class: 'au-err', role: 'alert' });
    const form = h('form', { class: 'au-form', novalidate: true }, inp, err, brandBtn('Continue'));
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) { err.textContent = 'Enter your email or username.'; inp.focus(); return; }
      ident = v; password();
    };
    inp.oninput = () => { err.textContent = ''; };
    const google = googlePill(next);
    box.replaceChildren(...head('Log in or sign up', AUTH_SUB).filter(Boolean), msg || '', google || '', google ? orLine() : '', form,
      canSignup ? h('p', { class: 'au-swap' }, 'New to 1venue? ', h('a', { href: `/signup?next=${encodeURIComponent(next)}`, 'data-link': '', onclick: () => close(true) }, 'Create an account')) : '',
      legalLinks());
    setTimeout(() => inp.focus(), 40);
  }

  function password() {
    const pw = passwordInput('Password', 'current-password');
    const f = field(pw.input, 'Password');
    f.el.querySelector('.au-float').append(pw.el.querySelector('.pw-eye'));
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', value: ident, hidden: true, readonly: true }); // lets password managers pair the login
    const btn = brandBtn('Log in');
    const form = h('form', { class: 'au-form', novalidate: true }, user, f.el,
      h('div', { class: 'au-row' }, h('a', { href: '#', class: 'au-link', onclick: (e) => { e.preventDefault(); forgot(); } }, 'Forgot password?')), btn);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!pw.input.value) { f.setError('Enter your password.'); pw.input.focus(); return; }
      btn.disabled = true;
      try {
        await api('/api/login', { method: 'POST', body: { login: ident, password: pw.input.value } });
        await finishSignIn(next);
        close(true);
      } catch (er) {
        if (er.status === 401) f.setError([er.message, er.data?.hint].filter(Boolean).join(' '));
        else if (er.status === 403 && er.data?.code === 'email-unverified') f.setError(er.message);
        else if (er.status && er.status < 500) f.setError(er.message);
        else toastErr(er);
      } finally { btn.disabled = false; }
    };
    box.replaceChildren(...head('Enter your password').filter(Boolean),
      h('button', { class: 'au-ident', type: 'button', onclick: () => start(), 'aria-label': 'Change email or username' }, h('span', null, ident), h('span', { class: 'au-link' }, 'Edit')),
      form, legalLinks());
    setTimeout(() => pw.input.focus(), 40);
  }

  function forgot() {
    const em = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: 320, value: /@/.test(ident) ? ident : '' });
    const f = field(em, 'Email address');
    const btn = brandBtn('Continue');
    const form = h('form', { class: 'au-form', novalidate: true }, f.el, btn);
    const send = async () => {
      const v = em.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(v)) { f.setError('Enter the email you signed up with.'); em.focus(); return false; }
      btn.disabled = true;
      try { await api('/api/auth/forgot', { method: 'POST', body: { email: v } }); ident = v; return true; } catch (er) { if (er.status && er.status < 500) f.setError(er.message); else toastErr(er); return false; } finally { btn.disabled = false; }
    };
    form.onsubmit = async (e) => { e.preventDefault(); if (await send()) inbox(send); };
    box.replaceChildren(...head('Reset your password', 'We’ll email you a link to choose a new one.').filter(Boolean), form,
      h('p', { class: 'au-swap' }, h('a', { href: '#', class: 'au-link', onclick: (e) => { e.preventDefault(); start(); } }, 'Back to log in')), legalLinks());
    setTimeout(() => em.focus(), 40);
  }

  function inbox(resend) {
    const again = h('button', { class: 'au-plain', type: 'button' }, 'Resend email');
    again.onclick = async () => { again.disabled = true; if (await resend()) toast('Sent again', { icon: 'mail' }); setTimeout(() => { again.disabled = false; }, 30000); };
    box.replaceChildren(...head('Check your inbox', `If ${ident} has a 1venue account, a reset link is on its way.`).filter(Boolean),
      h('button', { class: 'au-btn au-primary', type: 'button', onclick: () => start() }, 'Back to log in'), again, legalLinks());
  }

  const go = (m, o = {}) => { if (o.email) ident = o.email; if (o.next) next = safeNext(o.next); if (m === 'forgot') forgot(); else start(); };
  document.body.append(scrim, modal);
  document.documentElement.classList.add('au-lock');
  document.addEventListener('keydown', onKey, true);
  const msg = error ? top('error', GOOGLE_ERRORS[error] || GOOGLE_ERRORS.google) : MESSAGES[message] ? top(...MESSAGES[message]) : null;
  if (mode === 'forgot') forgot(); else start({ msg });
  open = { close, go, el: modal };
  return open;
}
export const authOpen = () => !!open;

/* ---------------------------------------------------------------- /login, /signup, /forgot-password */
export async function mount(view, params) {
  const next = safeNext(params.next);
  if (!state.user) { try { await refreshSession(); } catch { /* offline */ } }
  if (state.user) { navigate(next, { replace: true }); return; }
  const canSignup = state.config?.auth?.allowSignup !== false;
  const mode = (params.mode === 'signup' || location.pathname.startsWith('/signup')) && canSignup ? 'signup'
    : (params.mode === 'forgot' || location.pathname.startsWith('/forgot')) ? 'forgot' : 'login';
  if (mode !== 'signup') {
    // Deep link: the home page sits blurred underneath the log-in overlay.
    document.title = 'Log in — 1venue';
    const home = await import('./home.js');
    const bg = await home.mount(view, {});
    openAuth({ next, mode, email: params.email || '', error: params.error || '', message: params.verified ? 'verified' : params.reset ? 'reset' : '' });
    return { unmount() { open?.close(true); (bg || home).unmount?.(); } };
  }
  document.title = 'Create your account — 1venue';
  return signupPage(view, next, params);
}

function signupPage(view, next, params) {
  const min = state.config?.auth?.passwordMin || 8;
  const name = field(h('input', { autocomplete: 'name', maxlength: 80 }), 'Full name');
  const un = usernameField();
  un.input.removeAttribute('placeholder');
  const uname = field(un.input, 'Username');
  uname.el.append(un.status);
  const email = field(h('input', { type: 'email', inputmode: 'email', autocomplete: 'email', maxlength: 320, value: params.email || '' }), 'Email address');
  const ph = phoneField();
  ph.select.classList.add('au-cc');
  const phone = field(ph.input, 'Phone number');
  const phoneRow = h('div', { class: 'au-phone' }, ph.select, phone.el);
  const pw = passwordInput('Password', 'new-password');
  const pass = field(pw.input, 'Password');
  pass.el.querySelector('.au-float').append(pw.el.querySelector('.pw-eye'));
  const btn = brandBtn('Continue');
  const formErr = h('p', { class: 'au-err', role: 'alert' });
  const form = h('form', { class: 'au-form', novalidate: true }, name.el, uname.el, email.el, phoneRow, pass.el, formErr, btn);

  form.onsubmit = async (e) => {
    e.preventDefault();
    formErr.textContent = '';
    const bad = (f, t) => { f.setError(t); f.input.focus(); return true; };
    if (!un.input.value.trim() && bad(uname, 'Choose a username.')) return;
    if (!/^\S+@\S+\.\S+$/.test(email.input.value.trim()) && bad(email, 'Enter a valid email address.')) return;
    if (!ph.input.value.trim() && bad(phone, 'Enter your phone number.')) return;
    if (pw.input.value.length < min && bad(pass, `Use at least ${min} characters.`)) return;
    btn.disabled = true;
    try {
      const r = await api('/api/signup', { method: 'POST', body: { email: email.input.value.trim(), password: pw.input.value, displayName: name.input.value.trim() || undefined, username: un.input.value.trim(), phone: ph.input.value.trim(), country: ph.select.value } });
      if (r.checkEmail) {
        view.replaceChildren(authCard('Check your inbox', r.message || `We sent a link to ${email.input.value.trim()}. Open it to finish creating your account.`,
          h('button', { class: 'au-btn au-primary', type: 'button', onclick: () => openAuth({ next, email: email.input.value.trim() }) }, 'Continue to log in')));
        return;
      }
      await finishSignIn(next, { signup: true });
    } catch (er) {
      const m = er.message || '';
      if (er.status === 409 && /username/i.test(m)) uname.setError(m);
      else if (er.status === 409 || /email/i.test(m)) email.setError(m);
      else if (/phone/i.test(m)) phone.setError(m);
      else if (/password/i.test(m)) pass.setError(m);
      else if (er.status && er.status < 500) formErr.textContent = m;
      else toastErr(er);
    } finally { btn.disabled = false; }
  };

  const google = googlePill(next);
  view.append(authCard('Create your account', 'One account for every event, room and community.',
    google || '', google ? orLine() : '', form,
    h('p', { class: 'au-swap' }, 'Already have an account? ', h('a', { href: `/login?next=${encodeURIComponent(next)}`, class: 'au-link' }, 'Log in'))));
  setTimeout(() => (params.email ? un.input : name.input).focus(), 40);
}
