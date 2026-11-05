// Permanent venues: /venues (my venues) and /v/{slug} (a venue's door).
import { icon } from '../icons.js';
import { h, api, toast, toastErr, timeAgo, copy, promptDlg } from '../ui.js';
import { state, requireLogin, navigate } from '../app.js';
import { empty } from '../components.js';

const fmtCode = (c) => `${c.slice(0, 3)}-${c.slice(3)}`;
const vlink = (slug) => `${location.origin}/v/${slug}`;
let timer = null;

export async function mount(view, params) {
  clearTimeout(timer);
  if (params.list) return list(view);
  return door(view, String(params.slug || '').toLowerCase());
}
export function unmount() { clearTimeout(timer); }

function open(v, meetingName) {
  sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, venue: v.slug, name: meetingName || v.name, waitingRoom: true, code: v.code }));
  navigate('/new');
}

async function list(view) {
  if (!state.user) { view.append(empty('door', 'Venues', 'Sign in to create permanent venue links.', h('button', { class: 'btn primary', onclick: () => requireLogin('Sign in to create a venue') }, 'Sign in'))); return; }
  const wrap = h('div', { class: 'page narrow col venues-page', style: { gap: '14px' } });
  view.append(wrap);
  const paint = async () => {
    const { venues } = await api('/api/venues').catch((e) => { toastErr(e); return { venues: [] }; });
    const create = h('button', { class: 'btn primary', html: icon('plus', { size: 16 }) + 'New venue', onclick: async () => {
      const name = await promptDlg('Name your venue', { placeholder: 'e.g. Sunday fellowship', ok: 'Create' });
      if (!name) return;
      try { await api('/api/venues', { method: 'POST', body: { name } }); paint(); } catch (e) { toastErr(e); }
    } });
    wrap.replaceChildren(
      h('div', { class: 'row between wrap', style: { gap: '10px' } }, h('div', null, h('h1', null, 'Venues'), h('p', { class: 'muted small' }, 'Permanent links. Waiting room always on — you admit everyone.')), create),
      venues.length ? h('div', { class: 'col', style: { gap: '8px' } }, ...venues.map((v) => h('div', { class: 'card pad row wrap venue-row', style: { gap: '10px' } },
        h('span', { class: 'ico-tile', 'data-group': 'media', html: icon('door', { size: 20 }) }),
        h('div', { class: 'grow' }, h('div', null, h('strong', null, v.name), v.live ? h('span', { class: 'chip tiny', style: { marginLeft: '6px' } }, '● Open') : null),
          h('div', { class: 'tiny muted' }, `/v/${v.slug} · ${v.meetings || 0} meetings${v.lastHeld ? ' · last ' + timeAgo(v.lastHeld) : ''}`)),
        h('button', { class: 'btn sm ghost', 'data-tip': 'Copy link', html: icon('link', { size: 15 }), onclick: () => copy(vlink(v.slug), 'Venue link copied') }),
        h('a', { class: 'btn sm', href: `/v/${v.slug}`, 'data-link': '' }, 'Manage'),
        h('button', { class: 'btn sm primary', onclick: () => (v.live ? navigate('/' + fmtCode(v.code)) : open(v)) }, v.live ? 'Rejoin' : 'Open')))) :
        empty('door', 'No venues yet', 'Create one to get a short link like /v/ydtd89r that you can reuse forever.'));
  };
  paint();
}

async function door(view, slug) {
  let v;
  try { v = await api(`/api/venues/${encodeURIComponent(slug)}`); }
  catch (e) { view.append(empty('door', 'Venue not found', 'Check the link and try again.', h('a', { class: 'btn', href: '/', 'data-link': '' }, 'Home'))); return; }
  if (location.pathname !== `/v/${v.slug}`) history.replaceState({}, '', `/v/${v.slug}`);
  document.title = `${v.name} · 1venue`;
  const wrap = h('div', { class: 'page narrow col venue-door', style: { gap: '14px' } });
  view.append(wrap);
  if (v.isOwner) return ownerView(wrap, v);
  const poll = async () => {
    try { v = await api(`/api/venues/${encodeURIComponent(slug)}`); } catch { /* keep waiting */ }
    if (v.live && v.live.hostIn) { navigate('/' + fmtCode(v.code), { replace: true }); return; }
    timer = setTimeout(poll, 5000);
  };
  wrap.append(h('div', { class: 'waiting' },
    h('span', { class: 'ico-tile lg', 'data-group': 'media', html: icon('door', { size: 28 }) }),
    h('h2', null, v.name),
    h('p', { class: 'muted' }, 'This venue isn’t open yet — wait a little. You’ll go in to the waiting room as soon as the host arrives.'),
    h('div', { class: 'dots-loader' }, h('i'), h('i'), h('i')),
    h('a', { class: 'btn ghost', href: '/', 'data-link': '' }, 'Leave')));
  if (v.live && v.live.hostIn) navigate('/' + fmtCode(v.code), { replace: true }); else timer = setTimeout(poll, 5000);
}

async function ownerView(wrap, v) {
  const name = h('input', { class: 'input', placeholder: 'Meeting name', maxlength: 60, value: `${v.name} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` });
  const hist = h('div', { class: 'col', style: { gap: '6px' } }, h('div', { class: 'tiny muted' }, 'Loading meetings…'));
  wrap.append(
    h('div', { class: 'row between wrap', style: { gap: '10px' } },
      h('div', null, h('h1', null, v.name), h('p', { class: 'muted small' }, `${location.host}/v/${v.slug} · waiting room always on`)),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn sm ghost', html: icon('link', { size: 15 }) + 'Copy link', onclick: () => copy(vlink(v.slug), 'Venue link copied') }),
        h('button', { class: 'btn sm ghost', html: icon('pencil', { size: 15 }) + 'Rename', onclick: async () => {
          const n = await promptDlg('Rename venue', { value: v.name, ok: 'Save' });
          if (!n) return;
          try { await api(`/api/venues/${v.slug}`, { method: 'PATCH', body: { name: n } }); toast('Renamed'); navigate(`/v/${v.slug}`, { replace: true }); } catch (e) { toastErr(e); }
        } }))),
    v.live
      ? h('div', { class: 'card pad row wrap', style: { gap: '10px' } }, h('div', { class: 'grow' }, h('strong', null, 'Open now: '), v.live.meetingName), h('button', { class: 'btn primary', onclick: () => navigate('/' + fmtCode(v.code)) }, 'Rejoin'))
      : h('div', { class: 'card pad col', style: { gap: '10px' } }, h('div', { class: 'small muted' }, 'Meeting name (separate from the venue name)'), h('div', { class: 'row', style: { gap: '8px' } }, name, h('button', { class: 'btn primary', html: icon('video', { size: 16 }) + 'Open venue', onclick: () => open(v, name.value.trim()) }))),
    h('h3', null, 'Meetings held here'), hist);
  try {
    const { meetings } = await api(`/api/venues/${v.slug}/meetings`);
    hist.replaceChildren(...(meetings.length ? meetings.map((m) => h(m.id ? 'a' : 'div', { class: 'card pad row', href: `/session/${m.id}`, 'data-link': '', style: { gap: '10px' } },
      h('div', { class: 'grow' }, h('div', null, m.name), h('div', { class: 'tiny muted' }, `${new Date(m.started_at).toLocaleString()} · up to ${m.max_participants} people${m.ended_at ? '' : ' · open'}`)))) : [h('div', { class: 'tiny muted' }, 'No meetings yet.')]));
  } catch (e) { hist.replaceChildren(h('div', { class: 'tiny muted' }, e.message)); }
}
