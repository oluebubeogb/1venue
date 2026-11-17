// Shared building blocks: event cards, posts, comment threads, people rows.
import { icon, LOGO_ART } from './icons.js';
import { h, api, avatar, timeAgo, fmtDate, fmtNum, toast, toastErr, esc, confirmDlg, frag, profilePath } from './ui.js';
import { state, navigate, requireLogin } from './app.js';
import { pillComposer } from './composer.js';
import { passageCard } from './passage.js';

function linkify(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s<]+|\/a\/[a-f0-9]{32,})/g, (m) =>
      `<a class="feed-link-chip" href="${m}" data-link><span class="feed-link-ic">${icon('link', { size: 13 })}</span><span class="feed-link-url">${m}</span></a>`);
}

export const CAT = {
  talk_show: ['Talk show', 'tv', '#db2777'], presentation: ['Presentation', 'presentation', '#2563eb'], seminar: ['Seminar', 'graduation', '#7c3aed'],
  sermon: ['Sermon', 'church', '#b7791f'], webinar: ['Webinar', 'globe', '#0891b2'], workshop: ['Workshop', 'wrench', '#ea580c'],
  meeting: ['Meeting', 'users', '#475569'], concert: ['Concert', 'music', '#e11d48'], class: ['Class', 'book', '#059669'], other: ['Event', 'sparkle', '#64748b'],
};
export const catOf = (k) => CAT[k] || CAT.other;

export function eventCard(ev, { compact = false } = {}) {
  const [cl, ci, cc] = catOf(ev.category);
  const live = ev.status === 'live' || ev.live;
  const c1 = ev.theme?.accent || cc, c2 = ev.theme?.accent2 || 'var(--accent-2)';
  const viewers = ev.live?.viewers ?? ev.liveViewers ?? 0;
  const a = h('a', { class: 'card hover ev-card', href: `/e/${ev.slug}`, 'data-link': '' },
    h('div', { class: 'cover', style: { '--c1': c1, '--c2': c2 } },
      ev.coverUrl ? h('img', { src: ev.coverUrl, alt: '', loading: 'lazy' }) : h('div', { class: 'art', html: LOGO_ART }),
      live ? h('span', { class: 'pill live' }, 'LIVE') : ev.startsAt ? h('span', { class: 'pill', html: icon('calendar', { size: 12 }) + esc(fmtDate(ev.startsAt, { weekday: undefined })) }) : null,
      live && viewers ? h('span', { class: 'pill r', html: icon('eye', { size: 12 }) + fmtNum(viewers) }) : null),
    h('div', { class: 'body' },
      h('span', { class: 'cat', style: { '--g': cc }, html: icon(ci, { size: 13 }) + esc(cl) }),
      h('div', { class: 'title' }, ev.title),
      compact ? null : h('div', { class: 'meta' },
        h('span', null, avatar(ev.host?.name, ev.host?.avatarUrl, 'sm'), ev.host?.name || '', ev.host?.verified ? h('span', { class: 'verified-dot', title: 'Verified host', 'aria-label': 'Verified host', html: icon('check', { size: 11 }) }) : null),
        ev.rsvps ? h('span', { html: icon('ticket', { size: 14 }) + fmtNum(ev.rsvps) }) : null,
        ev.speakerSeats && ev.category !== 'meeting' ? h('span', { html: icon('stage', { size: 14 }) + ev.speakerSeats + ' seats' }) : null)));
  return a;
}
export const skeletonCards = (n = 6) => h('div', { class: 'grid-cards' }, Array.from({ length: n }, () => h('div', { class: 'skel', style: { height: '250px' } })));

export function followBtn(user, onChange) {
  const b = h('button', { class: `btn sm ${user.isFollowing ? '' : 'primary'}` });
  const paint = () => { b.innerHTML = user.isFollowing ? icon('userCheck', { size: 16 }) + 'Following' : icon('userPlus', { size: 16 }) + 'Follow'; b.className = `btn sm ${user.isFollowing ? '' : 'primary'}`; };
  paint();
  b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!requireLogin('Sign in to follow people')) return;
    const on = !user.isFollowing; user.isFollowing = on; paint();
    try { await api(`/api/users/${user.id}/follow`, { method: 'POST', body: { on } }); onChange && onChange(on); } catch (er) { user.isFollowing = !on; paint(); toastErr(er); }
  };
  return b;
}
export function personRow(u, { follow = true } = {}) {
  return h('a', { class: 'list-item', href: profilePath(u), 'data-link': '' }, avatar(u.name, u.avatarUrl),
    h('div', { class: 'grow' }, h('div', { class: 'list-item-name ellipsis' }, u.name), h('div', { class: 'tiny muted ellipsis' }, u.handle ? '@' + u.handle : (u.username ? '@' + u.username : ''), u.followers != null ? ` · ${fmtNum(u.followers)} followers` : '')),
    follow && state.user && state.user.id !== u.id ? followBtn(u) : null);
}

