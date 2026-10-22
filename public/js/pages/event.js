import { icon } from '../icons.js';
import { h, api, esc, frag, fmtDate, fmtNum, toast, toastErr, sheet, confirmDlg, avatar, md, download, copy } from '../ui.js';
import { state, navigate, requireLogin } from '../app.js';
import { catOf, commentThread, shareLink, sectionHead, empty, followBtn } from '../components.js';
import { registerCommands, unregisterCommands } from '../commands.js';

export const roomPath = (code) => `/${code.slice(0, 3)}-${code.slice(3)}`;

/** Colourful, owner-themed QR with the 1venue mark. SVG from the server; PNG rasterised client-side. */
async function svgToPng(svgUrl, name, scale = 3) {
  const txt = await fetch(svgUrl).then((r) => r.text());
  const img = new Image();
  const blobUrl = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = blobUrl; });
  const c = document.createElement('canvas'); c.width = img.width * scale; c.height = img.height * scale;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(blobUrl);
  c.toBlob((b) => download(name, b, 'image/png'), 'image/png');
}
export function qrSheet(ev) {
  const s = sheet({ title: 'QR invite', icon: 'qr', group: 'content' });
  let dark = document.documentElement.dataset.theme === 'dark';
  const img = h('img', { alt: `QR code for ${ev.title}`, style: { width: '100%', maxWidth: '360px' } });
  const url = () => `/api/events/${ev.slug}/qr.svg?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${dark ? '&dark=1' : ''}`;
  const paint = () => { img.src = url(); };
  paint();
  s.body.append(h('div', { class: 'qr-wrap' }, img),
    h('p', { class: 'muted small', style: { textAlign: 'center', margin: '.6rem 0 1rem' } }, 'Coloured with this event’s theme. Scan to open the event page.'),
    h('div', { class: 'row wrap center' },
      h('button', { class: 'btn', 'data-group': 'settings', html: icon('moon', { size: 16 }) + 'Dark / light', onclick: () => { dark = !dark; paint(); } }),
      h('button', { class: 'btn', 'data-group': 'content', html: icon('download', { size: 16 }) + 'SVG', onclick: () => { const a = h('a', { href: url() + '&download=1', download: '' }); a.click(); } }),
      h('button', { class: 'btn primary', html: icon('image', { size: 16 }) + 'PNG', onclick: () => svgToPng(url(), `${ev.slug}-qr.png`).catch(toastErr) }),
      h('button', { class: 'btn', html: icon('link', { size: 16 }) + 'Copy link', onclick: () => copy(`${location.origin}/e/${ev.slug}`, 'Event link copied') })));
}
export function qrMaker(text = '') {
  const s = sheet({ title: 'QR code maker', icon: 'qr', group: 'content' });
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';
  const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#7c3aed';
  const inp = h('input', { class: 'input', placeholder: 'Link or text to encode', value: text || location.href });
  const title = h('input', { class: 'input', placeholder: 'Title (optional)' });
  const c1 = h('input', { type: 'color', value: accent, 'aria-label': 'Colour 1' }), c2 = h('input', { type: 'color', value: accent2, 'aria-label': 'Colour 2' });
  const img = h('img', { alt: 'QR preview', style: { width: '100%', maxWidth: '320px' } });
  const url = () => `/api/qr.svg?text=${encodeURIComponent(inp.value)}&accent=${encodeURIComponent(c1.value)}&accent2=${encodeURIComponent(c2.value)}&title=${encodeURIComponent(title.value)}`;
  let t; const paint = () => { clearTimeout(t); t = setTimeout(() => { if (inp.value) img.src = url(); }, 250); };
  [inp, title, c1, c2].forEach((x) => x.addEventListener('input', paint)); paint();
  s.body.append(h('div', { class: 'col' }, inp, title, h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Colours'), c1, c2)),
    h('div', { class: 'qr-wrap', style: { marginTop: '1rem' } }, img),
    h('div', { class: 'row center', style: { marginTop: '1rem' } }, h('button', { class: 'btn primary', html: icon('download', { size: 16 }) + 'Download PNG', onclick: () => svgToPng(url(), 'qr.png').catch(toastErr) })));
}

export async function mount(view, { slug }) {
  const ev = await api(`/api/events/${encodeURIComponent(slug)}`);
  const [cl, ci, cc] = catOf(ev.category);
  const live = ev.status === 'live';
  const c1 = ev.theme?.accent || cc, c2 = ev.theme?.accent2 || 'var(--accent-2)';
  document.title = `${ev.title} · 1venue`;
  const goLive = () => { sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, eventId: ev.id, name: ev.title, stage: ev.category !== 'meeting', speakerSeats: ev.speakerSeats, code: ev.code })); navigate(roomPath(ev.code)); };
  const join = () => navigate(roomPath(ev.code));
  const rsvpBtn = h('button', { class: `btn ${ev.rsvped ? '' : 'primary'}` });
  const paintRsvp = () => { rsvpBtn.className = `btn lg ${ev.rsvped ? '' : 'primary'}`; rsvpBtn.innerHTML = ev.rsvped ? icon('check', { size: 18 }) + 'Going' : icon('ticket', { size: 18 }) + 'RSVP'; };
  paintRsvp();
  rsvpBtn.onclick = async () => { if (!requireLogin('Sign in to RSVP')) return; try { const r = await api(`/api/events/${ev.id}/rsvp`, { method: 'POST' }); ev.rsvped = r.going; ev.rsvps = (ev.rsvps || 0) + (r.going ? 1 : -1); paintRsvp(); toast(r.going ? 'You’re going! We’ll show it on your dashboard.' : 'RSVP removed', { icon: 'ticket', group: 'engage' }); } catch (e) { toastErr(e); } };
  const primary = live ? h('button', { class: 'btn primary lg pulse-btn', onclick: ev.isHost ? goLive : join, html: icon('radio', { size: 20 }) + (ev.isHost ? 'Return to stage' : 'Join live') })
    : ev.isHost ? h('button', { class: 'btn primary lg', onclick: goLive, html: icon('radio', { size: 20 }) + 'Go live now' }) : rsvpBtn;
  const ics = () => {
    const d = (x) => new Date(x).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const st = ev.startsAt || new Date().toISOString(); const en = ev.endsAt || new Date(new Date(st).getTime() + 3600e3).toISOString();
    download(`${ev.slug}.ics`, `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//1venue//EN\r\nBEGIN:VEVENT\r\nUID:${ev.slug}@1venue\r\nDTSTAMP:${d(new Date())}\r\nDTSTART:${d(st)}\r\nDTEND:${d(en)}\r\nSUMMARY:${ev.title.replace(/[,;]/g, ' ')}\r\nURL:${location.origin}/e/${ev.slug}\r\nDESCRIPTION:${(ev.description || '').slice(0, 300).replace(/\n/g, '\\n').replace(/[,;]/g, ' ')}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`, 'text/calendar');
  };
  const hostMenu = ev.isHost ? h('div', { class: 'row wrap', style: { gap: '.4rem' } },
    h('a', { class: 'btn sm', href: `/create?edit=${ev.slug}`, 'data-link': '', html: icon('pen', { size: 15 }) + 'Edit' }),
    h('button', { class: 'btn sm', 'data-group': 'people', html: icon('users', { size: 15 }) + 'Speakers', onclick: () => editSpeakers(ev, () => navigate(location.pathname, { replace: true })) }),
    h('button', { class: 'btn sm danger', html: icon('trash', { size: 15 }) + 'Delete', onclick: async () => { if (await confirmDlg('Delete this event? This cannot be undone.', { ok: 'Delete', danger: true })) { await api(`/api/events/${ev.id}`, { method: 'DELETE' }).catch(toastErr); navigate('/dashboard'); } } })) : null;
  const speakers = ev.speakers || [];
  view.append(
    h('section', { class: 'ev-hero', style: { '--c1': c1, '--c2': c2 } },
      ev.coverUrl ? h('img', { class: 'bg', src: ev.coverUrl, alt: '' }) : null,
      h('div', { class: 'in' },
        h('div', { class: 'row wrap', style: { gap: '.5rem' } },
          h('span', { class: 'cat on-dark', html: icon(ci, { size: 14 }) + esc(cl) }),
          live ? h('span', { class: 'pill live static' }, `LIVE · ${fmtNum(ev.live?.viewers || ev.liveViewers || 0)} watching`) : ev.status === 'ended' ? h('span', { class: 'pill static' }, 'Ended') : null),
        h('h1', null, ev.title),
        h('div', { class: 'row wrap ev-meta' },
          h('a', { class: 'row', href: `/u/${ev.host.id}`, 'data-link': '' }, avatar(ev.host.name, ev.host.avatarUrl, 'sm ring'), h('strong', null, ev.host.name)),
          ev.startsAt ? h('span', { html: icon('calendar', { size: 16 }) + esc(fmtDate(ev.startsAt)) }) : null,
          h('span', { html: icon('ticket', { size: 16 }) + fmtNum(ev.rsvps || 0) + ' going' }),
          ev.category !== 'meeting' ? h('span', { html: icon('stage', { size: 16 }) + `${ev.speakerSeats} speaker seats` }) : null),
        h('div', { class: 'row wrap', style: { gap: '.6rem', marginTop: '1.1rem' } }, primary,
          live || ev.isHost ? null : null,
          h('button', { class: 'btn lg glass', 'data-group': 'content', 'data-tip': 'QR invite', 'aria-label': 'QR code', html: icon('qr', { size: 20 }), onclick: () => qrSheet(ev) }),
          h('button', { class: 'btn lg glass', 'data-group': 'content', 'data-tip': 'Share', 'aria-label': 'Share', html: icon('share', { size: 20 }), onclick: () => shareLink(`${location.origin}/e/${ev.slug}`, ev.title) }),
          ev.startsAt && !live ? h('button', { class: 'btn lg glass', 'data-group': 'nav', 'data-tip': 'Add to calendar', 'aria-label': 'Add to calendar', html: icon('calendarPlus', { size: 20 }), onclick: ics }) : null))),
    h('div', { class: 'split', style: { marginTop: '1.2rem' } },
      h('div', { class: 'col', style: { gap: '1.2rem' } },
        hostMenu,
        ev.description ? h('div', { class: 'card pad prose', html: md(ev.description) }) : null,
        ev.tags?.length ? h('div', { class: 'chips' }, ev.tags.map((t) => h('a', { class: 'chip', href: `/discover?q=${encodeURIComponent(t)}`, 'data-link': '' }, '#' + t))) : null,
        speakers.length ? h('div', null, sectionHead('Speakers', 'stage'), h('div', { class: 'speaker-cards hscroll' }, speakers.map((sp) => h(sp.userId ? 'a' : 'div', { class: 'card speaker-card', href: sp.userId ? `/u/${sp.userId}` : null, 'data-link': sp.userId ? '' : null, style: { '--c1': c1, '--c2': c2 } },
          h('div', { class: 'band' }), avatar(sp.name, sp.avatarUrl, 'xl ring'), h('strong', null, sp.name), h('span', { class: 'muted small' }, sp.headline || 'Speaker'))))) : null,
        h('div', null, sectionHead('Conversation', 'chats'), commentThread('events', ev.id, { isHost: ev.isHost }))),
      h('aside', { class: 'col sticky', style: { gap: '1rem' } },
        h('div', { class: 'card pad layer' },
          h('div', { class: 'row' }, avatar(ev.host.name, ev.host.avatarUrl, 'lg'), h('div', { class: 'grow' }, h('div', { class: 'tiny muted' }, 'Hosted by'), h('strong', null, ev.host.name)),
            state.user && state.user.id !== ev.host.id ? followBtn({ id: ev.host.id, isFollowing: false }) : null)),
        h('div', { class: 'card pad layer col' },
          h('div', { class: 'row between' }, h('span', { class: 'muted small' }, 'Room code'), h('span', { class: 'kbd', style: { fontSize: '1rem' } }, roomPath(ev.code).slice(1))),
          h('div', { class: 'qr-mini', onclick: () => qrSheet(ev) }, h('img', { src: `/api/events/${ev.slug}/qr.svg?frame=0`, alt: 'QR', loading: 'lazy' })),
          h('p', { class: 'tiny faint', style: { textAlign: 'center' } }, 'Tap the QR to download a poster-ready version.')))));
  registerCommands('page', [
    { id: 'ev-primary', label: live ? 'Join live' : ev.isHost ? 'Go live now' : 'RSVP', icon: 'radio', group: 'engage', run: () => primary.click() },
    { id: 'ev-qr', label: 'Event QR code', icon: 'qr', group: 'content', keywords: ['poster', 'invite'], run: () => qrSheet(ev) },
    { id: 'ev-share', label: 'Share event', icon: 'share', group: 'content', run: () => shareLink(`${location.origin}/e/${ev.slug}`, ev.title) },
    { id: 'ev-cal', label: 'Add to calendar', icon: 'calendarPlus', group: 'nav', when: () => !!ev.startsAt, run: ics },
    { id: 'ev-comment', label: 'Write a comment', icon: 'chat', group: 'social', run: () => view.querySelector('.composer textarea')?.focus() },
    ...(ev.isHost ? [{ id: 'ev-edit', label: 'Edit event', icon: 'pen', group: 'engage', run: () => navigate(`/create?edit=${ev.slug}`) }, { id: 'ev-speakers', label: 'Edit speakers', icon: 'users', group: 'people', run: () => editSpeakers(ev) }] : []),
  ]);
  return { unmount: () => unregisterCommands('page') };
}
export const barPinned = null;

