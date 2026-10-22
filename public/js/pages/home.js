import { icon } from '../icons.js';
import { h, api, esc, frag, fmtNum } from '../ui.js';
import { state, navigate, CATS, joinPrompt } from '../app.js';
import { eventCard, skeletonCards, sectionHead, empty, catOf } from '../components.js';
import { inlineBanner } from '../pwa.js';

export async function mount(view) {
  const CODE = /^\s*([a-z]{3})[\s-]?(\d{3})\s*$/i;
  const codeIn = h('input', { class: 'input', placeholder: 'Enter code  e.g. ABC-234', maxlength: 8, 'aria-label': 'Room code', autocapitalize: 'characters' });
  const joinGo = () => { const m = codeIn.value.match(CODE); if (m) navigate(`/${m[1].toUpperCase()}-${m[2]}`); else joinPrompt(); };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinGo());
  const hello = state.user ? `Welcome back, ${state.user.displayName.split(' ')[0]}` : 'Your stage is ready';
  const hero = h('section', { class: 'hero' },
    h('div', { class: 'eyebrow', html: icon('sparkles', { size: 16 }) + esc(hello) }),
    h('h1', null, 'Host it. Stream it. ', h('span', { class: 'grad-text' }, 'Gather everyone.')),
    h('p', null, 'Talk shows, seminars, sermons and team meetings — with speaker seats, live scripture, Nigerian-language captions and one-click AI summaries.'),
    h('div', { class: 'row wrap', style: { marginTop: '1.2rem', gap: '.7rem' } },
      h('a', { class: 'btn primary lg', href: '/create', 'data-link': '', html: icon('radio', { size: 20 }) + 'Go live' }),
      h('a', { class: 'btn lg', href: '/create?instant=1', 'data-link': '', 'data-group': 'media', html: icon('zap', { size: 20 }) + 'Instant meeting' })),
    h('div', { class: 'join-box' }, frag(icon('hash', { size: 20 })), codeIn, h('button', { class: 'btn primary', onclick: joinGo, html: icon('arrowRight', { size: 18 }) + 'Join' })));
  const liveWrap = h('div', null, skeletonCards(3));
  const upWrap = h('div', null, skeletonCards(3));
  const cats = h('div', { class: 'chips hscroll' }, CATS.map(([k, l, ic]) => { const [, , c] = catOf(k); return h('a', { class: 'chip', href: `/discover?category=${k}`, 'data-link': '', style: { '--g': c }, html: icon(ic, { size: 16 }) + esc(l) }); }));
  const feats = [
    ['stage', 'Speaker seats', 'Limited seats with a request-to-speak queue the host approves.', 'people'],
    ['bookOpen', 'Live scripture', '18 open Bible translations, synced to every screen.', 'faith'],
    ['captions', 'Nigerian STT', 'N-ATLaS transcripts in English, Yorùbá, Igbo, Hausa & Pidgin.', 'ai'],
    ['sparkles', 'AI summaries', 'Summaries, action items and catch-me-up in one tap.', 'ai'],
    ['poll', 'Polls & Q&A', 'Upvoted questions, live polls, reactions and comments.', 'engage'],
    ['board', 'Personal whiteboard', 'Your own board — share it view-only when you choose.', 'content'],
  ];
  view.append(
    hero,
    inlineBanner('home') || '',
    sectionHead('Live now', 'radio', h('a', { class: 'btn sm ghost', href: '/discover?status=live', 'data-link': '', html: 'See all' + icon('chevronRight', { size: 16 }) })), liveWrap,
    sectionHead('Browse by vibe', 'compass'), cats,
    sectionHead('Coming up', 'calendar', h('a', { class: 'btn sm ghost', href: '/discover', 'data-link': '', html: 'Discover' + icon('chevronRight', { size: 16 }) })), upWrap,
    sectionHead('Built for gatherings', 'zap'),
    h('div', { class: 'grid-cards stagger' }, feats.map(([ic, t, d, g]) => h('div', { class: 'card pad group-tint', 'data-group': g },
      h('div', { class: 'row' }, h('span', { class: 'ico-tile', html: icon(ic, { size: 22 }) }), h('strong', null, t)), h('p', { class: 'muted small', style: { marginTop: '.5rem' } }, d)))),
    h('div', { style: { height: '2rem' } }));
  const [live, up] = await Promise.all([api('/api/discover?status=live&limit=6').catch(() => ({ events: [] })), api('/api/discover?status=upcoming&limit=9').catch(() => ({ events: [] }))]);
  liveWrap.innerHTML = ''; upWrap.innerHTML = '';
  liveWrap.append(live.events.length ? h('div', { class: 'grid-cards stagger' }, live.events.map((e) => eventCard(e)))
    : h('div', { class: 'card pad layer row wrap', style: { gap: '1rem' } }, h('span', { class: 'ico-tile', 'data-group': 'engage', html: icon('radio', { size: 22 }) }), h('div', { class: 'grow' }, h('strong', null, 'Nobody is live right now'), h('div', { class: 'muted small' }, 'Be the first — your audience can find you here.')), h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, 'Go live')));
  upWrap.append(up.events.length ? h('div', { class: 'grid-cards stagger' }, up.events.map((e) => eventCard(e))) : empty('calendar', 'No upcoming events yet', 'Schedule a talk show, seminar or service and it will show up here.'));
}
export const barPinned = null;
