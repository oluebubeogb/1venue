import { icon } from '../icons.js';
import { h, api, esc, frag, fmtNum } from '../ui.js';
import { state, navigate, CATS, joinPrompt, parseCode } from '../app.js';
import { eventCard, skeletonCards, sectionHead, empty, catOf } from '../components.js';

let heroCarouselFrame = 0;

/** Homepage hero visual - lightweight preview cards around the join-first hero. */
function previewCards() {
  return [
    h('div', { class: 'hero-preview preview-poll' },
      h('div', { class: 'preview-kicker' }, 'POLL · 24 VOTES'),
      h('strong', null, 'What should we take first?'),
      h('div', { class: 'preview-row' }, h('span', null, 'Questions'), h('b', null, '62%')),
      h('div', { class: 'preview-meter' }, h('i', { style: { width: '62%' } })),
      h('div', { class: 'preview-row' }, h('span', null, 'Testimony'), h('b', null, '38%')),
      h('div', { class: 'preview-meter lavender' }, h('i', { style: { width: '38%' } }))),
    h('div', { class: 'hero-preview preview-live' },
      h('div', { class: 'live-thumb' }, h('span', { class: 'live-badge' }, '● LIVE'), h('img', { src: '/img/hero/meeting.png', alt: '' })),
      h('div', { class: 'preview-row' }, h('span', null, '128 viewers'), h('b', null, '16:45'))),
  ];
}

function mobileImages() {
  const images = [
    ['messages.png', 460, 752],
    ['amara-call.png', 1223, 1286],
    ['people-follow.png', 445, 493],
  ];
  return images.map(([file, width, height]) => h('img', {
    src: '/img/hero/' + file, width, height, alt: '', loading: 'eager', decoding: 'async', draggable: 'false',
  }));
}

function mobileCarousel() {
  return h('div', { class: 'hero-visual hero-mobile-carousel', 'aria-hidden': 'true' },
    h('div', { class: 'hero-carousel-track' },
      h('div', { class: 'hero-carousel-group' }, ...mobileImages()),
      h('div', { class: 'hero-carousel-group' }, ...mobileImages()),
      h('div', { class: 'hero-carousel-group' }, ...mobileImages())));
}

function band(cls, ...kids) {
  return h('section', { class: `home-band ${cls}` }, h('div', { class: 'band-inner' }, ...kids));
}

function startHeroCarousel(root) {
  if (heroCarouselFrame) cancelAnimationFrame(heroCarouselFrame);
  const carousel = root.querySelector('.hero-mobile-carousel');
  const group = carousel?.querySelector('.hero-carousel-group');
  if (!carousel || !group) return;

  const phoneWidth = matchMedia('(max-width: 560px)');
  let lastFrame = null;
  let loopWidth = 0;
  let phase = 0;
  const step = (now) => {
    if (!carousel.isConnected) {
      heroCarouselFrame = 0;
      return;
    }
    if (phoneWidth.matches && document.visibilityState === 'visible') {
      const width = group.getBoundingClientRect().width;
      if (width > 0) {
        if (loopWidth && width !== loopWidth) phase *= width / loopWidth;
        loopWidth = width;
        const elapsed = lastFrame === null ? 0 : Math.min(now - lastFrame, 50);
        // Wrap between matching views of the repeated images. The scroll position
        // stays away from both ends, with a full copy available on either side.
        phase = ((phase - elapsed * 0.03) % loopWidth + loopWidth) % loopWidth;
        carousel.scrollLeft = loopWidth + phase;
      }
      lastFrame = now;
    } else {
      lastFrame = null;
    }
    heroCarouselFrame = requestAnimationFrame(step);
  };
  heroCarouselFrame = requestAnimationFrame(step);
}