const POST_KIND = {
  event_scheduled: ['scheduled an event', 'calendar'],
  event_live: ['is live now', 'radio'],
  event_ended: ['wrapped up', 'check'],
  summary: ['shared a session summary', 'sparkles'],
};

/* Calendar leaf: month over day, the feed's mark for anything that happens at a time. */
export function dateLeaf(ev, { size = '' } = {}) {
  const live = ev && (ev.status === 'live' || ev.live);
  const t = ev && ev.startsAt ? new Date(ev.startsAt) : null;
  if (live) {
    return h('span', { class: `date-leaf is-live ${size}`, 'aria-label': 'Live now' },
      h('span', { class: 'date-leaf-m' }, 'Live'), h('span', { class: 'date-leaf-dot', 'aria-hidden': 'true' }));
  }
  if (!t || Number.isNaN(t.getTime())) {
    return h('span', { class: `date-leaf is-empty ${size}`, 'aria-hidden': 'true', html: icon('calendar', { size: 16 }) });
  }
  return h('span', { class: `date-leaf ${size}`, 'aria-label': fmtDate(t, { weekday: undefined }) },
    h('span', { class: 'date-leaf-m' }, t.toLocaleDateString(undefined, { month: 'short' })),
    h('span', { class: 'date-leaf-d' }, String(t.getDate())));
}
const timeOf = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };

/* Event posts read like a notice on the hall board: date leaf, title, kind and time, cover only when there is a real one. */
function feedEventBlock(ev) {
  if (!ev) return null;
  const [cl] = catOf(ev.category);
  const live = ev.status === 'live' || ev.live;
  const when = live ? 'On air now' : (ev.startsAt ? `${new Date(ev.startsAt).toLocaleDateString(undefined, { weekday: 'long' })}, ${timeOf(ev.startsAt)}` : 'Time to be announced');
  return h('a', { class: `feed-event${live ? ' is-live' : ''}`, href: `/e/${ev.slug}`, 'data-link': '' },
    ev.coverUrl ? h('div', { class: 'feed-event-cover' },
      h('img', { src: ev.coverUrl, alt: '', loading: 'lazy', onerror: (e) => e.target.parentNode.remove() })) : null,
    h('div', { class: 'feed-event-row' },
      dateLeaf(ev),
      h('div', { class: 'feed-event-text' },
        h('div', { class: 'feed-event-title' }, ev.title),
        h('div', { class: 'feed-event-meta' }, cl, h('span', { 'aria-hidden': 'true' }, ' · '), when)),
      h('span', { class: 'feed-event-go', 'aria-hidden': 'true', html: icon('chevronRight', { size: 18 }) })));
}

