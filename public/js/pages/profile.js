import { icon } from '../icons.js';
import { h, api, toast, toastErr, avatar, fmtNum, sheet, uploadFile } from '../ui.js';
import { state, navigate, requireLogin, refreshSession } from '../app.js';
import { postCard, eventCard, empty, followBtn, shareLink } from '../components.js';
import { composer } from './feed.js';

export async function mount(view, params) {
  let id = params.id;
  if (params.me) { if (!requireLogin('Sign in to see your profile')) return; id = state.user.id; }
  const u = await api(`/api/users/${id}`);
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'col', style: { gap: '.8rem', marginTop: '1rem' } });
  let tab = 'timeline';
  const paintTabs = () => { tabs.innerHTML = ''; [['timeline', 'Timeline', 'feed'], ['events', `Events · ${u.events?.length || 0}`, 'calendar']].forEach(([k, l, ic]) => tabs.append(h('button', { class: tab === k ? 'on' : '', html: icon(ic, { size: 16 }) + l, onclick: () => { tab = k; paintTabs(); load(); } }))); };
  async function load() {
    body.innerHTML = '';
    if (tab === 'events') { body.append(u.events?.length ? h('div', { class: 'grid-cards' }, u.events.map((e) => eventCard(e))) : empty('calendar', 'No public events yet')); return; }
    if (u.isMe) body.append(composer((p) => body.insertBefore(postCard(p), body.children[1] || null)));
    const r = await api(`/api/users/${id}/timeline`);
    r.posts.forEach((p) => body.append(postCard(p)));
    if (!r.posts.length) body.append(empty('feed', u.isMe ? 'Your timeline starts here' : 'Nothing posted yet', u.isMe ? 'Posts, events you host and session summaries you share appear here.' : null));
  }
  view.append(h('section', { class: 'profile-hero card' },
    h('div', { class: 'band' }),
    h('div', { class: 'in' }, avatar(u.name, u.avatarUrl, 'xxl ring'),
      h('div', { class: 'grow' }, h('h1', null, u.name), u.handle ? h('div', { class: 'muted' }, '@' + u.handle) : null, u.bio ? h('p', { style: { marginTop: '.4rem' } }, u.bio) : null,
        h('div', { class: 'row wrap small', style: { gap: '1.1rem', marginTop: '.6rem' } }, h('span', null, h('strong', null, fmtNum(u.followers)), ' followers'), h('span', null, h('strong', null, fmtNum(u.following)), ' following'), h('span', null, h('strong', null, fmtNum(u.events)), ' events'))),
      h('div', { class: 'row', style: { gap: '.4rem' } },
        u.isMe ? h('button', { class: 'btn sm', html: icon('pen', { size: 15 }) + 'Edit profile', onclick: () => edit(u) }) : state.user ? followBtn(u, (on) => { u.followers += on ? 1 : -1; }) : null,
        h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Share profile', 'aria-label': 'Share', html: icon('share'), onclick: () => shareLink(`${location.origin}/u/${u.id}`, u.name) })))),
  tabs, body);
  paintTabs(); load();
  if (params.edit && u.isMe) edit(u);
}
function edit(u) {
  const s = sheet({ title: 'Edit profile', icon: 'user', group: 'people' });
  const name = h('input', { class: 'input', value: u.name || '', placeholder: 'Display name', maxlength: 60 });
  const handle = h('input', { class: 'input', value: u.handle || '', placeholder: 'handle (letters, numbers, _ .)', maxlength: 30 });
  const bio = h('textarea', { class: 'textarea', rows: 3, placeholder: 'Short bio', maxlength: 400 }); bio.value = u.bio || '';
  let avatarUrl = u.avatarUrl;
  const av = h('div', { class: 'row' }, avatar(u.name, avatarUrl, 'lg'));
  const f = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  f.onchange = async () => { try { const r = await uploadFile(f.files[0], { purpose: 'avatar' }); avatarUrl = r.url; av.firstChild.replaceWith(avatar(u.name, avatarUrl, 'lg')); } catch (e) { toastErr(e); } };
  s.body.append(h('div', { class: 'col' }, h('div', { class: 'row' }, av, h('button', { class: 'btn sm', html: icon('image', { size: 15 }) + 'Change photo', onclick: () => f.click() }), f),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Display name'), name), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Handle'), handle), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Bio'), bio),
    h('button', { class: 'btn primary', onclick: async () => { try { await api('/api/profile', { method: 'PATCH', body: { displayName: name.value.trim(), handle: handle.value.trim(), bio: bio.value.trim(), avatarUrl } }); toast('Profile saved', { icon: 'check' }); s.close(); await refreshSession(); navigate('/me', { replace: true }); } catch (e) { toastErr(e); } } }, 'Save')));
}
