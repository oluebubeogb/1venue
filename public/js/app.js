// 1venue SPA shell: session, persisted preferences/theme, router, global commands.
import { icon, LOGO } from './icons.js';
import { h, $, api, toast, sheet, menu, avatar, initTooltips, debounce, closeTopSheet, toastErr } from './ui.js';
import { mountCommandBar, registerCommands, setBarContext, barVisible, focusBar } from './commands.js';
import { initPwa, promptInstall } from './pwa.js';

export const state = { config: null, user: null, session: null, prefs: null, route: null, inRoom: false };
const LS_PREFS = 'venue.prefs';
const DEFAULT_PREFS = { theme: 'system', accent: '#2563eb', accent2: null, fontScale: 1, reduceMotion: false, bibleTranslation: 'eng_kjv', captionLang: null, extra: {} };
export const ACCENTS = [
  ['Ocean', '#2563eb', '#7c3aed'], ['Violet', '#7c3aed', '#db2777'], ['Rose', '#e11d48', '#f59e0b'], ['Sunset', '#ea580c', '#e11d48'],
  ['Gold', '#b7791f', '#ea580c'], ['Emerald', '#059669', '#0891b2'], ['Teal', '#0d9488', '#2563eb'], ['Graphite', '#334155', '#2563eb'],
];
export const FONT_SIZES = [['Small', 0.9], ['Default', 1], ['Large', 1.12], ['Extra large', 1.25], ['Huge', 1.4]];

/* ---------- preferences & theme ---------- */
const mql = matchMedia('(prefers-color-scheme: dark)');
export function applyPrefs(p = state.prefs) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && mql.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', p.accent || '#2563eb');
  const a2 = p.accent2 || (ACCENTS.find((x) => x[1] === p.accent) || [])[2] || '#7c3aed';
  root.style.setProperty('--accent-2', a2);
  root.style.setProperty('--font-scale', String(Math.min(1.5, Math.max(0.8, Number(p.fontScale) || 1))));
  root.classList.toggle('reduce-motion', !!p.reduceMotion);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#07090f' : '#f6f7fb';
}
mql.addEventListener('change', () => state.prefs && applyPrefs());
const pushPrefs = debounce(async () => { if (!state.user) return; try { await api('/api/prefs', { method: 'PUT', body: state.prefs }); } catch { /* offline: kept locally */ } }, 600);
export function setPrefs(patch, { silent = false } = {}) {
  state.prefs = { ...state.prefs, ...patch };
  localStorage.setItem(LS_PREFS, JSON.stringify(state.prefs));
  applyPrefs(); pushPrefs();
  if (!silent) window.dispatchEvent(new CustomEvent('prefs', { detail: state.prefs }));
}
function loadLocalPrefs() { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') }; } catch { return { ...DEFAULT_PREFS }; } }

/* ---------- session ---------- */
export async function refreshSession() {
  try {
    const s = await api('/api/session?next=' + encodeURIComponent(location.pathname + location.search));
    state.session = s; state.user = s.user;
  } catch { state.session = { authenticated: false }; state.user = null; }
  if (state.user) {
    try { const p = await api('/api/prefs'); const local = loadLocalPrefs(); state.prefs = { ...DEFAULT_PREFS, ...p }; if (p.anonymous) state.prefs = local; applyPrefs(); localStorage.setItem(LS_PREFS, JSON.stringify(state.prefs)); } catch { /* keep local */ }
  }
  renderUserSlot();
  return state.user;
}
export function loginUrl() {
  const base = state.config?.accountsLoginUrl;
  const next = (state.config?.publicUrl || location.origin) + location.pathname + location.search;
  return base ? `${base}?next=${encodeURIComponent(next)}` : '/login';
}
export function requireLogin(msg = 'Sign in to continue') {
  if (state.user) return true;
  toast(msg, { icon: 'login', group: 'nav' }); navigate('/login?next=' + encodeURIComponent(location.pathname + location.search));
  return false;
}
export async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
  state.user = null; renderUserSlot();
  const out = state.session?.logoutUrl;
  if (state.config?.accountsEnabled && out && /^https?:/.test(out)) location.href = out.replace(/next=[^&]*/, 'next=' + encodeURIComponent(location.origin + '/'));
  else navigate('/');
}

