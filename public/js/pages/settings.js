import { icon } from '../icons.js';
import { h, esc, toast } from '../ui.js';
import { state, setPrefs, ACCENTS, FONT_SIZES, logout, navigate } from '../app.js';
import { promptInstall, canInstall } from '../pwa.js';
import { translationSelect } from './bible.js';

const CAPTION_LANGS = [['', 'Auto (device language)'], ['en', 'English (Nigerian)'], ['yo', 'Yorùbá'], ['ig', 'Igbo'], ['ha', 'Hausa'], ['pcm', 'Naija Pidgin']];

export async function mount(view) {
  const P = () => state.prefs;
  const row = (ic, g, title, hint, control, id) => h('div', { class: 'set-row', id }, h('span', { class: 'ico', style: { '--g': `var(--g-${g})` }, html: icon(ic) }), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, title), hint ? h('div', { class: 'tiny faint' }, hint) : null), control);
  const seg = (opts, get, set) => { const s = h('div', { class: 'seg' }); const paint = () => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(get()))); opts.forEach(([v, l, ic]) => s.append(h('button', { 'data-v': String(v), html: (ic ? icon(ic, { size: 15 }) : '') + esc(l), onclick: () => { set(v); paint(); } }))); paint(); return s; };
  const toggle = (get, set) => { const i = h('input', { type: 'checkbox', checked: !!get() }); i.onchange = () => set(i.checked); return h('label', { class: 'switch' }, i, h('span')); };
  const swatches = h('div', { class: 'swatches' }, ACCENTS.map(([n, a, a2]) => h('button', { class: `swatch${P().accent === a ? ' on' : ''}`, 'data-tip': n, 'aria-label': n, style: { background: `linear-gradient(135deg, ${a}, ${a2})` }, onclick: (e) => { setPrefs({ accent: a, accent2: a2 }); swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const custom = h('input', { type: 'color', value: P().accent || '#2563eb', 'aria-label': 'Custom accent', 'data-tip': 'Custom colour' });
  custom.oninput = () => setPrefs({ accent: custom.value, accent2: null });
  const sample = h('p', { class: 'muted', style: { marginTop: '.5rem' } }, 'The quick brown fox joins the 9 o’clock seminar.');
  const fontLbl = h('span', { class: 'kbd' }, Math.round((P().fontScale || 1) * 100) + '%');
  const range = h('input', { type: 'range', min: 0.8, max: 1.5, step: 0.02, value: P().fontScale || 1, 'aria-label': 'Text size', style: { width: '100%' } });
  range.oninput = () => { setPrefs({ fontScale: Number(range.value) }); fontLbl.textContent = Math.round(range.value * 100) + '%'; };
  const capSel = h('select', { class: 'input sm' }, CAPTION_LANGS.map(([v, l]) => h('option', { value: v, selected: (P().captionLang || '') === v }, l)));
  capSel.onchange = () => { setPrefs({ captionLang: capSel.value || null }); toast('Caption language saved', { icon: 'captions', group: 'ai' }); };
  const card = (title, ic, ...kids) => h('section', { class: 'card pad layer set-card' }, h('h2', { class: 'set-h', html: icon(ic, { size: 20 }) + esc(title) }), ...kids);
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('settings', { size: 28 }) + 'Settings' }), h('p', { class: 'muted' }, state.user ? 'Saved to your account and synced across devices.' : 'Saved on this device. Sign in to sync.')),
    h('div', { class: 'set-grid' },
      card('Appearance', 'palette',
        row('sun', 'settings', 'Theme', 'Light, dark or follow your device', seg([['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'Auto', 'sliders']], () => P().theme, (v) => setPrefs({ theme: v }))),
        row('palette', 'settings', 'Accent colour', 'Used for buttons, highlights, your QR codes and events', custom),
        swatches,
        row('activity', 'settings', 'Reduce motion', 'Calmer transitions and fewer animations', toggle(() => P().reduceMotion, (v) => setPrefs({ reduceMotion: v })))),
      card('Text size', 'type',
        h('p', { class: 'tiny faint' }, 'Replaces browser zoom shortcuts — layout stays crisp at every size.'),
        seg(FONT_SIZES.map(([l, v]) => [v, l]), () => P().fontScale || 1, (v) => { setPrefs({ fontScale: v }); range.value = v; fontLbl.textContent = Math.round(v * 100) + '%'; }),
        h('div', { class: 'row', style: { marginTop: '.8rem' } }, h('span', { html: icon('type', { size: 14 }) }), range, h('span', { html: icon('type', { size: 22 }) }), fontLbl), sample),
      card('Bible', 'bookOpen',
        row('languages', 'faith', 'Default translation', 'Used in the reader and for scripture shown during events', translationSelect(P().bibleTranslation || 'eng_kjv', (v) => { setPrefs({ bibleTranslation: v }); toast('Translation saved', { icon: 'bookOpen', group: 'faith' }); }, { compact: true }), 'bible')),
      card('Captions & transcripts', 'captions',
        row('captions', 'ai', 'Caption language', 'Nigerian STT (N-ATLaS) understands Yorùbá, Igbo, Hausa, Pidgin and Nigerian English', capSel, 'captions'),
        row('download', 'content', 'Recordings', 'Recordings stay on your device — they are never uploaded', h('span', { class: 'chip' }, 'Local only'))),
      card('App', 'install',
        row('install', 'nav', 'Install 1venue', canInstall() ? 'Full-screen, faster, works offline' : 'Already installed or not supported in this browser', h('button', { class: 'btn sm', onclick: promptInstall }, 'Install')),
        row('keyboard', 'nav', 'Command bar', 'Press / or Ctrl K anywhere — every feature and setting is searchable', h('span', { class: 'kbd' }, '/'))),
      card('Account', 'user',
        state.user ? row('user', 'people', state.user.displayName, state.user.email || '', h('a', { class: 'btn sm', href: '/me?edit=1', 'data-link': '' }, 'Edit profile')) : row('login', 'nav', 'Not signed in', 'Sign in with your Collab account', h('a', { class: 'btn sm primary', href: '/login', 'data-link': '' }, 'Sign in')),
        state.user ? row('logout', 'admin', 'Sign out', 'Signs out of 1venue and Collab Accounts', h('button', { class: 'btn sm danger', onclick: logout }, 'Sign out')) : null)));
  if (location.hash) setTimeout(() => { const el = document.getElementById(location.hash.slice(1)); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); } }, 120);
}