export function postCard(p, { onDelete } = {}) {
  const kind = POST_KIND[p.kind];
  const cnt = (n) => (n > 0 ? fmtNum(n) : '');
  const likeBtn = h('button', { class: `act${p.liked ? ' liked' : ''}`, type: 'button', 'data-group': 'engage', 'data-tip': 'Like', 'aria-label': 'Like', 'aria-pressed': p.liked ? 'true' : 'false', html: icon('heart', { size: 18 }) + `<span>${cnt(p.likeCount)}</span>` });
  likeBtn.onclick = async () => {
    if (!requireLogin('Sign in to like posts')) return;
    p.liked = !p.liked; p.likeCount += p.liked ? 1 : -1;
    likeBtn.classList.toggle('liked', p.liked);
    likeBtn.setAttribute('aria-pressed', p.liked ? 'true' : 'false');
    likeBtn.lastChild.textContent = cnt(p.likeCount);
    try {
      const r = await api(`/api/posts/${p.id}/like`, { method: 'POST' });
      if (r && r.likeCount != null) likeBtn.lastChild.textContent = cnt(r.likeCount);
    } catch (e) { toastErr(e); }
  };
  const thread = h('div', { class: 'feed-thread' });
  const cBtn = h('button', { class: 'act', type: 'button', 'data-group': 'social', 'data-tip': 'Comments', 'aria-label': 'Comments', html: icon('chat', { size: 18 }) + `<span>${cnt(p.commentCount)}</span>` });
  cBtn.onclick = () => {
    if (thread.firstChild) { thread.innerHTML = ''; return; }
    thread.append(commentThread('posts', p.id, { compact: true }));
  };
  const shareBtn = h('button', { class: 'act', type: 'button', 'data-group': 'content', 'data-tip': 'Share', 'aria-label': 'Share', html: icon('share', { size: 18 }) });
  shareBtn.onclick = () => shareLink(
    p.event ? `${location.origin}/e/${p.event.slug}` : `${location.origin}${profilePath(p.author)}`,
    p.event?.title || '1venue',
  );
  const bookmarkBtn = h('button', { class: 'act act-save', type: 'button', 'data-group': 'content', 'data-tip': 'Save', 'aria-label': 'Save', html: icon('bookmark', { size: 18 }) });
  bookmarkBtn.onclick = () => toast('Saved for later', { icon: 'bookmark', group: 'content' });

  const mine = state.user && p.author && state.user.id === p.author.id;
  const menuBtn = h('button', {
    class: 'icon-btn sm feed-more', type: 'button',
    'data-tip': 'More', 'aria-label': 'More',
    html: icon('moreHorizontal', { size: 18 }),
    onclick: async (e) => {
      e.stopPropagation();
      if (!mine) return toast('More actions coming soon', { icon: 'info' });
      if (await confirmDlg('Delete this post?', { ok: 'Delete', danger: true })) {
        await api(`/api/posts/${p.id}`, { method: 'DELETE' }).catch(toastErr);
        el.remove();
        onDelete && onDelete();
      }
    },
  });

  const isEventPost = !!(p.event && (p.kind === 'event_scheduled' || p.kind === 'event_live' || p.kind === 'event_ended' || !p.body));
  const el = h('article', { class: `card feed-post${isEventPost ? ' is-event' : ''}` },
    h('div', { class: 'feed-post-head' },
      h('a', { class: 'feed-post-av', href: profilePath(p.author), 'data-link': '' }, avatar(p.author.name, p.author.avatarUrl)),
      h('div', { class: 'feed-post-meta grow' },
        h('a', { class: 'name', href: profilePath(p.author), 'data-link': '' }, p.author.name),
        kind ? h('span', { class: 'feed-post-kind' }, kind[0]) : null,
        h('time', { class: 'feed-post-time', datetime: p.createdAt || '' }, timeAgo(p.createdAt))),
      menuBtn),
    p.body && (p.kind === 'post' || !p.kind)
      ? h('div', { class: 'feed-post-text', html: linkify(p.body) })
      : p.body && p.kind === 'summary'
        ? h('div', { class: 'feed-post-text prose small' }, p.body.slice(0, 600))
        : null,
    ...(p.media || []).filter((m) => m.type === 'passage').slice(0, 1).map((m) => passageCard(m)),
    ...(p.media || []).filter((m) => m.type !== 'passage' && /^image\//.test(m.mime || 'image/')).slice(0, 4).map((m) =>
      h('img', { class: 'feed-post-img', src: m.url, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() })),
    p.event ? feedEventBlock(p.event) : null,
    h('div', { class: 'feed-post-foot' },
      h('div', { class: 'acts' }, likeBtn, cBtn, shareBtn), bookmarkBtn),
    thread);
  return el;
}
export async function shareLink(url, title = '1venue') {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* cancelled */ } }
  try { await navigator.clipboard.writeText(url); toast('Link copied', { icon: 'link', group: 'content' }); } catch { prompt('Copy link', url); }
}

