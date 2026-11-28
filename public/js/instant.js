// Instant meeting setup as an overlay over the current (blurred) page - same shell as the log-in overlay
// (.au-scrim / .au-modal). Opens from anywhere: hero / dashboard links to /create?instant=1 are
// intercepted in app.js, and the command bar calls openInstant() directly.
import { icon } from './icons.js';
import { h, toast, swipeToClose } from './ui.js';
import { state, navigate, requireLogin } from './app.js';
import { bringMainToFront } from './bring-main.js';

let open = null;

export function openInstant({ onClose, doc, name, thread } = {}) {
  if (open) { try { open.close(); } catch { /* reopen in the requested document */ } }
  const owner = (doc && doc.nodeType === 9) ? doc : (doc && doc.ownerDocument) || document;
  const win = owner.defaultView || window;
  const mount = owner.body;
  const prevFocus = owner.activeElement;
  const defName = name || (state.user ? `${(state.user.displayName || state.user.username || 'My').split(' ')[0]}’s meeting` : 'Quick meeting');
  const nameIn = h('input', { class: 'au-pill pj-field', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Meeting name', value: defName, enterkeyhint: 'go', 'data-voice': 'off', 'aria-label': 'Meeting name' });
  const opts = { stage: false, waitingRoom: false, accessMode: 'host_funded' };

  const ticketLink = h('a', { class: 'im-tickets tiny', href: '/create', target: '_blank', rel: 'noopener' }, 'Need tickets? Use ticketing');

  const fundIc = h('span', { class: 'im-tog-ic' });
  const fundLab = h('span', { class: 'im-tog-lab' }, 'Free Entry');
  const fundBtn = h('button', { class: 'im-tog on', type: 'button', 'aria-label': 'Free Entry' }, fundIc);
  const paintFund = () => {
    const paid = opts.accessMode === 'paid_entry';
    fundIc.innerHTML = icon(paid ? 'users' : 'user', { size: 22 });
    fundLab.textContent = paid ? 'Paid Entry' : 'Free Entry';
    fundBtn.setAttribute('aria-label', fundLab.textContent);
  };
  fundBtn.onclick = () => {
    opts.accessMode = opts.accessMode === 'host_funded' ? 'paid_entry' : 'host_funded';
    paintFund();
  };
  paintFund();
  const fund = h('div', { class: 'im-tog-wrap im-tog-fund' }, fundBtn, fundLab);

  const flag = (key, ic, label) => {
    const badge = h('span', { class: 'im-tog-badge', html: icon('xCircle', { size: 14 }) });
    const btn = h('button', { class: 'im-tog', type: 'button', 'aria-pressed': 'false', 'aria-label': label }, badge, h('span', { class: 'im-tog-ic', html: icon(ic, { size: 22 }) }));
    const wrap = h('div', { class: 'im-tog-wrap' }, btn, h('span', { class: 'im-tog-lab' }, label));
    const paint = () => {
      const on = !!opts[key];
      wrap.classList.toggle('on', on);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      badge.innerHTML = icon(on ? 'checkCircle' : 'xCircle', { size: 14 });
    };
    btn.onclick = () => { opts[key] = !opts[key]; paint(); };
    paint();
    return wrap;
  };

  const start = h('button', { class: 'au-btn au-primary', type: 'submit', html: icon('zap', { size: 18 }) + '<span>Start now</span>' });
  const form = h('form', { class: 'au-form', novalidate: true },
    nameIn,
    h('div', { class: 'im-togs' }, fund, flag('stage', 'stage', 'Stage mode'), flag('waitingRoom', 'door', 'Waiting room')),
    ticketLink,
    start);
  form.onsubmit = (e) => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { nameIn.focus(); return toast('Give your meeting a name.', { icon: 'alert' }); }
    if (opts.accessMode === 'paid_entry' && !requireLogin('Sign in to host a paid-entry meeting')) {
      if (owner !== document) bringMainToFront(owner);
      return;
    }
    const intent = { create: true, name: n, stage: opts.stage, waitingRoom: opts.waitingRoom, meetingAccessMode: opts.accessMode };
    if (thread) intent.thread = thread;
    sessionStorage.setItem('venue.intent', JSON.stringify(intent));
    close({ starting: true });
    navigate('/new');
    if (owner !== document) bringMainToFront(owner);
  };

  const scrim = h('div', { class: 'au-scrim im-scrim' });
  const closeBtn = h('button', { class: 'icon-btn au-x', type: 'button', 'aria-label': 'Close', html: icon('x', { size: 20 }) });
  const modal = h('div', { class: 'au-modal im-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'im-title' },
    closeBtn,
    h('div', { class: 'au-body' },
      h('div', { class: 'im-badge', html: icon('zap', { size: 26 }) }),
      h('h2', { class: 'au-title', id: 'im-title' }, 'Instant meeting'),
      form));

  function close({ starting = false } = {}) {
    if (!open) return;
    open = null;
    owner.removeEventListener('keydown', onKey, true);
    win.removeEventListener('popstate', onPop);
    modal.classList.add('out'); scrim.classList.add('out');
    setTimeout(() => { modal.remove(); scrim.remove(); }, 200);
    owner.documentElement.classList.remove('au-lock');
    if (!starting) prevFocus?.focus?.();
    onClose?.({ starting });
  }
  const onPop = () => close({ starting: true });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...modal.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]),select,textarea')].filter((x) => x.offsetParent || x.closest('.switch'));
      if (!f.length) return;
      const i = f.indexOf(owner.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  scrim.onclick = () => close();
  closeBtn.onclick = () => close();
  const grip = h('div', { class: 'sheet-grip', 'aria-hidden': 'true' });
  modal.prepend(grip);
  swipeToClose(modal, close, { grip, maxWidth: 560 });
  mount.append(scrim, modal);
  owner.documentElement.classList.add('au-lock');
  owner.addEventListener('keydown', onKey, true);
  win.addEventListener('popstate', onPop);
  setTimeout(() => { nameIn.focus(); nameIn.select(); }, 40);
  open = { close, el: modal, focus: () => nameIn.focus() };
  return open;
}
export const instantOpen = () => !!open;
export const closeInstant = () => open?.close();