function editSpeakers(ev, done) {
  const s = sheet({ title: 'Speakers', icon: 'stage', group: 'people' });
  const list = h('div', { class: 'col' });
  const rows = (ev.speakers || []).map((x) => ({ ...x }));
  const paint = () => {
    list.innerHTML = '';
    rows.forEach((r, i) => list.append(h('div', { class: 'row' },
      h('input', { class: 'input', placeholder: 'Name', value: r.name || '', oninput: (e) => { r.name = e.target.value; } }),
      h('input', { class: 'input', placeholder: 'Headline (e.g. Pastor, CTO)', value: r.headline || '', oninput: (e) => { r.headline = e.target.value; } }),
      h('button', { class: 'icon-btn', 'data-group': 'admin', 'aria-label': 'Remove', html: icon('x'), onclick: () => { rows.splice(i, 1); paint(); } }))));
  };
  paint();
  s.body.append(list, h('div', { class: 'row between', style: { marginTop: '1rem' } },
    h('button', { class: 'btn', html: icon('plus', { size: 16 }) + 'Add speaker', onclick: () => { rows.push({ name: '', headline: '' }); paint(); } }),
    h('button', { class: 'btn primary', onclick: async () => { try { await api(`/api/events/${ev.id}/speakers`, { method: 'PUT', body: { speakers: rows } }); toast('Speakers saved', { icon: 'check' }); s.close(); done && done(); } catch (e) { toastErr(e); } } }, 'Save')));
}
