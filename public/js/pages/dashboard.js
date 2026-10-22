import { icon } from '../icons.js';
import { h, api, esc, fmtNum, fmtDur, timeAgo, avatar } from '../ui.js';
import { state, requireLogin } from '../app.js';
import { eventCard, sectionHead, empty, personRow } from '../components.js';
import { inlineBanner } from '../pwa.js';

export async function mount(view) {
  if (!requireLogin('Sign in to see your dashboard')) return;
  view.append(h('div', { class: 'skel', style: { height: '160px', marginBottom: '1rem' } }), h('div', { class: 'skel', style: { height: '320px' } }));
  const d = await api('/api/dashboard');
  view.innerHTML = '';
  const s = d.stats || {};
  const stat = (ic, g, label, val, sub) => h('div', { class: 'stat', 'data-group': g }, h('span', { class: 'ico-tile', html: icon(ic, { size: 20 }) }), h('div', null, h('div', { class: 'v' }, val), h('div', { class: 'l' }, label), sub ? h('div', { class: 'tiny faint' }, sub) : null));
  const max = Math.max(1, ...(d.activity || []).map((a) => a.n));
  const spark = h('div', { class: 'spark', 'aria-label': 'Sessions joined, last 14 days' }, (d.activity || []).map((a) => h('i', { style: { height: `${8 + (a.n / max) * 92}%` }, 'data-tip': `${a.day}: ${a.n} session${a.n === 1 ? '' : 's'}` })));
  const hour = new Date().getHours();
  view.append(
    h('section', { class: 'dash-hero card' },
      avatar(state.user.displayName, state.user.avatarUrl, 'xl ring'),
      h('div', { class: 'grow' }, h('div', { class: 'muted small' }, hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'), h('h1', null, state.user.displayName),
        h('div', { class: 'row wrap small muted', style: { gap: '1rem', marginTop: '.3rem' } }, h('span', null, h('strong', null, fmtNum(s.followers)), ' followers'), h('span', null, h('strong', null, fmtNum(s.following)), ' following'))),
      h('div', { class: 'row wrap', style: { gap: '.5rem' } }, h('a', { class: 'btn primary', href: '/create', 'data-link': '', html: icon('radio', { size: 18 }) + 'Go live' }), h('a', { class: 'btn', href: '/create?instant=1', 'data-link': '', 'data-group': 'media', html: icon('zap', { size: 18 }) + 'Instant' }))),
    h('div', { class: 'stats stagger' },
      stat('radio', 'engage', 'Hosted', fmtNum(s.hosted)), stat('users', 'people', 'Attended', fmtNum(s.attended)), stat('clock', 'media', 'Live time (30d)', fmtDur(Number(s.seconds30))),
      stat('eye', 'social', 'Total audience', fmtNum(s.audience), `Peak ${fmtNum(s.peak)} live`), stat('captions', 'ai', 'Transcript lines', fmtNum(s.transcript_lines))),
    h('div', { class: 'card pad layer', style: { marginTop: '1rem' } }, h('div', { class: 'row between' }, h('strong', { html: icon('activity', { size: 18 }) + ' Your last 14 days' }), h('span', { class: 'tiny faint' }, 'sessions joined per day')), spark),
    inlineBanner('dashboard') || '',
    d.live?.length ? h('div', null, sectionHead('Live now', 'radio', h('a', { class: 'btn sm ghost', href: '/discover?status=live', 'data-link': '' }, 'All')), h('div', { class: 'hscroll cards-row' }, d.live.map((e) => eventCard(e)))) : '',
    h('div', { class: 'split' },
      h('div', { class: 'col', style: { gap: '.4rem' } },
        h('div', { id: 'hosting' }, sectionHead('Your events', 'calendar', h('a', { class: 'btn sm', href: '/create', 'data-link': '', html: icon('plus', { size: 15 }) + 'New' })),
          d.hosting.length ? h('div', { class: 'grid-cards' }, d.hosting.map((e) => eventCard(e))) : empty('calendar', 'You haven’t hosted yet', 'Your talk shows, seminars and services will live here.')),
        sectionHead('Going', 'ticket'),
        d.going.length ? h('div', { class: 'grid-cards' }, d.going.map((e) => eventCard(e))) : empty('ticket', 'No RSVPs yet', 'Tap RSVP on any event to save it here.', h('a', { class: 'btn', href: '/discover', 'data-link': '' }, 'Discover'))),
      h('aside', { class: 'col', style: { gap: '1rem' } },
        h('div', { class: 'card pad layer' }, h('div', { class: 'row between' }, h('strong', { html: icon('history', { size: 18 }) + ' Recent sessions' }), h('a', { class: 'tiny', href: '/sessions', 'data-link': '' }, 'All')),
          d.history.length ? d.history.map((x) => h('a', { class: 'list-item', href: `/session/${x.id}`, 'data-link': '' }, h('span', { class: 'ico-tile sm', 'data-group': 'content', html: icon('fileText', { size: 16 }) }), h('div', { class: 'grow' }, h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, x.name || x.code), h('div', { class: 'tiny faint' }, timeAgo(x.created_at || x.createdAt))), icon('chevronRight', { size: 16 }) && h('span', { html: icon('chevronRight', { size: 16 }) })))
            : h('p', { class: 'tiny faint', style: { marginTop: '.5rem' } }, 'Transcripts and AI summaries of your sessions appear here.')),
        h('div', { class: 'card pad layer' }, h('strong', { html: icon('userPlus', { size: 18 }) + ' People to follow' }), d.people.length ? d.people.map((u) => personRow(u)) : h('p', { class: 'tiny faint' }, 'No suggestions yet.')),
        h('div', { class: 'card pad layer group-tint', 'data-group': 'content' }, h('strong', { html: icon('board', { size: 18 }) + ' Personal whiteboard' }), h('p', { class: 'small muted', style: { margin: '.3rem 0 .7rem' } }, 'Sketch privately; share view-only inside any room.'), h('a', { class: 'btn sm', href: '/whiteboard', 'data-link': '' }, 'Open board')))));
  if (location.hash === '#hosting') setTimeout(() => document.getElementById('hosting')?.scrollIntoView({ behavior: 'smooth' }), 100);
}
