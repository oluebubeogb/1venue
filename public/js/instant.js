// Instant meeting setup as an overlay over the current (blurred) page — same shell as the log-in overlay
// (.au-scrim / .au-modal) and the same floating-label pill inputs as the sign-in page (field() from login.js).
// Opens from anywhere: hero / dashboard links to /create?instant=1 are intercepted in app.js, and the
// command bar calls openInstant() directly. A deep link to /create?instant=1 opens it over the home page.
import { icon } from './icons.js';
import { h } from './ui.js';
import { state, navigate, requireLogin } from './app.js';
import { field } from './pages/login.js';

let open = null;

export function openInstant({ onClose } = {}) {
  if (!state.user) { requireLogin(); return; }
  if (open) { open.focus(); return open; }
  const prevFocus = document.activeElement;
  const defName = state.user ? `${(state.user.displayName || state.user.username || 'My').split(' ')[0]}’s meeting` : 'Quick meeting';
  const nameIn = h('input', { type: 'text', maxlength: 120, autocomplete: 'off', value: defName, enterkeyhint: 'go', 'data-voice': 'off' });
  const name = field(nameIn, 'Meeting name');
  const opts = { stage: false, waitingRoom: false };
  const opt = (key, ic, label, hint) => {
    const cb = h('input', { type: 'checkbox', role: 'switch', 'aria-describedby': `im-h-${key}` });
    cb.onchange = () => { opts[key] = cb.checked; row.classList.toggle('on', cb.checked); };
    const row = h('label', { class: 'im-opt' },
      h('span', { class: 'im-ic', html: icon(ic, { size: 18 }) }),
      h('span', { class: 'im-txt' }, h('b', null, label), h('small', { id: `im-h-${key}` }, hint)),
      h('span', { class: 'switch' }, cb, h('span')));
    return row;
  };
  const start = h('button', { class: 'au-btn au-primary', type: 'submit', html: icon('zap', { size: 18 }) + '<span>Start now</span>' });
  const form = h('form', { class: 'au-form', novalidate: true },
    name.el,
    h('p', {class:'small muted'}, '1 credit per minute while the room is open. At least 30 credits are required to start. ', h('a',{href:'/wallet','data-link':''},'View wallet')),
    h('div', { class: 'im-opts' },
      opt('stage', 'stage', 'Stage mode', 'Audience watches; limited speaker seats'),
      opt('waitingRoom', 'door', 'Waiting room', 'Admit people one by one')),
    start);
  form.onsubmit = (e) => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { name.setError('Give your meeting a name.'); nameIn.focus(); return; }
    sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, name: n, stage: opts.stage, waitingRoom: opts.waitingRoom }));
    close({ starting: true });
    navigate('/new');
  };

  const scrim = h('div', { class: 'au-scrim im-scrim' });
  const closeBtn = h('button', { class: 'icon-btn au-x', type: 'button', 'aria-label': 'Close', html: icon('x', { size: 20 }) });
  const modal = h('div', { class: 'au-modal im-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'im-title', 'aria-describedby': 'im-sub' },
    closeBtn,
    h('div', { class: 'au-body' },
      h('div', { class: 'im-badge', html: icon('zap', { size: 26 }) }),
      h('h2', { class: 'au-title', id: 'im-title' }, 'Instant meeting'),
      h('p', { class: 'au-sub', id: 'im-sub' }, 'Start a room right now and share the link. No scheduling needed.'),
      form));

  function close({ starting = false } = {}) {
    if (!open) return;
    open = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onPop);
    modal.classList.add('out'); scrim.classList.add('out');
    setTimeout(() => { modal.remove(); scrim.remove(); }, 200);
    document.documentElement.classList.remove('au-lock');
    if (!starting) prevFocus?.focus?.();
    onClose?.({ starting });
  }
  const onPop = () => close({ starting: true });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { // focus trap
      const f = [...modal.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]),select,textarea')].filter((x) => x.offsetParent || x.closest('.switch'));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  scrim.onclick = () => close();
  closeBtn.onclick = () => close();
  document.body.append(scrim, modal);
  document.documentElement.classList.add('au-lock');
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onPop);
  setTimeout(() => { nameIn.focus(); nameIn.select(); }, 40);
  open = { close, el: modal, focus: () => nameIn.focus() };
  return open;
}
export const instantOpen = () => !!open;
export const closeInstant = () => open?.close();
