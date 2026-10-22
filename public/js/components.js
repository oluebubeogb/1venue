// Shared building blocks: event cards, posts, comment threads, people rows.
import { icon } from './icons.js';
import { h, api, avatar, timeAgo, fmtDate, fmtNum, toast, toastErr, esc, confirmDlg, frag } from './ui.js';
import { state, navigate, requireLogin } from './app.js';

export const CAT = {
  talk_show: ['Talk show', 'tv', '#db2777'], presentation: ['Presentation', 'presentation', '#2563eb'], seminar: ['Seminar', 'graduation', '#7c3aed'],
  sermon: ['Sermon', 'church', '#b7791f'], webinar: ['Webinar', 'globe', '#0891b2'], workshop: ['Workshop', 'wrench', '#ea580c'],
  meeting: ['Meeting', 'users', '#475569'], concert: ['Concert', 'music', '#e11d48'], class: ['Class', 'book', '#059669'], other: ['Event', 'sparkle', '#64748b'],
};
export const catOf = (k) => CAT[k] || CAT.other;
const LOGO_ART = '<svg viewBox="0 0 160 160" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M36 54 L62 34 L62 122" stroke-width="16"/><path d="M88 36 L128 62 L128 118 L88 118 L88 98" stroke-width="5.5"/></svg>';

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
        h('span', null, avatar(ev.host?.name, ev.host?.avatarUrl, 'sm'), ev.host?.name || ''),
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
  return h('a', { class: 'list-item', href: `/u/${u.id}`, 'data-link': '' }, avatar(u.name, u.avatarUrl),
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 }, class: 'ellipsis' }, u.name), h('div', { class: 'tiny muted ellipsis' }, u.handle ? '@' + u.handle : '', u.followers != null ? ` · ${fmtNum(u.followers)} followers` : '')),
    follow && state.user && state.user.id !== u.id ? followBtn(u) : null);
}