/* ---------- router ---------- */
const ROUTES = [
  [/^\/$/, () => import('./pages/home.js')],
  [/^\/discover\/?$/, () => import('./pages/discover.js')],
  [/^\/search\/?$/, () => import('./pages/discover.js'), { search: true }],
  [/^\/e\/([\w-]+)\/?$/, () => import('./pages/event.js'), 'slug'],
  [/^\/create\/?$/, () => import('./pages/create.js')],
  [/^\/dashboard\/?$/, () => import('./pages/dashboard.js')],
  [/^\/feed\/?$/, () => import('./pages/feed.js')],
  [/^\/u\/([\w-]+)\/?$/, () => import('./pages/profile.js'), 'id'],
  [/^\/me\/?$/, () => import('./pages/profile.js'), { me: true }],
  [/^\/settings\/?$/, () => import('./pages/settings.js')],
  [/^\/bible\/?$/, () => import('./pages/bible.js')],
  [/^\/sessions\/?$/, () => import('./pages/session.js'), { list: true }],
  [/^\/session\/(\d+)\/?$/, () => import('./pages/session.js'), 'id'],
  [/^\/whiteboard\/?$/, () => import('./pages/whiteboard.js')],
  [/^\/login\/?$/, () => import('./pages/login.js')],
  [/^\/new\/?$/, () => import('./room/room.js'), { code: null, instant: true }],
  [/^\/(?:r\/|j\/)?([A-Za-z]{3}-?\d{3})\/?$/, () => import('./room/room.js'), 'code'],
];
let currentPage = null;
export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search && !replace) { route(); return; }
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  route();
}
async function route() {
  const path = location.pathname;
  closeTopSheet();
  for (const [re, load, extra] of ROUTES) {
    const m = path.match(re); if (!m) continue;
    const params = Object.fromEntries(new URLSearchParams(location.search));
    if (typeof extra === 'string') params[extra] = decodeURIComponent(m[1]); else if (extra) Object.assign(params, extra);
    try { currentPage && currentPage.unmount && currentPage.unmount(); } catch { /* ignore */ }
    currentPage = null;
    const view = $('#view'); view.innerHTML = ''; view.className = 'main page-enter';
    void view.offsetWidth;
    try {
      const mod = await load();
      state.route = { path, params, mod };
      const isRoom = !!mod.isRoom; setRoomMode(isRoom);
      highlightNav(path);
      const res = await mod.mount(view, params);
      currentPage = res || mod;
      if (!isRoom) setBarContext(globalBarContext(mod.barPinned));
    } catch (e) {
      console.error(e);
      view.append(h('div', { class: 'empty' }, h('h2', null, 'Something went wrong'), h('p', { class: 'muted' }, e.message || String(e)), h('a', { class: 'btn primary', href: '/', style: { marginTop: '1rem' } }, 'Go home')));
    }
    window.scrollTo(0, 0);
    return;
  }
  setRoomMode(false);
  $('#view').innerHTML = '';
  $('#view').append(h('div', { class: 'empty' }, frag404()));
}
function frag404() { return h('div', null, h('h1', null, '404'), h('p', { class: 'muted' }, 'This page drifted off the venue.'), h('a', { class: 'btn primary', href: '/', style: { margin: '1rem auto 0', width: 'fit-content' } }, 'Back home')); }
export function setRoomMode(on) {
  state.inRoom = on;
  document.body.classList.toggle('in-room', on);
  $('.topbar').classList.toggle('hidden', on); $('.bottomnav').classList.toggle('hidden', on);
}

