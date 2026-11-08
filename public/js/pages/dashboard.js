import { icon } from '../icons.js';
import { h, api, esc, fmtNum, fmtDur, timeAgo, avatar } from '../ui.js';
import { state, requireLogin } from '../app.js';
import { eventCard, sectionHead, empty, personRow } from '../components.js';
import { inlineBanner } from '../pwa.js';

function listMore(items, render, { limit = 5, moreHref, moreLabel = 'See more' } = {}) {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  const box = h('div', { class: 'col', style: { gap: '.15rem' } }, ...shown.map(render));
  if (rest > 0) {
    if (moreHref) {
      box.append(h('a', { class: 'btn sm ghost', href: moreHref, 'data-link': '', style: { marginTop: '.35rem' } }, `${moreLabel} (${items.length})`));
    } else {
      const btn = h('button', { class: 'btn sm ghost', type: 'button', style: { marginTop: '.35rem' } }, `${moreLabel} (${rest})`);
      btn.onclick = () => { box.replaceChildren(...items.map(render)); };
      box.append(btn);
    }
  }
  return box;
}

function dashHead(ic, label, extra) {
  return h('div', { class: 'dash-list-head row between' },
    h('div', { class: 'row', style: { gap: '.45rem', alignItems: 'center' } },
      h('span', { style: { color: 'var(--accent)', display: 'inline-flex' }, html: icon(ic, { size: 18 }) }),
      h('strong', null, label)),
    extra || null);
}

