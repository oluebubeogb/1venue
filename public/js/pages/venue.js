// Permanent venues: /venues (my venues) and /v/{slug} (a venue's door).
import { icon } from '../icons.js';
import { h, api, toast, toastErr, timeAgo, copy, promptDlg, sheet } from '../ui.js';
import { state, requireLogin, navigate } from '../app.js';
import { empty } from '../components.js';

const fmtCode = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const vlink = (slug) => `${location.origin}/v/${slug}`;
let timer = null;

/* Custom venue links. Plans: free → 5+ chars + "-venue"; premium → 5+, no suffix; slug3 → 3+; slug2 → 2+. */
const PLAN_LABEL = { free: 'Free', premium: 'Premium', slug3: '3-char package', slug2: '2-char package' };
const RANK = { free: 0, premium: 1, slug3: 2, slug2: 3 };
const slugBase = (v) => String(v || '').toLowerCase().replace(/-venue$/, '').replace(/[^a-z0-9]/g, '').slice(0, 16);
function previewSlug(base, plan) {
  if (!base) return { slug: '', err: '' };
  const r = RANK[plan] || 0;
  if (r === 0) return base.length >= 5 ? { slug: `${base}-venue` } : { slug: `${base.padEnd(5, '•')}-venue`, err: 'At least 5 letters/numbers on Free' };
  if (base.length < 2) return { slug: base, err: 'Too short' };
  if (base.length === 4 && r < 2) return { slug: base, err: 'Premium needs at least 5 characters (4 needs the slug3 package)' };
  if (base.length === 2 && r < 3) return { slug: base, err: '2-character links need the slug2 package' };
  if (base.length === 3 && r < 2) return { slug: base, err: '3-character links need the slug3 package' };
  if (base.length < 2) return { slug: base, err: 'Too short' };
  if (base.length === 6) return { slug: base, err: '6 characters look like meeting codes — pick another length' };
  return { slug: base };
}
const planNote = (plan) => h('div', { class: 'tiny muted' }, h('span', { class: 'chip tiny', style: { marginRight: '6px' } }, PLAN_LABEL[plan] || 'Free'),
  (RANK[plan] || 0) === 0 ? 'Free: 5+ letters/numbers, we add -venue. Premium: 5+ without -venue. 3- and 2-character minimums are coming as packages.'
    : (RANK[plan] || 0) < 3 ? 'Shorter links (3+ or 2+ characters) are separate packages (coming soon).' : 'Your plan allows 2-character links.');
/** Sheet with name (optional) + custom URL field and live preview. Resolves { name, customSlug } or null. */
function venueDlg({ title, plan, name = '', withName = true, slugRequired = false, ok = 'Save' }) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({ title, icon: 'door', onClose: () => { if (!done) resolve(null); } });
    const nameIn = h('input', { class: 'input', placeholder: 'e.g. Sunday fellowship', maxlength: 60, value: name });
    const slugIn = h('input', { class: 'input', placeholder: (RANK[plan] || 0) ? 'yourname' : 'faith', maxlength: 16, autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
    const prev = h('div', { class: 'small muted' });
    const paint = () => {
      const base = slugBase(slugIn.value); if (slugIn.value !== base) slugIn.value = base;
      const p = previewSlug(base, plan);
      prev.replaceChildren(base ? h('span', null, `${location.host}/v/`, h('strong', null, p.slug), p.err ? h('span', { style: { color: 'var(--danger, #e11d48)', marginLeft: '8px' } }, p.err) : null)
        : h('span', null, slugRequired ? 'Type your custom link' : 'Leave blank for a random link like /v/ydtd89r'));
      return p;
    };
    slugIn.addEventListener('input', paint);
    const submit = () => {
      const base = slugBase(slugIn.value), p = paint();
      if ((base || slugRequired) && (p.err || !base)) return toast(p.err || 'Enter a custom link', { icon: 'info' });
      if (withName && nameIn.value.trim().length < 2) return toast('Name your venue', { icon: 'info' });
      done = true; resolve({ name: nameIn.value.trim(), customSlug: base || null }); s.close();
    };
    [nameIn, slugIn].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && submit()));
    s.body.append(
      withName ? h('div', { class: 'small muted', style: { marginBottom: '.3rem' } }, 'Venue name') : null, withName ? nameIn : null,
      h('div', { class: 'small muted', style: { margin: '.8rem 0 .3rem' } }, 'Custom URL (letters and numbers)'), slugIn,
      h('div', { style: { marginTop: '.4rem' } }, prev), h('div', { style: { marginTop: '.6rem' } }, planNote(plan)),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '1rem' } }, h('button', { class: 'btn ghost', onclick: () => s.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: submit }, ok)));
    paint();
  });
}
const myPlan = () => (state.user && state.user.plan) || 'free';

export async function mount(view, params) {
  clearTimeout(timer);
  if (params.list) return list(view);
  return door(view, String(params.slug || '').toLowerCase());
}
export function unmount() { clearTimeout(timer); }

function open(v, meetingName) {
  sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, venue: v.slug, name: meetingName || v.name, waitingRoom: true, code: v.code }));
  navigate('/' + fmtCode(v.code));
}

async function list(view) {
  if (!state.user) { view.append(empty('door', 'Venues', 'Sign in to create permanent venue links.', h('button', { class: 'btn primary', onclick: () => requireLogin('Sign in to create a venue') }, 'Sign in'))); return; }
  const wrap = h('div', { class: 'page narrow col venues-page', style: { gap: '14px' } });
  view.append(wrap);
  const paint = async () => {
    const { venues } = await api('/api/venues').catch((e) => { toastErr(e); return { venues: [] }; });
    const create = h('button', { class: 'btn primary', html: icon('plus', { size: 16 }) + 'New venue', onclick: async () => {
      const r = await venueDlg({ title: 'New venue', plan: myPlan(), ok: 'Create' });
      if (!r) return;
      try { await api('/api/venues', { method: 'POST', body: r }); paint(); } catch (e) { toastErr(e); }
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
    if (v.live && (v.live.open || v.live.hostIn)) { toast('Entering ' + v.name + '…'); navigate('/' + fmtCode(v.code), { replace: true }); return; }
    timer = setTimeout(poll, 3000);
  };
  wrap.append(h('div', { class: 'waiting' },
    h('span', { class: 'ico-tile lg', 'data-group': 'media', html: icon('door', { size: 28 }) }),
    h('h2', null, v.name),
    h('p', { class: 'muted' }, 'This venue isn’t open yet — wait a little. You’ll go in to the waiting room as soon as the host arrives.'),
    h('div', { class: 'dots-loader' }, h('i'), h('i'), h('i')),
    h('a', { class: 'btn ghost', href: '/', 'data-link': '' }, 'Leave')));
  if (v.live && (v.live.open || v.live.hostIn)) navigate('/' + fmtCode(v.code), { replace: true }); else timer = setTimeout(poll, 3000);
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
        } }),
        h('button', { class: 'btn sm ghost', html: icon('link', { size: 15 }) + 'Custom URL', onclick: async () => {
          const r = await venueDlg({ title: 'Custom venue URL', plan: v.plan || myPlan(), withName: false, slugRequired: true, ok: 'Save link' });
          if (!r || !r.customSlug) return;
          try { const nv = await api(`/api/venues/${v.slug}`, { method: 'PATCH', body: { customSlug: r.customSlug } }); toast('Link updated'); navigate(`/v/${nv.slug}`, { replace: true }); } catch (e) { toastErr(e); }
        } }))),
    planNote(v.plan || myPlan()),
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
