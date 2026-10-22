// Command registry + the footer command bar (30% input / 70% inline actions).
// Fuzzy, typo-tolerant and synonym-aware; every page, setting and room feature registers here.
import { icon } from './icons.js';
import { h, esc, isMobile } from './ui.js';

const SYN = [
  ['mic', 'microphone', 'audio', 'mute', 'unmute', 'sound', 'voice', 'talk', 'speak', 'silence'],
  ['camera', 'video', 'cam', 'webcam', 'face', 'picture'],
  ['share', 'screen', 'present', 'presentation', 'display', 'cast', 'slides', 'deck'],
  ['chat', 'message', 'messages', 'text', 'dm', 'inbox', 'talk'],
  ['people', 'participants', 'attendees', 'members', 'audience', 'users', 'guests', 'roster'],
  ['react', 'reaction', 'emoji', 'clap', 'applause', 'like', 'love', 'heart'],
  ['hand', 'raise', 'question', 'ask'],
  ['record', 'recording', 'capture', 'save video', 'rec'],
  ['whiteboard', 'board', 'draw', 'sketch', 'canvas', 'pen', 'notes'],
  ['poll', 'vote', 'survey', 'quiz'],
  ['qa', 'q&a', 'questions', 'ask', 'answers'],
  ['comments', 'comment', 'reply', 'social', 'discussion', 'thread'],
  ['bible', 'scripture', 'verse', 'gospel', 'word', 'passage', 'sermon', 'kjv', 'psalm'],
  ['transcript', 'captions', 'subtitles', 'stt', 'speech', 'transcribe', 'cc'],
  ['ai', 'assistant', 'summary', 'summarize', 'smart', 'magic', 'gpt', 'bot'],
  ['stage', 'speakers', 'speaker', 'seats', 'panel', 'podium', 'mic queue'],
  ['settings', 'preferences', 'options', 'config', 'setup'],
  ['theme', 'dark', 'light', 'mode', 'appearance', 'night', 'colour', 'color', 'accent'],
  ['font', 'text size', 'zoom', 'bigger', 'smaller', 'scale', 'readability', 'size'],
  ['discover', 'explore', 'browse', 'events', 'live', 'find'],
  ['create', 'new', 'host', 'start', 'schedule', 'go live', 'launch', 'make'],
  ['join', 'enter', 'code', 'meeting', 'room'],
  ['dashboard', 'stats', 'analytics', 'overview', 'home'],
  ['feed', 'timeline', 'posts', 'social', 'updates'],
  ['profile', 'me', 'account', 'my page'],
  ['leave', 'exit', 'hang up', 'end', 'quit', 'bye'],
  ['lock', 'secure', 'security', 'privacy', 'waiting room', 'lobby'],
  ['layout', 'view', 'grid', 'spotlight', 'gallery', 'speaker view'],
  ['pip', 'picture in picture', 'float', 'mini', 'popout'],
  ['qr', 'qr code', 'scan', 'barcode', 'invite', 'link'],
  ['install', 'app', 'pwa', 'home screen', 'download app'],
  ['history', 'sessions', 'past', 'previous', 'archive', 'recordings'],
  ['translate', 'translation', 'language', 'yoruba', 'igbo', 'hausa', 'french'],
];
const synIndex = new Map();
for (const group of SYN) for (const w of group) { const set = synIndex.get(w) || new Set(); group.forEach((x) => set.add(x)); synIndex.set(w, set); }
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9&\s:]/g, ' ').trim();
const toks = (s) => norm(s).split(/\s+/).filter(Boolean);
function swap1(a, b) { // one adjacent transposition ("bibel" ~ "bible")
  if (a.length !== b.length) return false;
  let k = 0; while (k < a.length && a[k] === b[k]) k++;
  return k < a.length - 1 && a[k] === b[k + 1] && a[k + 1] === b[k] && a.slice(k + 2) === b.slice(k + 2);
}
function lev1(a, b) { // true when edit distance <= 1 (counting a transposition as one edit)
  if (swap1(a, b)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
}
function subseq(q, s) { let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length; }

const registry = new Map(); // scope -> commands[]
const listeners = new Set();
export function registerCommands(scope, cmds) { registry.set(scope, cmds); listeners.forEach((f) => f()); }
export function unregisterCommands(scope) { registry.delete(scope); listeners.forEach((f) => f()); }
export function allCommands() { return [...registry.values()].flat().filter((c) => !c.when || c.when()); }

function hay(c) {
  if (c._hay) return c._hay;
  const words = new Set([...toks(c.label), ...[].concat(c.keywords || []).flatMap((k) => toks(String(k))), ...toks(c.group || '')]);
  for (const w of [...words]) (synIndex.get(w) || []).forEach((x) => toks(x).forEach((t) => words.add(t)));
  c._hay = [...words];
  return c._hay;
}
export function scoreCommand(c, q) {
  const qt = toks(q); if (!qt.length) return 0;
  const H = hay(c); const label = norm(c.label);
  let score = 0;
  for (const t of qt) {
    let best = 0;
    if (label.startsWith(t)) best = 6;
    for (const w of H) {
      if (w === t) best = Math.max(best, 5);
      else if (w.startsWith(t)) best = Math.max(best, t.length > 1 ? 4 : 1.5);
      else if (t.length > 2 && w.includes(t)) best = Math.max(best, 2.5);
      else if (t.length > 3 && (lev1(t, w.slice(0, t.length + 1)) || lev1(t, w.slice(0, t.length)))) best = Math.max(best, 2);
      else if (t.length > 2 && subseq(t, w)) best = Math.max(best, 1);
    }
    if (!best) return 0; // every typed word must match something
    score += best;
  }
  return score + (c.boost || 0);
}
export function searchCommands(q, limit = 12) {
  return allCommands().map((c) => [c, scoreCommand(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}

/* ---------- footer bar ---------- */
let bar, input, actionsEl, sel = 0, current = [], phTimer, userMoved = false;
let ctx = { placeholders: [], pinned: () => [], dynamic: () => [] };
export function setBarContext(c) { ctx = { placeholders: [], pinned: () => [], dynamic: () => [], ...c }; startPlaceholders(); render(); }
export function refreshBar() { render(); }
export function focusBar(prefill) { if (!bar) return; if (prefill != null) input.value = prefill; input.focus(); render(); }

function startPlaceholders() {
  clearInterval(phTimer);
  const list = ctx.placeholders.length ? ctx.placeholders : ['Search anything…'];
  let i = 0; input.placeholder = list[0];
  phTimer = setInterval(() => {
    if (document.activeElement === input && input.value) return;
    i = (i + 1) % list.length; input.style.setProperty('--ph', '0');
    input.placeholder = list[i];
  }, 3200);
}

function render() {
  if (!bar) return;
  const q = input.value.trim();
  bar.classList.toggle('typing', !!q);
  const dyn = q ? (ctx.dynamic(q) || []) : [];
  current = q ? [...dyn.filter((d) => !d.tail), ...searchCommands(q, 14), ...dyn.filter((d) => d.tail)] : ctx.pinned().filter(Boolean).filter((c) => !c.when || c.when());
  // free text (e.g. a chat line) should not be hijacked by a weak fuzzy match
  if (q && !userMoved && current.length) {
    const top = current[0]; const n = toks(q).length || 1;
    const tailIdx = current.findIndex((c) => c.tail);
    if (tailIdx > 0 && !dyn.includes(top) && scoreCommand(top, q) / n < 3.5) sel = tailIdx;
  }
  if (sel >= current.length) sel = 0;
  actionsEl.innerHTML = '';
  if (!current.length) { actionsEl.append(h('span', { class: 'cmd-empty' }, q ? 'No matches — press Enter to search everything' : '')); return; }
  current.forEach((c, i) => {
    const on = typeof c.active === 'function' ? c.active() : false;
    const b = h('button', {
      class: `cmd-act${i === sel && q ? ' sel' : ''}${on ? ' on' : ''}`, 'data-group': c.group || 'nav', 'data-tip': c.tip || c.label, 'data-kbd': c.kbd || null, 'data-id': c.id || null, type: 'button',
      'aria-label': c.label, html: icon(typeof c.icon === 'function' ? c.icon() : c.icon || 'sparkle', { size: 18 }) + `<span class="lbl">${esc(typeof c.short === 'function' ? c.short() : c.short || c.label)}</span>`,
    });
    b.addEventListener('click', () => run(c));
    actionsEl.append(b);
  });
}
function run(c) {
  const q = input.value;
  input.value = ''; input.blur(); sel = 0; render();
  try { c.run(q); } catch (e) { console.error(e); }
}

export function mountCommandBar(host) {
  input = h('input', { type: 'search', enterkeyhint: 'go', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search commands, events, people, scripture' });
  actionsEl = h('div', { class: 'cmd-actions', role: 'toolbar', 'aria-label': 'Quick actions' });
  bar = h('div', { class: 'cmdbar', id: 'cmdbar' },
    h('label', { class: 'cmd-in', html: icon('search', { size: 18 }) }, input, h('span', { class: 'cmd-kbd' }, '/')),
    actionsEl);
  host.append(bar);
  input.addEventListener('input', () => { sel = 0; userMoved = false; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { if (current.length && input.value) { userMoved = true; sel = (sel + 1) % current.length; render(); scrollSel(); e.preventDefault(); } }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { if (current.length && input.value) { userMoved = true; sel = (sel - 1 + current.length) % current.length; render(); scrollSel(); e.preventDefault(); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (current[sel] && input.value.trim()) run(current[sel]);
      else if (input.value.trim() && ctx.fallback) { const q = input.value.trim(); input.value = ''; input.blur(); render(); ctx.fallback(q); }
    } else if (e.key === 'Escape') { input.value = ''; input.blur(); render(); }
  });
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); input.focus(); }
  });
  listeners.add(render);
  return bar;
}
function scrollSel() { const el = actionsEl.children[sel]; el && el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
export const barVisible = (v) => bar && bar.classList.toggle('hidden', !v);
export { isMobile };