const POST_KIND = { event_scheduled: ['scheduled an event', 'calendar'], event_live: ['is live now', 'radio'], event_ended: ['wrapped up', 'check'], summary: ['shared a session summary', 'sparkles'] };
export function postCard(p, { onDelete } = {}) {
  const kind = POST_KIND[p.kind];
  const likeBtn = h('button', { class: `act${p.liked ? ' liked' : ''}`, 'data-group': 'engage', 'data-tip': 'Like', html: icon('heart', { size: 18 }) + `<span>${fmtNum(p.likeCount)}</span>` });
  likeBtn.onclick = async () => {
    if (!requireLogin('Sign in to like posts')) return;
    p.liked = !p.liked; p.likeCount += p.liked ? 1 : -1; likeBtn.classList.toggle('liked', p.liked); likeBtn.lastChild.textContent = fmtNum(p.likeCount);
    try { const r = await api(`/api/posts/${p.id}/like`, { method: 'POST' }); if (r && r.likeCount != null) likeBtn.lastChild.textContent = fmtNum(r.likeCount); } catch (e) { toastErr(e); }
  };
  const thread = h('div');
  const cBtn = h('button', { class: 'act', 'data-group': 'social', 'data-tip': 'Comments', html: icon('chat', { size: 18 }) + `<span>${fmtNum(p.commentCount)}</span>` });
  cBtn.onclick = () => { if (thread.firstChild) { thread.innerHTML = ''; return; } thread.append(commentThread('posts', p.id, { compact: true })); };
  const shareBtn = h('button', { class: 'act', 'data-group': 'content', 'data-tip': 'Share', html: icon('share', { size: 18 }) });
  shareBtn.onclick = () => shareLink(p.event ? `${location.origin}/e/${p.event.slug}` : `${location.origin}/u/${p.author.id}`, p.event?.title || '1venue');
  const mine = state.user && p.author && state.user.id === p.author.id;
  const el = h('article', { class: 'card post' },
    h('a', { href: `/u/${p.author.id}`, 'data-link': '' }, avatar(p.author.name, p.author.avatarUrl)),
    h('div', { class: 'grow', style: { minWidth: 0 } },
      h('div', { class: 'head' }, h('a', { class: 'name', href: `/u/${p.author.id}`, 'data-link': '' }, p.author.name),
        kind ? h('span', { class: 'muted small', html: icon(kind[1], { size: 14, cls: 'inline' }) + ' ' + kind[0] }) : null,
        h('span', { class: 'faint small' }, '· ' + timeAgo(p.createdAt))),
      p.body && p.kind === 'post' ? h('div', { class: 'text' }, p.body) : p.body && p.kind === 'summary' ? h('div', { class: 'text prose small' }, p.body.slice(0, 600)) : null,
      (p.media || []).filter((m) => /^image\//.test(m.mime || 'image/')).slice(0, 4).map((m) => h('img', { src: m.url, alt: '', loading: 'lazy', style: { borderRadius: '14px', marginTop: '.6rem', maxHeight: '420px', objectFit: 'cover', width: '100%' } })),
      p.event ? h('div', { style: { marginTop: '.7rem', maxWidth: '420px' } }, eventCard(p.event, { compact: true })) : null,
      h('div', { class: 'acts' }, likeBtn, cBtn, shareBtn,
        mine ? h('button', { class: 'act', 'data-group': 'admin', 'data-tip': 'Delete', html: icon('trash', { size: 16 }), onclick: async () => { if (await confirmDlg('Delete this post?', { ok: 'Delete', danger: true })) { await api(`/api/posts/${p.id}`, { method: 'DELETE' }).catch(toastErr); el.remove(); onDelete && onDelete(); } } }) : null),
      thread));
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
  const ta = h('textarea', { class: 'textarea', placeholder: state.user ? 'Add to the conversation…' : 'Sign in to comment', rows: 1, maxlength: 2000 });
  const send = h('button', { class: 'icon-btn', 'data-group': 'social', 'data-tip': 'Post', 'aria-label': 'Post comment', html: icon('send') });
  let replyTo = null;
  const replyChip = h('div', { class: 'tiny muted hidden', style: { padding: '0 .7rem' } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  async function submit() {
    if (!requireLogin('Sign in to join the conversation')) return;
    const body = ta.value.trim(); if (!body) return;
    send.disabled = true;
    try {
      const c = await api(`/api/${kind}/${id}/comments`, { method: 'POST', body: { body, parentId: replyTo?.c.id || null } });
      ta.value = ''; ta.style.height = '';
      if (replyTo) { replyTo.addReply(c); setReply(null); } else list.prepend(commentEl(c));
    } catch (e) { toastErr(e); } finally { send.disabled = false; }
  }
  send.onclick = submit;
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
      c.userId ? h('a', { href: `/u/${c.userId}`, 'data-link': '' }, avatar(c.authorName, c.avatarUrl, depth ? 'sm' : '')) : avatar(c.authorName, c.avatarUrl, depth ? 'sm' : ''),
      h('div', { class: 'grow', style: { minWidth: 0 } },
        h('div', { class: 'head' }, h('span', { class: 'name small' }, c.authorName), h('span', { class: 'faint tiny' }, timeAgo(c.createdAt))),
        h('div', { class: 'text small' }, c.body),
        h('div', { class: 'acts' }, like, replyBtn, more,
          canHide ? h('button', { class: 'act', 'data-group': 'admin', 'data-tip': c.mine ? 'Delete' : 'Hide (host)', html: icon('trash', { size: 14 }), onclick: async () => { try { await api(`/api/comments/${c.id}`, { method: 'DELETE' }); el.remove(); } catch (e) { toastErr(e); } } }) : null),
        replies));
    return el;
  }
  wrap.append(h('div', { class: 'layer', style: { borderRadius: '18px' } }, h('div', { class: 'composer' }, state.user ? avatar(state.user.displayName, state.user.avatarUrl, 'sm') : frag(icon('chat')), ta, send), replyChip), list);
  api(`/api/${kind}/${id}/comments`).then((r) => {
    if (!r.comments.length) list.append(h('div', { class: 'faint small', style: { padding: '.8rem .4rem' } }, 'No comments yet — start the conversation.'));
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