export async function mount(view) {
  if (!requireLogin('Sign in to see your dashboard')) return;
  view.append(h('div', { class: 'skel', style: { height: '160px', marginBottom: '1rem' } }), h('div', { class: 'skel', style: { height: '320px' } }));
  const d = await api('/api/dashboard');
  view.innerHTML = '';
  const s = d.stats || {};
  const stat = (ic, g, label, val, sub) => h('div', { class: 'stat', 'data-group': g },
    h('span', { class: 'ico-tile', style: { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }, html: icon(ic, { size: 20 }) }),
    h('div', null, h('div', { class: 'v' }, val), h('div', { class: 'l' }, label), sub ? h('div', { class: 'tiny faint' }, sub) : null));
  const max = Math.max(1, ...(d.activity || []).map((a) => a.n));
  const spark = h('div', { class: 'spark', 'aria-label': 'Sessions joined, last 14 days' }, (d.activity || []).map((a) => h('i', { style: { height: `${8 + (a.n / max) * 92}%` }, 'data-tip': `${a.day}: ${a.n} session${a.n === 1 ? '' : 's'}` })));
  const hour = new Date().getHours();
  view.append(
    h('section', { class: 'dash-hero card' },
      avatar(state.user.displayName, state.user.avatarUrl, 'xl ring'),
      h('div', { class: 'grow' },
        h('div', { class: 'muted small' }, hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'),
        h('h1', null, state.user.displayName),
        h('div', { class: 'row wrap small muted', style: { gap: '1rem', marginTop: '.3rem' } },
          h('span', null, h('strong', null, fmtNum(s.followers)), ' followers'),
          h('span', null, h('strong', null, fmtNum(s.following)), ' following'))),
      h('div', { class: 'row wrap', style: { gap: '.5rem' } },
        h('a', { class: 'btn primary', href: '/create', 'data-link': '', html: icon('radio', { size: 18 }) + 'Go live' }),
        h('a', { class: 'btn', href: '/create?instant=1', 'data-link': '', 'data-group': 'media', html: icon('zap', { size: 18 }) + 'Instant' }),
        h('a', { class: 'btn', href: '/venues', 'data-link': '', 'data-group': 'media', html: icon('door', { size: 18 }) + 'Venue' }))),
    h('div', { class: 'stats stagger' },
      stat('radio', 'engage', 'Hosted', fmtNum(s.hosted)),
      stat('users', 'people', 'Attended', fmtNum(s.attended)),
      stat('clock', 'media', 'Live time (30d)', fmtDur(Number(s.seconds30))),
      stat('eye', 'social', 'Total audience', fmtNum(s.audience), `Peak ${fmtNum(s.peak)} live`),
      stat('captions', 'ai', 'Transcript lines', fmtNum(s.transcriptLines || s.captions || 0))),
    d.activity?.length ? h('div', { class: 'card pad layer dash-activity' }, h('div', { class: 'tiny muted', style: { marginBottom: '.4rem' } }, 'Activity · 14 days'), spark) : null,
    inlineBanner('dashboard') || '',
    d.live?.length ? h('div', { class: 'dash-block' }, sectionHead('Live now', 'radio', h('a', { class: 'btn sm ghost', href: '/discover?status=live', 'data-link': '' }, 'All')), h('div', { class: 'hscroll cards-row' }, d.live.map((e) => eventCard(e)))) : '',
    h('div', { class: 'split dash-split' },
      h('div', { class: 'col dash-main-col' },
        h('div', { id: 'hosting', class: 'dash-block' }, sectionHead('Your events', 'calendar', h('a', { class: 'btn sm', href: '/create', 'data-link': '', html: icon('plus', { size: 15 }) + 'New' })),
          d.hosting.length ? h('div', { class: 'grid-cards' }, d.hosting.map((e) => eventCard(e))) : empty('calendar', 'You haven’t hosted yet', 'Your talk shows, seminars and services will live here.')),
        h('div', { class: 'dash-block' },
          sectionHead('Going', 'ticket'),
          d.going.length ? h('div', { class: 'grid-cards' }, d.going.map((e) => eventCard(e))) : empty('ticket', 'No RSVPs yet', 'Tap RSVP on any event to save it here.', h('a', { class: 'btn', href: '/discover', 'data-link': '' }, 'Discover'))),
      ),
      h('aside', { class: 'col dash-side-col' },
        h('div', { class: 'card pad layer' },
          dashHead('history', 'Recent sessions', h('a', { class: 'tiny', href: '/sessions', 'data-link': '' }, 'All')),
          d.history.length
            ? listMore(d.history, (x) => h('a', { class: 'list-item', href: `/session/${x.id}`, 'data-link': '' },
                h('span', { style: { color: 'var(--accent)', display: 'inline-flex' }, html: icon('fileText', { size: 16 }) }),
                h('div', { class: 'grow' },
                  h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, x.name || x.code),
                  h('div', { class: 'tiny faint' }, timeAgo(x.created_at || x.createdAt))),
                h('span', { html: icon('chevronRight', { size: 16 }) })),
              { limit: 5, moreHref: '/sessions' })
            : h('p', { class: 'tiny faint', style: { marginTop: '.5rem' } }, 'Transcripts and AI summaries of your sessions appear here.')),
        h('div', { class: 'card pad layer' },
          dashHead('userPlus', 'People to follow'),
          d.people.length
            ? listMore(d.people, (u) => personRow(u), { limit: 5, moreHref: '/discover', moreLabel: 'See more' })
            : h('p', { class: 'tiny faint' }, 'No suggestions yet.')),
        h('div', { class: 'card pad layer' },
          dashHead('board', 'Personal whiteboard'),
          h('a', { class: 'btn sm', href: '/whiteboard', 'data-link': '', style: { marginTop: '.35rem' } }, 'Open board')))));

  try {
    const att = await api('/api/attendance/list');
    if (att.lists && att.lists.length) {
      const lists = att.lists;
      const renderRow = (l) => {
        const toggle = h('button', {
          class: 'icon-btn sm', type: 'button',
          'data-tip': l.isPublic ? 'Make private' : 'Make public',
          'aria-label': l.isPublic ? 'Make private' : 'Make public',
          'data-group': 'admin',
          html: icon(l.isPublic ? 'lock' : 'globe', { size: 16 }),
          onclick: async () => {
            try {
              await api('/api/attendance/toggle', { method: 'POST', body: { token: l.token, public: !l.isPublic } });
              location.reload();
            } catch (e) { alert(e.message); }
          },
        });
        const share = l.isPublic ? h('button', {
          class: 'icon-btn sm', type: 'button',
          'data-tip': 'Share to timeline', 'aria-label': 'Share to timeline',
          'data-group': 'social',
          html: icon('share', { size: 16 }),
          onclick: async () => {
            try { await api('/api/attendance/share-timeline', { method: 'POST', body: { token: l.token } }); alert('Shared to timeline'); } catch (e) { alert(e.message); }
          },
        }) : null;
        const pdf = h('a', {
          class: 'icon-btn sm', href: l.url, 'data-link': '', target: '_blank',
          'data-tip': 'View PDF', 'aria-label': 'View PDF',
          html: icon('file', { size: 16 }),
        });
        const view = h('a', {
          class: 'icon-btn sm', href: l.url, 'data-link': '',
          'data-tip': 'View list', 'aria-label': 'View list',
          html: icon('eye', { size: 16 }),
        });
        return h('div', { class: 'row between wrap', style: { gap: '.5rem', alignItems: 'center' } },
          h('div', { class: 'grow row', style: { gap: '.55rem', alignItems: 'center', minWidth: 0 } },
            h('span', { class: 'ellipsis', style: { fontWeight: 600 } }, l.name || l.code),
            h('span', {
              class: 'att-vis',
              'data-tip': l.isPublic ? 'Public' : 'Private · host & co-host',
              html: icon(l.isPublic ? 'globe' : 'eyeOff', { size: 14 }),
              style: { color: 'var(--muted)', display: 'inline-flex', flex: 'none' },
            })),
          h('div', { class: 'row gap-xs wrap' }, view, pdf, toggle, share));
      };
      const stack = h('div', { class: 'stack', style: { marginTop: '.8rem', gap: '.6rem' } }, ...lists.slice(0, 5).map(renderRow));
      if (lists.length > 5) {
        const more = h('button', { class: 'btn sm ghost', type: 'button' }, `See more (${lists.length})`);
        more.onclick = () => { stack.replaceChildren(...lists.map(renderRow)); more.remove(); };
        stack.append(more);
      }
      view.append(h('div', { class: 'card pad layer dash-block' },
        dashHead('users', 'Attendance lists'),
        stack));
    }
  } catch (_) {}

  if (location.hash === '#hosting') setTimeout(() => document.getElementById('hosting')?.scrollIntoView({ behavior: 'smooth' }), 100);
}