export async function mount(view) {
  const codeIn = h('input', { class: 'input', placeholder: 'Enter code, e.g. y5yi87', maxlength: 8, 'aria-label': 'Room code', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' });
  const joinGo = () => { const c = parseCode(codeIn.value); if (c) navigate(`/${c}`); else joinPrompt(); };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinGo());
  const hello = state.user ? `Welcome back, ${state.user.displayName.split(' ')[0]}` : 'Your stage is ready';
  document.body.dataset.page = 'home';
  const hero = h('section', { class: 'hero hero-join-first' },
    h('div', { class: 'hero-layout' },
      ...previewCards(),
      h('div', { class: 'hero-copy' },
        h('div', { class: 'eyebrow', html: esc(hello) }),
        h('h1', null, 'Host it. Stream it.', h('br', { class: 'hero-break', 'aria-hidden': 'true' }), ' ', h('span', { class: 'grad-text' }, 'Gather Everyone. Workspace Collaboration.')),
        h('p', null, 'Talk shows, seminars, sermons and team meetings - with speaker seats, live scripture, Nigerian-language captions and one-click AI summaries.'),
        h('div', { class: 'join-box' }, frag(icon('hash', { size: 20 })), codeIn, h('button', { class: 'btn primary', onclick: joinGo, html: icon('arrowRight', { size: 18 }) + 'Join' })),
        h('div', { class: 'row wrap hero-ctas' },
          h('a', { class: 'btn primary lg', href: '/create', 'data-link': '', html: icon('radio', { size: 20 }) + 'Go live' }),
          h('a', { class: 'btn lg hero-cta-icon', href: '/create?instant=1', 'data-link': '', 'data-group': 'media', 'data-tip': 'Instant meeting', 'aria-label': 'Instant meeting', html: icon('zap', { size: 20 }) + '<span class="lbl">Instant meeting</span>' }),
          h('a', { class: 'btn lg hero-cta-icon', href: '/venues', 'data-link': '', 'data-group': 'media', 'data-tip': 'Venue', 'aria-label': 'Venue', html: icon('door', { size: 20 }) + '<span class="lbl">Venue</span>' })),
        mobileCarousel())));

  const liveWrap = h('div', null, skeletonCards(3));
  const upWrap = h('div', null, skeletonCards(3));
  const cats = h('div', { class: 'chips free-grid' }, CATS.map(([k, l, ic]) => {
    const [, , c] = catOf(k);
    return h('a', { class: 'chip', href: `/discover?category=${k}`, 'data-link': '', style: { '--g': c, color: c }, html: icon(ic, { size: 16 }) + esc(l) });
  }));
  // Essence of Venue - Nike-style, not a feature checklist
  const feats = [
    ['stage', 'Own the room', 'When you speak, the room leans in. Seats are earned, not assumed.', 'people'],
    ['bookOpen', 'Word that travels', 'Scripture lands on every screen at the same moment - one voice, many places.', 'faith'],
    ['captions', 'Every tongue heard', 'What is said is seen - in the languages your people actually speak.', 'ai'],
    ['sparkles', 'Leave nothing behind', 'Walk away with the thread. Action items and catch-up, ready when you are.', 'ai'],
    ['poll', 'The room talks back', 'Questions rise. Votes land. The conversation stays alive.', 'engage'],
    ['board', 'Think out loud', 'Sketch the idea. Share only when it is ready.', 'content'],
  ];

  view.append(
    hero,
    band('band-a',
      sectionHead('Live now', 'radio', h('a', { class: 'btn sm ghost', href: '/discover?status=live', 'data-link': '', html: 'See all' + icon('chevronRight', { size: 16 }) })),
      liveWrap),
    band('band-b',
      sectionHead('Browse by vibe', 'compass'),
      cats),
    band('band-c',
      sectionHead('Coming up', 'calendar', h('a', { class: 'btn sm ghost', href: '/discover', 'data-link': '', html: 'Discover' + icon('chevronRight', { size: 16 }) })),
      upWrap),
    band('band-d',
      sectionHead('Why Venue', 'zap'),
      h('div', { class: 'grid-cards stagger feat-stagger' }, feats.map(([ic, t, d, g]) => h('div', { class: 'card pad group-tint', 'data-group': g },
        h('div', { class: 'row' }, h('span', { class: 'ico-tile', style: { color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }, html: icon(ic, { size: 22 }) }), h('strong', null, t)),
        h('p', { class: 'muted small', style: { marginTop: '.5rem' } }, d))))),
    h('div', { style: { height: '2rem' } }));
  startHeroCarousel(view);

  const [live, up] = await Promise.all([
    api('/api/discover?status=live&limit=6').catch(() => ({ events: [] })),
    api('/api/discover?status=upcoming&limit=9').catch(() => ({ events: [] })),
  ]);
  liveWrap.innerHTML = ''; upWrap.innerHTML = '';
  liveWrap.append(live.events.length
    ? h('div', { class: 'grid-cards stagger' }, live.events.map((e) => eventCard(e)))
    : h('div', { class: 'card pad layer row wrap', style: { gap: '1rem' } },
      h('span', { class: 'ico-tile', 'data-group': 'engage', style: { color: 'var(--accent)' }, html: icon('radio', { size: 22 }) }),
      h('div', { class: 'grow' }, h('strong', null, 'Nobody is live right now'), h('div', { class: 'muted small' }, 'Be the first - your audience can find you here.')),
      h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, 'Go live')));
  upWrap.append(up.events.length
    ? h('div', { class: 'grid-cards stagger' }, up.events.map((e) => eventCard(e)))
    : empty('calendar', 'No upcoming events yet', 'Schedule a talk show, seminar or service and it will show up here.'));
}
export const barPinned = null;
export function unmount() {
  if (heroCarouselFrame) cancelAnimationFrame(heroCarouselFrame);
  heroCarouselFrame = 0;
  if (document.body.dataset.page === 'home') delete document.body.dataset.page;
}