/* ---------- shell ---------- */
const NAV = [
  ['/', 'home', 'Home'], ['/discover', 'compass', 'Discover'], ['/feed', 'feed', 'Feed'], ['/dashboard', 'dashboard', 'Dashboard'], ['/bible', 'bookOpen', 'Bible'],
];
function highlightNav(path) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const p = a.getAttribute('data-nav');
    a.classList.toggle('on', p === '/' ? path === '/' : path.startsWith(p));
  });
}
function renderUserSlot() {
  const slot = $('#userslot'); if (!slot) return;
  slot.innerHTML = '';
  if (state.user) {
    const b = h('button', { class: 'icon-btn', 'data-tip': state.user.displayName, 'aria-label': 'Account menu', style: { width: 'auto', padding: '0 2px' } }, avatar(state.user.displayName, state.user.avatarUrl, 'sm ring'));
    b.onclick = () => menu(b, [
      { label: state.user.displayName, icon: 'user', run: () => navigate('/me') },
      { label: 'Dashboard', icon: 'dashboard', run: () => navigate('/dashboard') },
      { label: 'My sessions', icon: 'history', run: () => navigate('/sessions') },
      { label: 'My whiteboard', icon: 'board', group: 'content', run: () => navigate('/whiteboard') },
      { label: 'Settings', icon: 'settings', group: 'settings', run: () => navigate('/settings') }, '-',
      { label: 'Sign out', icon: 'logout', group: 'admin', run: logout },
    ]);
    slot.append(b);
  } else {
    slot.append(h('a', { class: 'btn sm primary', href: '/login', 'data-link': '' }, frag(icon('login', { size: 16 })), 'Sign in'));
  }
  const meTab = document.querySelector('.bottomnav [data-nav="/me"] span');
  if (meTab) meTab.textContent = state.user ? 'Me' : 'Sign in';
}
const frag = (s) => document.createRange().createContextualFragment(s);
function buildShell() {
  const app = $('#app'); app.innerHTML = '';
  const themeBtn = h('button', { class: 'icon-btn', 'data-group': 'settings', 'data-tip': 'Toggle light / dark', 'aria-label': 'Toggle theme', onclick: toggleTheme, html: icon('moon') });
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '/', 'data-link': '', html: LOGO(30) + '<span>1venue</span>' }),
    h('nav', { class: 'topnav', 'aria-label': 'Primary' }, NAV.map(([p, ic, l]) => h('a', { href: p, 'data-link': '', 'data-nav': p, html: icon(ic, { size: 18 }) + l }))),
    h('div', { class: 'grow' }),
    h('a', { class: 'btn sm primary top-desktop', href: '/create', 'data-link': '', html: icon('plus', { size: 16 }) + 'Create' }),
    h('div', { class: 'row', 'data-group': 'nav', style: { gap: '2px' } },
      h('a', { class: 'icon-btn', href: '/settings', 'data-link': '', 'data-group': 'settings', 'data-tip': 'Settings', 'aria-label': 'Settings', html: icon('settings') }),
      themeBtn, h('div', { id: 'userslot', class: 'row' })),
  );
  const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Primary' },
    h('a', { href: '/', 'data-link': '', 'data-nav': '/', html: icon('home', { size: 22 }) + '<span>Home</span>' }),
    h('a', { href: '/discover', 'data-link': '', 'data-nav': '/discover', html: icon('compass', { size: 22 }) + '<span>Discover</span>' }),
    h('a', { href: '/create', 'data-link': '', class: 'fab', 'aria-label': 'Create', html: `<span class="fabc">${icon('plus', { size: 26 })}</span>` }),
    h('a', { href: '/feed', 'data-link': '', 'data-nav': '/feed', html: icon('feed', { size: 22 }) + '<span>Feed</span>' }),
    h('a', { href: '/me', 'data-link': '', 'data-nav': '/me', html: icon('user', { size: 22 }) + '<span>Me</span>' }),
  );
  const main = h('main', { id: 'view', class: 'main' });
  app.append(top, main, bottom);
  mountCommandBar(document.body);
  const syncThemeIcon = () => { themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'); };
  window.addEventListener('prefs', syncThemeIcon); syncThemeIcon();
}
export function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  setPrefs({ theme: dark ? 'light' : 'dark' });
  toast(dark ? 'Light mode' : 'Dark mode', { icon: dark ? 'sun' : 'moon', group: 'settings', ms: 1400 });
}
export function bumpFont(d) {
  const v = Math.round(Math.min(1.5, Math.max(0.8, (state.prefs.fontScale || 1) + d)) * 100) / 100;
  setPrefs({ fontScale: v }); toast(`Text size ${Math.round(v * 100)}%`, { icon: 'type', group: 'settings', ms: 1200 });
}

