import { icon } from '../icons.js';
import { h, api, toast, toastErr, avatar, uploadFile } from '../ui.js';
import { state, requireLogin, loginUrl, navigate } from '../app.js';
import { postCard, empty } from '../components.js';
import { passageCard } from '../passage.js';

export function composer(onPost, { prefill = '', eventId, passage = null, autofocus = false } = {}) {
  const ta = h('textarea', {
    class: 'feed-compose-input',
    placeholder: 'Share a thought, a verse, or what you’re hosting next…',
    rows: 2,
    maxlength: 2000,
  });
  ta.value = prefill;
  let media = [];
  const thumbs = h('div', { class: 'row wrap feed-compose-thumbs' });
  const pBox = h('div');
  const paintPassage = () => pBox.replaceChildren(...(passage ? [passageCard(passage, { compact: true, onRemove: () => { passage = null; paintPassage(); } })] : []));
  paintPassage();
  if (autofocus) setTimeout(() => ta.focus(), 120);

  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const r = await uploadFile(f, { purpose: 'post' });
      media.push({ url: r.url, mime: r.mime });
      thumbs.append(h('img', { src: r.url, alt: '', class: 'feed-compose-thumb' }));
    } catch (e) { toastErr(e); }
  };

  const btn = h('button', { class: 'btn primary feed-post-btn', type: 'button', html: icon('send', { size: 16 }) + ' Post' });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, Math.max(44, ta.scrollHeight)) + 'px';
  });

  btn.onclick = async () => {
    if (!requireLogin('Sign in to post')) return;
    if (!ta.value.trim() && !media.length && !passage) return;
    btn.disabled = true;
    try {
      const p = await api('/api/posts', {
        method: 'POST',
        body: { body: ta.value.trim(), media: passage ? [{ type: 'passage', ...passage }, ...media] : media, eventId },
      });
      ta.value = ''; media = []; passage = null; paintPassage(); thumbs.innerHTML = '';
      onPost && onPost(p);
      toast('Posted', { icon: 'check', group: 'social' });
    } catch (e) { toastErr(e); } finally { btn.disabled = false; }
  };

  return h('div', { class: 'card feed-compose' },
    h('div', { class: 'feed-compose-top' },
      state.user ? avatar(state.user.displayName, state.user.avatarUrl) : null,
      ta),
    pBox, thumbs,
    h('div', { class: 'feed-compose-bar' },
      h('div', { class: 'feed-compose-tools' },
        h('button', { class: 'icon-btn sm', type: 'button', 'data-group': 'content', 'data-tip': 'Add photo', 'aria-label': 'Add photo', html: icon('image', { size: 18 }), onclick: () => file.click() }),
        file,
        h('span', { class: 'feed-compose-sep' }),
        h('button', { class: 'icon-btn sm', type: 'button', 'data-group': 'media', 'data-tip': 'Add video', 'aria-label': 'Add video', html: icon('video', { size: 18 }), onclick: () => toast('Video posts coming soon', { icon: 'info' }) }),
        h('span', { class: 'feed-compose-sep' }),
        h('a', { class: 'icon-btn sm', href: '/create', 'data-link': '', 'data-group': 'engage', 'data-tip': 'Schedule an event', 'aria-label': 'Schedule an event', html: icon('calendar', { size: 18 }) }),
      ),
      btn));
}

export async function mount(view, params) {
  const list = h('div', { class: 'feed-stream' },
    h('div', { class: 'skel', style: { height: '140px' } }),
    h('div', { class: 'skel', style: { height: '180px' } }));
  const prefill = sessionStorage.getItem('venue.compose') || '';
  sessionStorage.removeItem('venue.compose');
  let passage = null;
  try { passage = JSON.parse(sessionStorage.getItem('venue.compose.passage') || 'null'); } catch { /* */ }
  sessionStorage.removeItem('venue.compose.passage');

  let comp;
  if (state.user) {
    comp = composer((p) => list.prepend(postCard(p)), { prefill, passage });
  } else {
    const href = loginUrl('/feed');
    const a = h('a', { class: 'btn primary sm', href }, 'Sign in');
    if (!/^https?:/i.test(href)) a.setAttribute('data-link', '');
    comp = h('div', { class: 'card feed-compose row between', style: { padding: '1rem 1.1rem' } },
      h('span', { class: 'muted' }, 'Sign in to post, like and comment.'), a);
  }

  view.append(
    h('div', { class: 'page-head feed-page-head' },
      h('h1', { html: icon('feed', { size: 24 }) + ' Feed' })),
    h('div', { class: 'feed-layout' },
      h('div', { class: 'feed-main col' }, comp, list)));

  if (params.compose && state.user) setTimeout(() => comp.querySelector('textarea')?.focus(), 100);

  let before = null, loading = false, done = false;
  const more = h('div', { class: 'feed-sentinel' });
  async function page() {
    if (loading || done) return;
    loading = true;
    try {
      const r = await api('/api/feed' + (before ? `?before=${encodeURIComponent(before)}` : ''));
      if (!before) list.innerHTML = '';
      r.posts.forEach((p) => list.append(postCard(p)));
      if (!r.posts.length && !before) {
        list.append(empty('feed', 'Your feed is quiet', 'Follow hosts or post something to get it going.'));
      }
      if (r.posts.length < 20) done = true;
      else before = r.posts[r.posts.length - 1].createdAt;
      list.append(more);
    } catch (e) { toastErr(e); } finally { loading = false; }
  }
  const io = new IntersectionObserver((es) => es[0].isIntersecting && page());
  io.observe(more);
  await page();
  return { unmount: () => io.disconnect() };
}
