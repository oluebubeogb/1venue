// Bible passage cards: one look everywhere (feed posts, meeting chat, composer preview).
import { icon } from './icons.js';
import { h, sheet } from './ui.js';

export const passageUrl = (p) => `/bible?ref=${encodeURIComponent(p.reference)}${p.translation ? `&t=${encodeURIComponent(p.translation)}` : ''}`;

/** Card element for a passage {reference, text, translation, short}. `onRemove` adds an × (composer preview). */
export function passageCard(p, { onRemove, compact = false } = {}) {
  const text = String(p.text || '');
  const long = text.length > (compact ? 220 : 420);
  const body = h('blockquote', { class: `pc-text${long ? ' clamp' : ''}` }, text);
  const el = h('figure', { class: `passage-card${compact ? ' compact' : ''}`, 'data-group': 'faith' },
    h('figcaption', { class: 'pc-head' }, h('span', { class: 'pc-ic', html: icon('bookOpen', { size: 14 }) }),
      h('a', { class: 'pc-ref', href: passageUrl(p), 'data-link': '' }, p.reference), p.short ? h('span', { class: 'pc-tr' }, p.short) : null,
      onRemove ? h('button', { class: 'icon-btn sm pc-x', type: 'button', 'aria-label': 'Remove passage', html: icon('x', { size: 14 }), onclick: onRemove }) : null),
    body,
    long ? h('button', { class: 'pc-more', type: 'button', onclick: (e) => { body.classList.toggle('clamp'); e.target.textContent = body.classList.contains('clamp') ? 'Read more' : 'Show less'; } }, 'Read more') : null);
  return el;
}

/** Open the feed composer in a sheet with the passage attached (works inside a meeting without leaving it). */
export async function sharePassageToFeed(p) {
  const { state, requireLogin } = await import('./app.js');
  if (!state.user) return requireLogin('Sign in to post');
  const { composer } = await import('./pages/feed.js');
  const s = sheet({ title: 'Share to feed', icon: 'feed', group: 'social' });
  s.body.append(composer(() => s.close(), { passage: p, autofocus: true }));
}