/* ---------- global commands (every page and setting) ---------- */
const BIBLE_REF = /^\s*([1-3]?\s?[a-z]+\.?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?\s*$/i;
const CODE_RE = /^\s*([a-z]{3})[\s-]?(\d{3})\s*$/i;
export function globalBarContext(pinnedOverride) {
  return {
    placeholders: ['Search events, people, verses…', 'Try “go live”', 'Try “John 3:16”', 'Try “dark mode”', 'Join with a code: ABC-234', 'Try “bigger text”', 'Try “sermons live now”', 'Try “my whiteboard”'],
    pinned: () => pinnedOverride ? pinnedOverride() : ['create', 'join', 'discover', 'live', 'feed', 'bible', 'dashboard', 'whiteboard', 'theme', 'settings'].map(cmdById),
    dynamic: (q) => {
      const out = [];
      const c = q.match(CODE_RE);
      if (c) out.push({ id: 'dyn-join', label: `Join ${c[1].toUpperCase()}-${c[2]}`, icon: 'login', group: 'people', run: () => navigate(`/${c[1].toUpperCase()}-${c[2]}`) });
      const b = q.match(BIBLE_REF);
      if (b && b[1].length > 1) out.push({ id: 'dyn-bible', label: `Open ${q.trim()}`, icon: 'bookOpen', group: 'faith', run: () => navigate('/bible?ref=' + encodeURIComponent(q.trim())) });
      out.push({ id: 'dyn-search', label: `Search “${q.trim().slice(0, 24)}”`, short: 'Search all', icon: 'search', group: 'nav', tail: true, run: () => navigate('/search?q=' + encodeURIComponent(q.trim())) });
      return out;
    },
    fallback: (q) => navigate('/search?q=' + encodeURIComponent(q)),
  };
}
const CATS = [['talk_show', 'Talk shows', 'tv'], ['presentation', 'Presentations', 'presentation'], ['seminar', 'Seminars', 'graduation'], ['sermon', 'Sermons', 'church'], ['webinar', 'Webinars', 'globe'], ['workshop', 'Workshops', 'wrench'], ['meeting', 'Meetings', 'users'], ['concert', 'Concerts', 'music'], ['class', 'Classes', 'book']];
export { CATS };
let GLOBAL = [];
export const cmdById = (id) => GLOBAL.find((c) => c.id === id);
function registerGlobal() {
  const go = (p) => () => navigate(p);
  GLOBAL = [
    { id: 'create', label: 'Create event', short: 'Create', icon: 'plus', group: 'engage', keywords: ['go live', 'host', 'new meeting', 'schedule', 'start'], run: go('/create') },
    { id: 'instant', label: 'Start instant meeting', short: 'Instant', icon: 'zap', group: 'media', keywords: ['meet now', 'quick call', 'new room'], run: go('/create?instant=1') },
    { id: 'join', label: 'Join with code', short: 'Join', icon: 'login', group: 'people', keywords: ['enter code', 'meeting code', 'room'], run: () => joinPrompt() },
    { id: 'discover', label: 'Discover events', short: 'Discover', icon: 'compass', group: 'nav', keywords: ['browse', 'explore'], run: go('/discover') },
    { id: 'live', label: 'Live now', icon: 'radio', group: 'engage', keywords: ['happening', 'streaming', 'on air'], run: go('/discover?status=live') },
    ...CATS.map(([k, l, ic]) => ({ id: 'cat-' + k, label: l, icon: ic, group: k === 'sermon' ? 'faith' : 'content', keywords: ['category', k.replace('_', ' ')], run: go('/discover?category=' + k) })),
    { id: 'home', label: 'Home', icon: 'home', group: 'nav', run: go('/') },
    { id: 'feed', label: 'Social feed', short: 'Feed', icon: 'feed', group: 'social', keywords: ['timeline', 'posts'], run: go('/feed') },
    { id: 'post', label: 'New post', icon: 'pen', group: 'social', keywords: ['write', 'share update', 'status'], run: go('/feed?compose=1') },
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'nav', keywords: ['stats', 'analytics'], run: go('/dashboard') },
    { id: 'profile', label: 'My profile', icon: 'user', group: 'people', keywords: ['me', 'account', 'timeline'], run: go('/me') },
    { id: 'edit-profile', label: 'Edit profile', icon: 'pen', group: 'people', keywords: ['bio', 'avatar', 'name', 'handle'], run: go('/me?edit=1') },
    { id: 'people', label: 'Find people', icon: 'users', group: 'people', keywords: ['follow', 'friends', 'search users'], run: go('/search?tab=people') },
    { id: 'my-events', label: 'My events', icon: 'calendar', group: 'engage', keywords: ['hosting', 'scheduled', 'upcoming'], run: go('/dashboard#hosting') },
    { id: 'sessions', label: 'Past sessions & transcripts', short: 'Sessions', icon: 'history', group: 'content', keywords: ['history', 'transcripts', 'summaries', 'recordings'], run: go('/sessions') },
    { id: 'bible', label: 'Bible', icon: 'bookOpen', group: 'faith', keywords: ['scripture', 'read', 'verse'], run: go('/bible') },
    { id: 'bible-tr', label: 'Bible translation', icon: 'languages', group: 'faith', keywords: ['kjv', 'web', 'yoruba', 'version'], run: go('/settings#bible') },
    { id: 'whiteboard', label: 'My whiteboard', short: 'Whiteboard', icon: 'board', group: 'content', keywords: ['draw', 'sketch', 'personal'], run: go('/whiteboard') },
    { id: 'qr', label: 'Make a QR code', icon: 'qr', group: 'content', keywords: ['invite', 'poster'], run: () => import('./pages/event.js').then((m) => m.qrMaker()) },
    { id: 'settings', label: 'Settings', icon: 'settings', group: 'settings', run: go('/settings') },
    { id: 'theme', label: 'Toggle dark mode', short: 'Theme', icon: () => (document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'), group: 'settings', keywords: ['light', 'dark', 'night'], run: toggleTheme },
    { id: 'theme-light', label: 'Light theme', icon: 'sun', group: 'settings', run: () => setPrefs({ theme: 'light' }) },
    { id: 'theme-dark', label: 'Dark theme', icon: 'moon', group: 'settings', run: () => setPrefs({ theme: 'dark' }) },
    { id: 'theme-system', label: 'Match system theme', icon: 'sliders', group: 'settings', keywords: ['auto', 'device'], run: () => setPrefs({ theme: 'system' }) },
    ...ACCENTS.map(([n, a, a2]) => ({ id: 'accent-' + n, label: `Accent: ${n}`, icon: 'palette', group: 'settings', keywords: ['colour', 'color', 'theme', n], run: () => setPrefs({ accent: a, accent2: a2 }) })),
    { id: 'font-up', label: 'Bigger text', icon: 'type', group: 'settings', keywords: ['font size', 'increase', 'larger', 'zoom in'], run: () => bumpFont(0.08) },
    { id: 'font-down', label: 'Smaller text', icon: 'type', group: 'settings', keywords: ['font size', 'decrease', 'zoom out'], run: () => bumpFont(-0.08) },
    { id: 'font-reset', label: 'Reset text size', icon: 'type', group: 'settings', keywords: ['font size', 'default'], run: () => setPrefs({ fontScale: 1 }) },
    { id: 'motion', label: 'Reduce motion', icon: 'activity', group: 'settings', keywords: ['animations', 'accessibility'], active: () => !!state.prefs.reduceMotion, run: () => setPrefs({ reduceMotion: !state.prefs.reduceMotion }) },
    { id: 'captions-lang', label: 'Caption language', icon: 'captions', group: 'settings', keywords: ['transcript language', 'yoruba', 'igbo', 'hausa', 'pidgin'], run: go('/settings#captions') },
    { id: 'install', label: 'Install 1venue app', short: 'Install', icon: 'install', group: 'nav', keywords: ['pwa', 'add to home screen'], run: promptInstall },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', group: 'nav', keywords: ['hotkeys', 'keys', 'help'], run: showShortcuts },
    { id: 'login', label: 'Sign in', icon: 'login', group: 'nav', keywords: ['log in', 'account', 'collab'], when: () => !state.user, run: go('/login') },
    { id: 'logout', label: 'Sign out', icon: 'logout', group: 'admin', keywords: ['log out'], when: () => !!state.user, run: logout },
  ];
  registerCommands('global', GLOBAL);
}
export function joinPrompt() {
  const s = sheet({ title: 'Join a room', icon: 'login', group: 'people' });
  const inp = h('input', { class: 'input code-big', placeholder: 'ABC-234', maxlength: 8, autocapitalize: 'characters', style: { textAlign: 'center' } });
  const go = () => { const m = inp.value.match(CODE_RE); if (!m) return toast('Codes look like ABC-234', { icon: 'info' }); s.close(); navigate(`/${m[1].toUpperCase()}-${m[2]}`); };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  s.body.append(h('p', { class: 'muted small', style: { marginBottom: '.8rem' } }, 'Enter the 6-character room code (3 letters + 3 numbers).'), inp, h('button', { class: 'btn primary block', style: { marginTop: '1rem' }, onclick: go }, 'Continue'));
}
function showShortcuts() {
  const rows = [['/ or Ctrl K', 'Focus the command bar'], ['↑ ↓ ← →', 'Move between suggested actions'], ['Enter', 'Run action / search everything'], ['Esc', 'Close sheet or clear the bar'], ['In a room: M', 'Mute / unmute'], ['In a room: V', 'Camera on / off'], ['In a room: H', 'Raise / lower hand'], ['In a room: C', 'Chat']];
  const s = sheet({ title: 'Keyboard shortcuts', icon: 'keyboard' });
  s.body.append(h('div', { class: 'layer' }, rows.map(([k, d]) => h('div', { class: 'set-row' }, h('span', { class: 'kbd' }, k), h('span', { class: 'grow muted' }, d)))));
}

/* ---------- boot ---------- */
async function boot() {
  state.prefs = loadLocalPrefs(); applyPrefs();
  buildShell(); initTooltips(); registerGlobal();
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;
    e.preventDefault(); navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', route);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });
  try { state.config = await api('/api/config'); } catch { state.config = { features: {}, media: {} }; }
  await refreshSession();
  await route();
  initPwa();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
export { focusBar, barVisible, toastErr };
