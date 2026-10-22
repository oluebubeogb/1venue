import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, md, timeAgo, fmtDate, fmtDur, copy, hue, debounce } from '../ui.js';
import { state, requireLogin } from '../app.js';
import { empty } from '../components.js';
import { registerCommands, unregisterCommands } from '../commands.js';

export async function mount(view, params) {
  if (params.list) return list(view);
  const s = await api(`/api/sessions/${params.id}`).catch((e) => { view.append(empty('lock', 'Can’t open this session', e.message, h('a', { class: 'btn', href: '/dashboard', 'data-link': '' }, 'Dashboard'))); return null; });
  if (!s) return;
  // merge consecutive segments into "Name: text" lines
  const lines = [];
  for (const g of s.segments) { const l = lines[lines.length - 1]; if (l && l.name === g.speakerName && new Date(g.at) - l.at < 20000) { l.text += ' ' + g.text; l.at = new Date(g.at); } else lines.push({ name: g.speakerName, text: g.text, at: new Date(g.at), t0: new Date(g.at) }); }
  const start = new Date(s.startedAt);
  const sums = Object.fromEntries((s.summaries || []).map((x) => [x.kind, x]));
  const filter = h('input', { class: 'input sm', placeholder: 'Search transcript…', 'aria-label': 'Search transcript' });
  const tx = h('div', { class: 'transcript' });
  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    tx.innerHTML = '';
    const shown = lines.filter((l) => !q || (l.name + ' ' + l.text).toLowerCase().includes(q));
    if (!shown.length) tx.append(h('p', { class: 'muted small' }, lines.length ? 'No matches' : 'No transcript was captured for this session. Turn on captions in the room to record one.'));
    shown.forEach((l) => tx.append(h('div', { class: 'tline' }, h('span', { class: 'ts' }, fmtDur(Math.max(0, (l.t0 - start) / 1000))), h('div', null, h('strong', { style: { color: `hsl(${hue(l.name)} 70% var(--name-l, 45%))` } }, l.name + ': '), h('span', null, l.text)))));
  };
  filter.addEventListener('input', debounce(paint, 120)); paint();
  const sumBox = (kind, title, ic) => {
    const box = h('div', { class: 'card pad layer group-tint', 'data-group': 'ai' });
    const render = () => {
      box.innerHTML = '';
      const cur = sums[kind];
      const btn = h('button', { class: `btn sm${cur ? '' : ' primary'}`, html: icon('sparkles', { size: 15 }) + (cur ? 'Regenerate' : `Generate ${title.toLowerCase()}`) });
      btn.onclick = async () => { btn.disabled = true; btn.innerHTML = icon('loader', { size: 15, cls: 'spin' }) + 'Thinking…'; try { sums[kind] = await api(`/api/sessions/${s.id}/summary`, { method: 'POST', body: { kind } }); render(); toast(`${title} ready`, { icon: 'sparkles', group: 'ai' }); } catch (e) { toastErr(e); render(); } };
      box.append(h('div', { class: 'row between' }, h('strong', { html: icon(ic, { size: 18 }) + ' ' + esc(title) }), btn),
        cur ? h('div', { class: 'prose', style: { marginTop: '.6rem' }, html: md(cur.content) }) : h('p', { class: 'small muted', style: { marginTop: '.4rem' } }, 'One click — AI reads the transcript for you.'),
        cur ? h('div', { class: 'row between tiny faint', style: { marginTop: '.5rem' } }, h('span', null, `${cur.provider || 'ai'} · ${timeAgo(cur.createdAt)}`), h('button', { class: 'btn xs ghost', html: icon('copy', { size: 13 }) + 'Copy', onclick: () => copy(cur.content, 'Copied') })) : null);
    };
    render(); return box;
  };
  const dl = (href, label, ic) => h('a', { class: 'btn sm', href, download: '', html: icon(ic, { size: 15 }) + label });
  view.append(h('div', { class: 'page-head' }, h('div', { class: 'tiny muted', html: icon('history', { size: 14 }) + ` Session · ${s.code.slice(0, 3)}-${s.code.slice(3)}` }), h('h1', null, s.name || 'Session'),
    h('p', { class: 'muted small' }, `${fmtDate(s.startedAt)}${s.endedAt ? ' · ' + fmtDur((new Date(s.endedAt) - start) / 1000) : ' · in progress'} · ${lines.length} transcript lines`)),
    h('div', { class: 'row wrap', style: { gap: '.5rem', marginBottom: '1rem' } }, dl(`/api/sessions/${s.id}/transcript.txt`, 'Transcript .txt', 'download'), Object.keys(sums).length ? dl(`/api/sessions/${s.id}/summary.md`, 'Summary .md', 'fileText') : null,
      h('button', { class: 'btn sm', html: icon('copy', { size: 15 }) + 'Copy transcript', onclick: () => copy(lines.map((l) => `${l.name}: ${l.text}`).join('\n'), 'Transcript copied') })),
    h('div', { class: 'split' }, h('section', { class: 'card pad layer' }, h('div', { class: 'row between', style: { marginBottom: '.6rem' } }, h('strong', { html: icon('captions', { size: 18 }) + ' Transcript' }), filter), tx),
      h('aside', { class: 'col sticky', style: { gap: '1rem' } }, sumBox('summary', 'Summary', 'sparkles'), sumBox('action_items', 'Action items', 'listChecks'))));
  registerCommands('page', [
    { id: 's-sum', label: 'Generate AI summary', icon: 'sparkles', group: 'ai', run: () => view.querySelectorAll('[data-group=ai] .btn')[0]?.click() },
    { id: 's-act', label: 'Extract action items', icon: 'listChecks', group: 'ai', run: () => view.querySelectorAll('[data-group=ai] .btn')[1]?.click() },
    { id: 's-dl', label: 'Download transcript', icon: 'download', group: 'content', run: () => { location.href = `/api/sessions/${s.id}/transcript.txt`; } },
    { id: 's-find', label: 'Search in transcript', icon: 'search', group: 'content', run: () => filter.focus() },
  ]);
  return { unmount: () => unregisterCommands('page') };
}

async function list(view) {
  if (!requireLogin('Sign in to see your sessions')) return;
  const r = await api('/api/history?limit=100');
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('history', { size: 28 }) + 'Sessions' }), h('p', { class: 'muted' }, 'Every meeting and event you joined — transcripts, AI summaries and downloads.')),
    r.history.length ? h('div', { class: 'card layer list stagger' }, r.history.map((x) => h('a', { class: 'list-item', href: `/session/${x.id}`, 'data-link': '' },
      h('span', { class: 'ico-tile', 'data-group': x.wasHost ? 'engage' : 'content', html: icon(x.wasHost ? 'radio' : 'fileText', { size: 18 }) }),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, x.name || `${x.code.slice(0, 3)}-${x.code.slice(3)}`), h('div', { class: 'tiny faint' }, `${fmtDate(x.createdAt)} · ${x.wasHost ? 'Hosted' : 'Joined'}${x.endedAt ? ' · ' + fmtDur((new Date(x.endedAt) - new Date(x.createdAt)) / 1000) : ' · live'}${x.maxParticipants ? ` · ${x.maxParticipants} people` : ''}`)),
      h('span', { html: icon('chevronRight', { size: 18 }) }))))
      : empty('history', 'No sessions yet', 'Join or host a meeting and it’ll show up here with its transcript.', h('a', { class: 'btn primary', href: '/create?instant=1', 'data-link': '' }, 'Start a meeting')));
}
