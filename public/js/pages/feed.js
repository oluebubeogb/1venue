import { icon } from '../icons.js';
import { h, api, toast, toastErr, avatar, uploadFile } from '../ui.js';
import { state, requireLogin } from '../app.js';
import { postCard, empty, personRow, sectionHead } from '../components.js';
import { passageCard } from '../passage.js';

export function composer(onPost, { prefill = '', eventId, passage = null, autofocus = false } = {}) {
  const ta = h('textarea', { class: 'textarea', placeholder: 'Share a thought, a verse, or what you’re hosting next…', rows: 2, maxlength: 2000 });
  ta.value = prefill;
  let media = [];
  const thumbs = h('div', { class: 'row wrap' });
  const pBox = h('div');
  const paintPassage = () => pBox.replaceChildren(...(passage ? [passageCard(passage, { compact: true, onRemove: () => { passage = null; paintPassage(); } })] : []));
  paintPassage();
  if (autofocus) setTimeout(() => ta.focus(), 120);
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  file.onchange = async () => { const f = file.files[0]; if (!f) return; try { const r = await uploadFile(f, { purpose: 'post' }); media.push({ url: r.url, mime: r.mime }); thumbs.append(h('img', { src: r.url, alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '10px' } })); } catch (e) { toastErr(e); } };
  const btn = h('button', { class: 'btn primary sm', html: icon('send', { size: 16 }) + 'Post' });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(240, ta.scrollHeight) + 'px'; });
  btn.onclick = async () => {
    if (!requireLogin('Sign in to post')) return;
    if (!ta.value.trim() && !media.length && !passage) return;
    btn.disabled = true;
    try { const p = await api('/api/posts', { method: 'POST', body: { body: ta.value.trim(), media: passage ? [{ type: 'passage', ...passage }, ...media] : media, eventId } }); ta.value = ''; media = []; passage = null; paintPassage(); thumbs.innerHTML = ''; onPost && onPost(p); toast('Posted', { icon: 'check', group: 'social' }); } catch (e) { toastErr(e); } finally { btn.disabled = false; }
  };
  return h('div', { class: 'card pad layer compose-card' }, h('div', { class: 'row', style: { alignItems: 'flex-start' } }, state.user ? avatar(state.user.displayName, state.user.avatarUrl) : null, h('div', { class: 'grow col', style: { gap: '.5rem' } }, ta, pBox, thumbs,
    h('div', { class: 'row between' }, h('div', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Add photo', 'aria-label': 'Add photo', html: icon('image'), onclick: () => file.click() }), file,
      h('a', { class: 'icon-btn', href: '/bible', 'data-link': '', 'data-group': 'faith', 'data-tip': 'Share a verse', 'aria-label': 'Share a verse', html: icon('bookOpen') })), btn))));
}

export async function mount(view, params) {
  const list = h('div', { class: 'col', style: { gap: '.8rem' } }, h('div', { class: 'skel', style: { height: '140px' } }), h('div', { class: 'skel', style: { height: '140px' } }));
  const prefill = sessionStorage.getItem('venue.compose') || ''; sessionStorage.removeItem('venue.compose');
  let passage = null; try { passage = JSON.parse(sessionStorage.getItem('venue.compose.passage') || 'null'); } catch { /* */ } sessionStorage.removeItem('venue.compose.passage');
  const comp = state.user ? composer((p) => list.prepend(postCard(p)), { prefill, passage }) : h('div', { class: 'card pad layer row between' }, h('span', { class: 'muted' }, 'Sign in to post, like and comment.'), h('a', { class: 'btn primary sm', href: '/login?next=/feed', 'data-link': '' }, 'Sign in'));
  const side = h('aside', { class: 'col sticky', style: { gap: '1rem' } });
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('feed', { size: 28 }) + 'Feed' }), h('p', { class: 'muted' }, 'Updates from hosts and friends you follow — plus what’s live.')),
    h('div', { class: 'split' }, h('div', { class: 'col', style: { gap: '1rem' } }, comp, list), side));
  if (params.compose && state.user) setTimeout(() => comp.querySelector('textarea')?.focus(), 100);
  let before = null, loading = false, done = false;
  const more = h('div', { style: { height: '40px' } });
  async function page() {
    if (loading || done) return; loading = true;
    try {
      const r = await api('/api/feed' + (before ? `?before=${encodeURIComponent(before)}` : ''));
      if (!before) list.innerHTML = '';
      r.posts.forEach((p) => list.append(postCard(p)));
      if (!r.posts.length && !before) list.append(empty('feed', 'Your feed is quiet', 'Follow hosts or post something to get it going.'));
      if (r.posts.length < 20) done = true; else before = r.posts[r.posts.length - 1].createdAt;
      list.append(more);
    } catch (e) { toastErr(e); } finally { loading = false; }
  }
  const io = new IntersectionObserver((es) => es[0].isIntersecting && page()); io.observe(more);
  await page();
  api('/api/people/suggested').then((r) => { if (r.people.length) side.append(h('div', { class: 'card pad layer' }, h('strong', { html: icon('userPlus', { size: 18 }) + ' Who to follow' }), r.people.map((u) => personRow(u)))); }).catch(() => {});
  return { unmount: () => io.disconnect() };
}