/* Social comment section (REST: events/posts). Likes, replies, owner/host hide. */
export function commentThread(kind, id, { compact = false, isHost = false } = {}) {
  const wrap = h('div', { class: 'col', style: { gap: '.2rem', marginTop: compact ? '.5rem' : 0 } });
  const list = h('div', { class: 'col', style: { gap: '.1rem' } });
  let replyTo = null;
  const replyChip = h('div', { class: 'tiny muted hidden', style: { padding: '.15rem .9rem 0' } });
  const pc = pillComposer({ placeholder: state.user ? 'Add to the conversation…' : 'Sign in to comment', voice: false, onSend: async (body) => {
    if (!requireLogin('Sign in to join the conversation')) return false;
    if (!body) return false;
    const c = await api(`/api/${kind}/${id}/comments`, { method: 'POST', body: { body, parentId: replyTo?.c.id || null } });
    list.querySelector('.no-comments')?.remove();
    if (replyTo) { replyTo.addReply(c); setReply(null); } else list.prepend(commentEl(c));
  } });
  const ta = pc.ta;
  function setReply(r) { replyTo = r; replyChip.classList.toggle('hidden', !r); replyChip.innerHTML = r ? `Replying to <strong>${esc(r.c.authorName)}</strong> · <a href="#" class="cancel">cancel</a>` : ''; if (r) { replyChip.querySelector('.cancel').onclick = (e) => { e.preventDefault(); setReply(null); }; ta.focus(); } }
  function commentEl(c, depth = 0) {
    const replies = h('div', { class: 'replies col', style: { gap: 0 } });
    const like = h('button', { class: `act${c.liked ? ' liked' : ''}`, 'data-group': 'engage', html: icon('heart', { size: 15 }) + `<span>${c.likeCount || ''}</span>` });
    like.onclick = async () => {
      if (!requireLogin('Sign in to like comments')) return;
      try { const r = await api(`/api/comments/${c.id}/like`, { method: 'POST' }); c.liked = r.liked; like.classList.toggle('liked', r.liked); like.lastChild.textContent = r.likeCount || ''; } catch (e) { toastErr(e); }
    };
    const addReply = (r) => { replies.append(commentEl(r, depth + 1)); c.replyCount = (c.replyCount || 0) + 1; };
    const replyBtn = depth === 0 ? h('button', { class: 'act', 'data-group': 'social', html: icon('reply', { size: 15 }) + 'Reply', onclick: () => setReply({ c, addReply }) }) : null;
    const more = c.replyCount && depth === 0 ? h('button', { class: 'act', html: icon('chevronDown', { size: 15 }) + `${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}` }) : null;
    if (more) more.onclick = async () => { more.remove(); try { const r = await api(`/api/comments/${c.id}/replies`); r.replies.forEach((x) => replies.append(commentEl(x, 1))); } catch (e) { toastErr(e); } };
    const canHide = c.mine || isHost;
    const el = h('div', { class: 'post', style: { padding: '.55rem .3rem' } },
      c.userId ? h('a', { href: profilePath({ username: c.username, id: c.userId }), 'data-link': '' }, avatar(c.authorName, c.avatarUrl, depth ? 'sm' : '')) : avatar(c.authorName, c.avatarUrl, depth ? 'sm' : ''),
      h('div', { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'head' }, h('span', { class: 'name small' }, c.authorName), h('span', { class: 'faint tiny' }, timeAgo(c.createdAt))),
        h('div', { class: 'text small' }, c.body),
        h('div', { class: 'acts' }, like, replyBtn, more,
          canHide ? h('button', { class: 'act', 'data-group': 'admin', 'data-tip': c.mine ? 'Delete' : 'Hide (host)', html: icon('trash', { size: 14 }), onclick: async () => { try { await api(`/api/comments/${c.id}`, { method: 'DELETE' }); el.remove(); } catch (e) { toastErr(e); } } }) : null),
        replies));
    return el;
  }
  wrap.append(h('div', { class: 'comment-compose' }, replyChip, pc.el), list);
  api(`/api/${kind}/${id}/comments`).then((r) => {
    if (!r.comments.length) list.append(h('div', { class: 'faint small no-comments', style: { padding: '.8rem .4rem' } }, 'No comments yet — start the conversation.'));
    r.comments.forEach((c) => list.append(commentEl(c)));
  }).catch(() => list.append(h('div', { class: 'faint small' }, 'Comments unavailable.')));
  return wrap;
}
export function sectionHead(title, ic, action) {
  return h('div', { class: 'section-h' }, h('h2', { html: (ic ? icon(ic, { size: 22 }) : '') + esc(title) }), action || null);
}
export function empty(ic, title, sub, action) {
  return h('div', { class: 'empty' }, frag(icon(ic, { size: 40 })), h('h3', null, title), sub ? h('p', { class: 'small', style: { marginTop: '.3rem' } }, sub) : null, action ? h('div', { style: { marginTop: '1rem' } }, action) : null);
}
