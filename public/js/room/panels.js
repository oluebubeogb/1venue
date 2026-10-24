// Room side panel: Chat (everyone / direct / groups), People (stage, waiting, hands, roster + moderation),
// Engage (polls, Q&A, comments) and Tools (scripture, captions, AI, boards, content, breakouts, …).
import { h, esc, api, toast, toastErr, avatar, timeAgo, menu, confirmDlg, promptDlg, readFileAsDataUrl, copy, debounce, md, uploadFile, sheet } from '../ui.js';
import { icon } from '../icons.js';
import { pillComposer } from '../composer.js';
import { searchSounds } from './sounds.js';
import { passageCard } from '../passage.js';

const I = (n, s = 18) => h('span', { class: 'i', html: icon(n, { size: s }) });
const btn = (ic, label, run, { group = '', cls = '', tip, disabled } = {}) => h('button', { class: `btn ${cls}`, 'data-group': group, 'data-tip': tip || null, disabled: !!disabled, type: 'button', onclick: run, html: icon(ic, { size: 16 }) + (label ? `<span>${esc(label)}</span>` : '') });
const ibtn = (ic, tip, run, { group = '', cls = '', on = false } = {}) => h('button', { class: `icon-btn ${cls}${on ? ' on' : ''}`, 'data-group': group, 'data-tip': tip, 'aria-label': tip, type: 'button', onclick: run, html: icon(ic, { size: 18 }) });
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)@([\w.-]{2,30})/g, '$1<b class="mention">@$2</b>');
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ROLE = { host: ['Host', 'crown'], cohost: ['Co-host', 'shield'], participant: ['', ''], guest: ['Guest', ''] };

export const TABS = [
  ['chat', 'Chat', 'chat', 'social'],
  ['people', 'People', 'users', 'people'],
  ['engage', 'Engage', 'poll', 'engage'],
  ['tools', 'Tools', 'wand', 'content'],
];

export function createPanel(R) {
  const el = h('aside', { class: 'rpanel', 'aria-label': 'Room panel' });
  const head = h('div', { class: 'rp-head' });
  const body = h('div', { class: 'rp-body' });
  const grab = h('div', { class: 'rp-grab', 'aria-hidden': 'true' }, h('i'));
  el.append(grab, head, body);
  let tab = null, sub = {};
  const tabBtns = {};
  head.append(h('div', { class: 'rp-tabs', role: 'tablist' }, TABS.map(([id, label, ic, g]) => (tabBtns[id] = h('button', { role: 'tab', 'data-group': g, type: 'button', onclick: () => open(id), html: icon(ic, { size: 17 }) + `<span>${label}</span><em class="badge" hidden></em>` })))),
    ibtn('x', 'Close panel', () => close(), { cls: 'rp-close' }));

  // swipe down to close on mobile
  let sy = null;
  grab.addEventListener('pointerdown', (e) => { sy = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', (e) => { if (sy != null) el.style.transform = `translateY(${Math.max(0, e.clientY - sy)}px)`; });
  grab.addEventListener('pointerup', (e) => { const d = e.clientY - (sy ?? e.clientY); sy = null; el.style.transform = ''; if (d > 90) close(); });

  function open(id, s) {
    if (s) sub[id] = s;
    tab = id; el.dataset.tab = id; el.classList.add('open'); R.root.classList.add('panel-open');
    Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('on', k === id));
    if (id === 'chat') R.unread.chat = 0;
    render(); badges(); R.refreshBar();
  }
  function close() { tab = null; el.classList.remove('open'); R.root.classList.remove('panel-open'); R.refreshBar(); }
  function toggle(id, s) { if (tab === id && !s) close(); else open(id, s); }
  function badges() {
    const n = { chat: R.unread.chat + R.unread.dm, people: (R.isMod() ? R.waiting.length + (R.stage.requests || []).length : 0) + R.hands.length, engage: R.unread.engage };
    for (const [k, b] of Object.entries(tabBtns)) { const e = b.querySelector('.badge'); const v = n[k] || 0; e.hidden = !v || tab === k; e.textContent = v > 99 ? '99+' : v; }
    R.refreshBar();
  }
  let rq = 0;
  function render() { cancelAnimationFrame(rq); rq = requestAnimationFrame(doRender); }
  function doRender() {
    if (!tab) return;
    const hadFocus = document.activeElement && body.contains(document.activeElement) && document.activeElement.matches('[data-focus]');
    if (hadFocus) R.focusNext = true;
    const keep = body.scrollTop, stick = body.scrollHeight - body.clientHeight - body.scrollTop < 40;
    const view = { chat: chatView, people: peopleView, engage: engageView, tools: toolsView }[tab]();
    body.replaceChildren(view);
    if (body.querySelector('[data-autoscroll]') && (stick || R.justSent)) body.scrollTop = body.scrollHeight; else body.scrollTop = keep;
    R.justSent = false;
    const f = body.querySelector('[data-focus]'); if (f && R.focusNext) { f.focus(); R.focusNext = false; }
  }
  const isOpen = (id) => tab === id;
  const refresh = (area) => { badges(); if (!tab) return; if (!area || area === tab || (area === 'dm' && tab === 'chat')) render(); };
  const seg = (items, cur, onPick) => h('div', { class: 'seg block' }, items.map(([v, l, n]) => h('button', { class: v === cur ? 'on' : '', type: 'button', onclick: () => onPick(v) }, l, n ? h('em', { class: 'badge' }, n) : null)));

  /* ------------------------------------------------------------ CHAT */
  function viewImage(src, name) { const s2 = sheet({ title: name || 'Photo', icon: 'image', wide: true }); s2.body.append(h('img', { src, alt: name || '', style: { width: '100%', borderRadius: '12px' } })); }
  function msgEl(m, { mine, name, at }) {
    const a = m.attachment;
    let att = null;
    const src = a && (a.url || a.dataUrl);
    if (a && a.kind === 'passage') att = passageCard(a, { compact: true });
    else if (src) {
      const kb = a.size ? (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(a.size / 1024)) + ' KB') : '';
      if (a.kind === 'image') att = h('img', { class: 'msg-img', src, alt: a.name || 'image', loading: 'lazy', onclick: () => viewImage(src, a.name) });
      else if (a.kind === 'voice') att = h('audio', { class: 'msg-voice', controls: true, src, preload: 'metadata' });
      else att = h('a', { class: 'msg-file', href: src, target: '_blank', rel: 'noopener', download: a.name || 'file', html: icon('file', { size: 18 }) + `<span>${esc(a.name || 'file')}</span>${kb ? `<small>${kb}</small>` : ''}` });
    }
    return h('div', { class: `msg${mine ? ' mine' : ''}` }, mine ? null : avatar(name, null, 'sm'),
      h('div', { class: 'bubble' }, mine ? null : h('b', { class: 'who' }, name), m.text ? h('div', { class: 'txt', html: linkify(m.text) }) : null, att, h('time', null, fmtTime(at))));
  }
  // One composer per conversation, reused across re-renders so text, uploads and recordings survive.
  const composers = new Map();
  function composer({ placeholder, onSend, disabled }) {
    const key = placeholder + (disabled ? ':off' : '');
    let c = composers.get(key);
    if (!c) {
      c = pillComposer({ placeholder, disabled, drafts: R.drafts, draftKey: 'draft:' + placeholder, limits: R.config.storage?.limits,
        upload: (f, purpose) => uploadFile(f, { purpose, headers: R.headers() }),
        suggest: (t) => (t.length <= 24 ? searchSounds(t).map((sd) => ({ glyph: sd.emoji, label: sd.label, tip: `Play ${sd.label} for everyone`, run: () => { R.playRoomSound(sd.id); c.clear(); } })) : []),
        onSend: (text, att) => { (c.onSend)(text, att); R.justSent = true; R.focusNext = true; } });
      composers.set(key, c);
    }
    c.onSend = onSend;
    return c.el;
  }
  function chatView() {
    const mode = sub.chat || 'all';
    const dmN = R.unread.dm;
    const wrap = h('div', { class: 'chat-view' }, seg([['all', 'Everyone'], ['dm', 'Direct', dmN], ['groups', 'Groups']], mode, (v) => { sub.chat = v; R.dmWith = null; R.groupOpen = null; render(); }));
    const canChat = R.perm('chat') && R.security.chat !== false || R.isMod();
    if (mode === 'all') {
      const list = h('div', { class: 'msgs', 'data-autoscroll': '' });
      if (!R.data.chat.length) list.append(h('div', { class: 'empty sm' }, I('chats', 28), h('p', null, 'Say hi 👋 — messages are visible to everyone in the room.')));
      R.data.chat.forEach((m) => list.append(msgEl(m, { mine: m.participantId === R.me.id, name: m.name, at: m.at })));
      wrap.append(list, composer({ placeholder: 'Message everyone…', disabled: !canChat, onSend: (text, attachment) => {
        const mentions = [...text.matchAll(/@([\w.-]{2,30})/g)].map((x) => x[1].toLowerCase());
        const ids = R.people().filter((p) => mentions.some((m) => p.name.toLowerCase().replace(/\s+/g, '').startsWith(m))).map((p) => p.id);
        R.send('chat', { text, mentions: ids, attachment });
      } }));
    } else if (mode === 'dm') {
      if (R.dmWith) {
        const p = R.p(R.dmWith) || { id: R.dmWith, name: R.dmNames[R.dmWith] || 'Participant' };
        const list = h('div', { class: 'msgs', 'data-autoscroll': '' });
        const msgs = R.data.dms.filter((m) => (m.fromId === p.id && m.toId === R.me.id) || (m.toId === p.id && m.fromId === R.me.id));
        R.dmRead[p.id] = msgs.length; R.recountDm();
        if (!msgs.length) list.append(h('div', { class: 'empty sm' }, I('lock', 26), h('p', null, `Private conversation with ${p.name}. Only you two can see this.`)));
        msgs.forEach((m) => list.append(msgEl(m, { mine: m.fromId === R.me.id, name: m.fromName, at: m.at })));
        wrap.append(h('div', { class: 'row sub-head' }, ibtn('chevronLeft', 'Back', () => { R.dmWith = null; render(); }), avatar(p.name, null, 'sm'), h('b', { class: 'grow' }, p.name)),
          list, composer({ placeholder: `Message ${p.name}…`, disabled: !canChat, onSend: (text, attachment) => R.send('private-chat', { targetId: p.id, text, attachment, targetName: p.name, targetUserId: p.userId || null }) }));
      } else {
        const list = h('div', { class: 'list' });
        const others = R.people().filter((p) => p.id !== R.me.id);
        if (!others.length) list.append(h('div', { class: 'empty sm' }, I('users', 26), h('p', null, 'Nobody else is here yet.')));
        others.forEach((p) => {
          const msgs = R.data.dms.filter((m) => m.fromId === p.id || m.toId === p.id);
          const last = msgs[msgs.length - 1]; const unread = msgs.filter((m) => m.fromId === p.id).length - (R.dmRead[p.id] || 0);
          list.append(h('button', { class: 'list-item', type: 'button', onclick: () => { R.dmWith = p.id; R.focusNext = true; render(); } }, avatar(p.name, null, 'sm'),
            h('div', { class: 'grow' }, h('b', null, p.name), h('div', { class: 'tiny muted ellipsis' }, last ? (last.text || 'Attachment') : 'Start a private chat')), unread > 0 ? h('em', { class: 'badge' }, unread) : null));
        });
        wrap.append(list);
      }
    } else {
      const groups = [...R.data.groups.values()];
      if (R.groupOpen && R.data.groups.get(R.groupOpen)) {
        const g = R.data.groups.get(R.groupOpen);
        const list = h('div', { class: 'msgs', 'data-autoscroll': '' });
        (g.messages || []).forEach((m) => list.append(msgEl(m, { mine: m.fromId === R.me.id, name: m.fromName, at: m.at })));
        if (!(g.messages || []).length) list.append(h('div', { class: 'empty sm' }, I('chats', 26), h('p', null, `${(g.members || []).length} members`)));
        wrap.append(h('div', { class: 'row sub-head' }, ibtn('chevronLeft', 'Back', () => { R.groupOpen = null; render(); }), I('hash'), h('b', { class: 'grow' }, g.title),
          R.isMod() ? ibtn('userPlus', 'Add / remove members', (e) => menu(e.currentTarget, R.people().map((p) => { const inG = (g.members || []).some((m) => (m.id || m) === p.id); return { label: (inG ? '✓ ' : '') + p.name, icon: inG ? 'userX' : 'userPlus', run: () => R.send(inG ? 'group-remove-member' : 'group-add-member', { groupId: g.id, targetId: p.id }) }; })), { group: 'people' }) : null),
          list, composer({ placeholder: `Message ${g.title}…`, disabled: !canChat, onSend: (text, attachment) => R.send('group-chat', { groupId: g.id, text, attachment }) }));
      } else {
        const list = h('div', { class: 'list' });
        groups.forEach((g) => list.append(h('button', { class: 'list-item', type: 'button', onclick: () => { R.groupOpen = g.id; R.focusNext = true; render(); } }, h('span', { class: 'ico-tile sm', 'data-group': 'social', html: icon('hash', { size: 16 }) }), h('div', { class: 'grow' }, h('b', null, g.title), h('div', { class: 'tiny muted' }, `${(g.members || []).length} members`)))));
        if (!groups.length) list.append(h('div', { class: 'empty sm' }, I('hash', 26), h('p', null, 'Group chats let a few people talk privately during the session.')));
        wrap.append(list, R.isMod() ? btn('plus', 'New group', async () => {
          const title = await promptDlg('Group name', { placeholder: 'e.g. Panelists' }); if (!title) return;
          const others = R.people().filter((p) => p.id !== R.me.id);
          const picked = new Set();
          const { sheet } = await import('../ui.js');
          const s = sheet({ title: 'Pick members', icon: 'users', group: 'people' });
          s.body.append(h('div', { class: 'list' }, others.map((p) => h('label', { class: 'list-item' }, h('input', { type: 'checkbox', onchange: (e) => e.target.checked ? picked.add(p.id) : picked.delete(p.id) }), avatar(p.name, null, 'sm'), h('span', { class: 'grow' }, p.name)))),
            h('button', { class: 'btn primary block', style: { marginTop: '1rem' }, onclick: () => { const groupId = 'g' + Date.now().toString(36); R.send('group-create', { groupId, title, name: title, members: [...picked] }); s.close(); R.groupOpen = groupId; } }, 'Create group'));
        }, { group: 'social', cls: 'block' }) : null);
      }
    }
    return wrap;
  }

  /* ------------------------------------------------------------ PEOPLE */
  function personMenu(anchor, p) {
    const mod = R.isMod(), host = R.me.role === 'host', self = p.id === R.me.id;
    const onStage = R.isSpeaker(p.id);
    menu(anchor, [
      !self && { label: 'Message privately', icon: 'chat', group: 'social', run: () => { sub.chat = 'dm'; R.dmWith = p.id; R.focusNext = true; open('chat'); } },
      { label: R.pinned === p.id ? 'Unpin' : 'Pin to spotlight', icon: 'spotlight', group: 'media', run: () => R.pin(R.pinned === p.id ? null : p.id) },
      p.userId && { label: 'View profile', icon: 'user', run: () => window.open('/u/' + p.userId, '_blank') },
      mod && !self && '-',
      mod && !self && !p.mutedByHost && { label: 'Mute', icon: 'micOff', group: 'admin', run: () => R.send('mute-participant', { targetId: p.id }) },
      mod && !self && { label: 'Ask to unmute', icon: 'mic', group: 'media', run: () => R.send('ask-unmute', { targetId: p.id }) },
      mod && !self && p.mutedByHost && { label: 'Allow to unmute', icon: 'unlock', group: 'media', run: () => R.send('allow-unmute', { targetId: p.id }) },
      mod && !self && { label: 'Ask to switch mic', icon: 'headphones', group: 'media', run: () => R.send('ask-choose-mic', { targetId: p.id }) },
      mod && !self && { label: 'Ring', icon: 'bellRing', group: 'people', run: () => R.send('ring-participant', { targetId: p.id }) },
      mod && !self && p.sharing && { label: 'Stop their screen share', icon: 'screenOff', group: 'admin', run: () => R.send('force-stop-share', { targetId: p.id }) },
      mod && R.stage.enabled && !onStage && { label: 'Invite to stage', icon: 'stage', group: 'engage', run: () => R.send('stage-approve', { targetId: p.id }) },
      mod && R.stage.enabled && onStage && { label: 'Move to audience', icon: 'users', group: 'engage', run: () => R.send('stage-remove', { targetId: p.id }) },
      p.handRaised && (mod || self) && { label: 'Lower hand', icon: 'hand', group: 'engage', run: () => R.send('lower-hand', { targetId: p.id }) },
      host && !self && p.role !== 'cohost' && { label: 'Make co-host', icon: 'shield', group: 'people', run: () => R.send('set-role', { targetId: p.id, role: 'cohost' }) },
      host && !self && p.role === 'cohost' && { label: 'Remove co-host', icon: 'shield', group: 'people', run: () => R.send('set-role', { targetId: p.id, role: 'participant' }) },
      host && !self && { label: 'Make host', icon: 'crown', group: 'people', run: async () => { if (await confirmDlg(`Make ${p.name} the host? You will become a co-host.`)) R.send('transfer-host', { targetId: p.id }); } },
      mod && !self && { label: 'Permissions…', icon: 'sliders', group: 'admin', run: () => permSheet(p) },
      mod && !self && '-',
      mod && !self && { label: 'Remove from room', icon: 'userX', group: 'admin', run: async () => { if (await confirmDlg(`Remove ${p.name}?`, { ok: 'Remove', danger: true })) R.send('remove-participant', { targetId: p.id, preventRejoin: false }); } },
      mod && !self && { label: 'Remove & block rejoin', icon: 'x', group: 'admin', run: async () => { if (await confirmDlg(`Remove ${p.name} and block them from rejoining?`, { ok: 'Block', danger: true })) R.send('remove-participant', { targetId: p.id, preventRejoin: true }); } },
    ].filter((x) => x));
  }
  async function permSheet(p) {
    const { sheet } = await import('../ui.js');
    const s = sheet({ title: `${p.name} · permissions`, icon: 'sliders', group: 'admin' });
    const perms = { ...(p.permissions || {}) };
    const keys = [['microphone', 'Microphone', 'mic'], ['camera', 'Camera', 'video'], ['screenShare', 'Share screen', 'screen'], ['chat', 'Chat', 'chat'], ['reactions', 'Reactions', 'smile'], ['raiseHand', 'Raise hand', 'hand'], ['invite', 'Invite others', 'userPlus']];
    s.body.append(h('div', { class: 'list' }, keys.map(([k, l, ic]) => h('label', { class: 'set-row' }, h('span', { class: 'ico', html: icon(ic, { size: 18 }) }), h('span', { class: 'grow' }, l), h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: perms[k] !== false, onchange: (e) => { perms[k] = e.target.checked; } }), h('span'))))),
      h('button', { class: 'btn primary block', style: { marginTop: '1rem' }, onclick: () => { R.send('set-participant-permissions', { targetId: p.id, permissions: perms }); s.close(); toast('Permissions updated', { icon: 'check', group: 'admin' }); } }, 'Save'));
  }
  function personRow(p) {
    const [rl, ric] = ROLE[p.role] || ['', ''];
    const self = p.id === R.me.id;
    const st = R.mediaState(p.id);
    return h('div', { class: `person${R.speaking.has(p.id) ? ' speaking' : ''}` }, avatar(p.name, p.avatarUrl, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'row gap-xs' }, h('b', { class: 'ellipsis' }, p.name + (self ? ' (you)' : '')), ric ? h('span', { class: 'role-tag', 'data-role': p.role, html: icon(ric, { size: 12 }) + rl }) : null, R.isSpeaker(p.id) && R.stage.enabled ? h('span', { class: 'role-tag', 'data-role': 'speaker', html: icon('mic', { size: 12 }) + 'Speaker' }) : null),
        h('div', { class: 'tiny muted row gap-xs' }, h('span', { html: icon(p.device === 'mobile' ? 'pin' : p.device === 'tablet' ? 'grid' : 'tv', { size: 12 }) }), p.device || 'desktop', p.isGuest ? ' · guest' : '', p.sharing ? ' · presenting' : '')),
      p.handRaised ? h('span', { class: 'hand-ico', 'data-tip': 'Hand raised', html: '✋' }) : null,
      h('span', { class: `mic-ico${st.mic ? ' on' : ''}`, 'data-tip': st.mic ? 'Mic on' : p.mutedByHost ? 'Muted by host' : 'Muted', html: icon(st.mic ? 'mic' : 'micOff', { size: 16 }) }),
      ibtn('moreV', 'More', (e) => personMenu(e.currentTarget, p)));
  }
  function peopleView() {
    const mod = R.isMod();
    const people = R.people();
    const q = (sub.peopleQ || '').toLowerCase();
    const wrap = h('div', { class: 'people-view' });
    const search = h('input', { class: 'input sm', type: 'search', placeholder: `Search ${people.length} people`, value: sub.peopleQ || '', oninput: debounce((e) => { sub.peopleQ = e.target.value; render(); R.focusNext = true; }, 200), 'data-focus': sub.peopleQ ? '' : null });
    wrap.append(h('div', { class: 'row gap-s' }, h('div', { class: 'grow' }, search),
      ibtn('userPlus', 'Invite people', () => R.invite(), { group: 'people' }),
      mod ? ibtn('shield', 'Security & lock', () => open('tools', 'security'), { group: 'admin' }) : null));
    if (mod) wrap.append(h('div', { class: 'chips mod-row' },
      btn('micOff', 'Mute all', () => R.send('mute-all', {}), { group: 'admin', cls: 'sm' }),
      btn('bellRing', 'Ring all', () => R.send('ring-all', {}), { group: 'people', cls: 'sm' }),
      R.hands.length ? btn('hand', 'Lower all hands', () => R.send('lower-all-hands', {}), { group: 'engage', cls: 'sm' }) : null,
      btn(R.security.locked ? 'unlock' : 'lock', R.security.locked ? 'Unlock' : 'Lock', () => R.send(R.security.locked ? 'unlock-meeting' : 'lock-meeting', {}), { group: 'admin', cls: 'sm' })));

    // stage
    if (R.stage.enabled) {
      const st = R.stage;
      const sec = h('section', { class: 'shade', 'data-group': 'engage' }, h('div', { class: 'sec-h' }, I('stage'), h('b', { class: 'grow' }, 'Stage'), h('span', { class: 'pill static' }, `${st.speakers.length}/${st.seats} seats`)),
        h('div', { class: 'seats' }, Array.from({ length: st.seats }, (_, i) => { const s = st.speakers[i]; return h('div', { class: `seat${s ? ' taken' : ''}`, 'data-tip': s ? s.name : 'Open seat' }, s ? avatar(s.name, null, 'sm') : I('plus', 14)); })));
      if (mod) {
        sec.append(h('div', { class: 'row gap-s', style: { margin: '.5rem 0' } }, h('span', { class: 'tiny muted grow' }, 'Speaker seats'),
          ibtn('chevronLeft', 'Fewer seats', () => R.send('stage-config', { seats: Math.max(1, st.seats - 1) })), h('b', null, st.seats), ibtn('chevronRight', 'More seats', () => R.send('stage-config', { seats: Math.min(50, st.seats + 1) }))));
        if ((st.requests || []).length) sec.append(h('div', { class: 'sec-sub' }, `Requests to speak (${st.requests.length})`), ...st.requests.map((r) => h('div', { class: 'person req' }, avatar(r.name, null, 'sm'), h('div', { class: 'grow' }, h('b', null, r.name), r.note ? h('div', { class: 'tiny muted' }, '“' + r.note + '”') : h('div', { class: 'tiny muted' }, timeAgo(r.at))),
          ibtn('check', st.open ? 'Bring on stage' : 'No open seats', () => R.send('stage-approve', { targetId: r.id }), { group: 'engage' }), ibtn('x', 'Decline', () => R.send('stage-deny', { targetId: r.id }), { group: 'admin' }))));
        st.speakers.forEach((s) => sec.append(h('div', { class: 'person' }, avatar(s.name, null, 'sm'), h('b', { class: 'grow' }, s.name), ibtn('userX', 'Move to audience', () => R.send('stage-remove', { targetId: s.id }), { group: 'admin' }))));
      } else if (!R.isSpeaker(R.me.id)) {
        const mine = (st.requests || []).find((r) => r.id === R.me.id);
        sec.append(mine ? btn('x', 'Cancel request', () => R.send('stage-cancel', {}), { cls: 'block', group: 'engage' }) : btn('hand', st.open ? 'Request to speak' : 'Join the speaker queue', () => R.requestStage(), { cls: 'primary block', group: 'engage' }));
      }
      wrap.append(sec);
    }
    // waiting room
    if (mod && R.waiting.length) {
      wrap.append(h('section', { class: 'shade', 'data-group': 'people' }, h('div', { class: 'sec-h' }, I('door'), h('b', { class: 'grow' }, `Waiting room (${R.waiting.length})`), btn('check', 'Admit all', () => R.send('admit-all', {}), { cls: 'xs', group: 'people' }), btn('x', 'Decline all', () => R.send('decline-all', {}), { cls: 'xs ghost', group: 'admin' })),
        ...R.waiting.map((w) => h('div', { class: 'person' }, avatar(w.name, null, 'sm'), h('b', { class: 'grow' }, w.name), ibtn('check', 'Admit', () => R.send('admit-participant', { targetId: w.id }), { group: 'people' }), ibtn('x', 'Decline', () => R.send('decline-participant', { targetId: w.id }), { group: 'admin' })))));
    }
    if (R.hands.length) {
      wrap.append(h('section', { class: 'shade', 'data-group': 'engage' }, h('div', { class: 'sec-h' }, h('span', null, '✋'), h('b', { class: 'grow' }, `Raised hands (${R.hands.length})`)),
        ...R.hands.map((hd, i) => { const p = R.p(hd.participantId || hd.id) || hd; return h('div', { class: 'person' }, h('span', { class: 'qnum' }, i + 1), avatar(p.name, null, 'sm'), h('b', { class: 'grow' }, p.name), (mod || p.id === R.me.id) ? ibtn('hand', 'Lower hand', () => R.send('lower-hand', { targetId: p.id }), { group: 'engage' }) : null); })));
    }
    const groups = [['Hosts', people.filter((p) => p.role === 'host' || p.role === 'cohost')], [R.stage.enabled ? 'On stage' : '', R.stage.enabled ? people.filter((p) => p.role !== 'host' && p.role !== 'cohost' && R.isSpeaker(p.id)) : []], [R.stage.enabled ? 'Audience' : 'In the room', people.filter((p) => p.role !== 'host' && p.role !== 'cohost' && !(R.stage.enabled && R.isSpeaker(p.id)))]];
    for (const [title, list] of groups) {
      const f = list.filter((p) => !q || p.name.toLowerCase().includes(q));
      if (!f.length || !title) continue;
      wrap.append(h('section', { class: 'plain' }, h('div', { class: 'sec-sub' }, `${title} · ${f.length}`), ...f.slice(0, 300).map(personRow)));
    }
    return wrap;
  }

  /* ------------------------------------------------------------ ENGAGE */
  function engageView() {
    const mode = sub.engage || 'polls';
    R.unread.engage = 0;
    const openPolls = R.data.polls.filter((p) => p.status !== 'closed').length;
    const openQs = R.data.questions.filter((q) => q.status === 'open' || q.status === 'live').length;
    const wrap = h('div', { class: 'engage-view' }, seg([['polls', 'Polls', openPolls], ['qa', 'Q&A', openQs], ['comments', 'Comments', R.data.comments.length]], mode, (v) => { sub.engage = v; render(); }));
    if (mode === 'polls') wrap.append(pollsView());
    else if (mode === 'qa') wrap.append(qaView());
    else wrap.append(commentsView());
    return wrap;
  }
  function pollsView() {
    const box = h('div', { class: 'stack' });
    if (R.isMod()) box.append(btn('plus', 'New poll', () => newPoll(), { group: 'engage', cls: 'primary block' }));
    if (!R.data.polls.length) box.append(h('div', { class: 'empty sm' }, I('poll', 28), h('p', null, R.isMod() ? 'Ask the room something — results update live.' : 'No polls yet. They’ll pop up here when the host starts one.')));
    [...R.data.polls].reverse().forEach((p) => {
      const total = Math.max(1, p.tally.reduce((a, b) => a + b, 0));
      const voted = (p.mine || []).length > 0, closed = p.status === 'closed';
      const show = voted || closed || R.isMod();
      let picks = new Set();
      const opts = h('div', { class: 'poll-opts' }, p.options.map((o, i) => {
        const pct = Math.round((p.tally[i] / total) * 100);
        const b = h('button', { class: `poll-opt${(p.mine || []).includes(i) ? ' mine' : ''}`, type: 'button', disabled: closed || (voted && !p.multi), style: { '--pct': show ? pct + '%' : '0%' },
          onclick: () => { if (p.multi) { picks.has(i) ? picks.delete(i) : picks.add(i); b.classList.toggle('picked'); } else R.send('poll-vote', { pollId: p.id, choices: [i] }); } },
        h('span', { class: 'grow' }, o), show ? h('b', null, pct + '%') : null);
        return b;
      }));
      box.append(h('div', { class: 'poll card', 'data-group': 'engage' }, h('div', { class: 'row' }, I('poll'), h('b', { class: 'grow' }, p.question), closed ? h('span', { class: 'pill static' }, 'Closed') : h('span', { class: 'pill live' }, 'Live')),
        h('div', { class: 'tiny muted' }, `${p.voters} vote${p.voters === 1 ? '' : 's'}${p.multi ? ' · pick any' : ''}${p.anonymous ? ' · anonymous' : ''}`), opts,
        p.multi && !voted && !closed ? btn('check', 'Submit vote', () => picks.size && R.send('poll-vote', { pollId: p.id, choices: [...picks] }), { cls: 'sm', group: 'engage' }) : null,
        R.isMod() && !closed ? btn('lock', 'Close poll', () => R.send('poll-close', { pollId: p.id }), { cls: 'sm ghost' }) : null));
    });
    return box;
  }
  async function newPoll() {
    const { sheet } = await import('../ui.js');
    const s = sheet({ title: 'New poll', icon: 'poll', group: 'engage' });
    const q = h('input', { class: 'input', placeholder: 'Your question' });
    const opts = h('div', { class: 'stack' });
    const addOpt = (v = '') => opts.append(h('input', { class: 'input sm', placeholder: `Option ${opts.children.length + 1}`, value: v }));
    addOpt(); addOpt();
    const multi = h('input', { type: 'checkbox' }), anon = h('input', { type: 'checkbox', checked: true });
    const ai = btn('sparkles', 'Suggest with AI', async () => {
      try { ai.disabled = true; const r = await api('/api/ai/ask', { method: 'POST', headers: R.headers(), body: { question: `Suggest one short poll question with 4 short options for this session. Reply as "Question | A | B | C | D" only.` } });
        const parts = String(r.text || '').split('|').map((x) => x.trim()).filter(Boolean);
        if (parts.length > 2) { q.value = parts[0]; opts.innerHTML = ''; parts.slice(1, 7).forEach(addOpt); } } catch (e) { toastErr(e); } finally { ai.disabled = false; }
    }, { group: 'ai', cls: 'sm ghost' });
    s.body.append(h('div', { class: 'stack' }, q, opts, h('div', { class: 'row' }, btn('plus', 'Add option', () => opts.children.length < 8 && addOpt(), { cls: 'sm ghost' }), ai),
      h('label', { class: 'set-row' }, h('span', { class: 'grow' }, 'Allow multiple choices'), h('span', { class: 'switch' }, multi, h('span'))),
      h('label', { class: 'set-row' }, h('span', { class: 'grow' }, 'Anonymous votes'), h('span', { class: 'switch' }, anon, h('span'))),
      h('button', { class: 'btn primary block', onclick: () => { const options = [...opts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean); if (!q.value.trim() || options.length < 2) return toast('Add a question and two options', { icon: 'alert' }); R.send('poll-create', { question: q.value.trim(), options, multi: multi.checked, anonymous: anon.checked }); s.close(); } }, 'Launch poll')));
    q.focus();
  }
  function qaView() {
    const box = h('div', { class: 'stack' });
    const ta = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Ask the speakers a question…', maxlength: 400 });
    const anon = h('input', { type: 'checkbox' });
    box.append(h('div', { class: 'compose-card' }, ta, h('div', { class: 'row' }, h('label', { class: 'row gap-xs tiny grow' }, anon, 'Ask anonymously'), btn('send', 'Ask', () => { if (ta.value.trim()) { R.send('qa-ask', { body: ta.value.trim(), anonymous: anon.checked }); ta.value = ''; } }, { cls: 'sm primary', group: 'engage' }))));
    const order = { live: 0, open: 1, answered: 2, dismissed: 3 };
    const qs = [...R.data.questions].filter((q) => q.status !== 'dismissed' || R.isMod()).sort((a, b) => (order[a.status] - order[b.status]) || (b.upvotes - a.upvotes));
    if (!qs.length) box.append(h('div', { class: 'empty sm' }, I('question', 28), h('p', null, 'No questions yet — be the first.')));
    qs.forEach((q) => box.append(h('div', { class: `qa card s-${q.status}`, 'data-group': 'engage' },
      h('button', { class: `upvote${q.voted ? ' on' : ''}`, type: 'button', 'data-tip': 'Upvote', onclick: () => R.send('qa-upvote', { id: q.id }), html: icon('arrowUp', { size: 16 }) + `<b>${q.upvotes}</b>` }),
      h('div', { class: 'grow' }, h('div', { class: 'row gap-xs tiny muted' }, h('b', null, q.authorName), '·', timeAgo(q.createdAt), q.status === 'live' ? h('span', { class: 'pill live' }, 'Answering now') : q.status === 'answered' ? h('span', { class: 'pill static' }, 'Answered') : null),
        h('p', null, q.body), q.aiAnswer ? h('div', { class: 'ai-box sm' }, h('div', { class: 'tiny row gap-xs', html: icon('sparkles', { size: 14 }) + 'AI answer' }), h('div', { class: 'prose', html: md(q.aiAnswer) })) : null,
        R.isMod() ? h('div', { class: 'row gap-xs wrap' }, q.status !== 'live' ? btn('radio', 'Live', () => R.send('qa-status', { id: q.id, status: 'live' }), { cls: 'xs', group: 'engage' }) : null, q.status !== 'answered' ? btn('check', 'Answered', () => R.send('qa-status', { id: q.id, status: 'answered' }), { cls: 'xs', group: 'people' }) : null,
          btn('sparkles', 'AI answer', () => { R.send('qa-ai-answer', { id: q.id }); toast('Asking AI…', { icon: 'sparkles', group: 'ai' }); }, { cls: 'xs', group: 'ai' }), q.status !== 'dismissed' ? btn('x', 'Dismiss', () => R.send('qa-status', { id: q.id, status: 'dismissed' }), { cls: 'xs ghost' }) : null) : null))));
    return box;
  }
  function commentsView() {
    const box = h('div', { class: 'stack' });
    const ta = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Share a thought with the community…', maxlength: 1000 });
    box.append(h('div', { class: 'compose-card' }, ta, h('div', { class: 'row' }, h('span', { class: 'tiny muted grow' }, 'Comments stay on the event page after the session'), btn('send', 'Post', () => { if (ta.value.trim()) { R.send('comment-add', { body: ta.value.trim() }); ta.value = ''; } }, { cls: 'sm primary', group: 'social' }))));
    const top = R.data.comments.filter((c) => !c.parentId);
    if (!top.length) box.append(h('div', { class: 'empty sm' }, I('heart', 28), h('p', null, 'The conversation starts with you.')));
    top.slice().reverse().forEach((c) => box.append(commentEl(c)));
    return box;
  }
  function commentEl(c) {
    const replies = R.data.comments.filter((x) => x.parentId === c.id);
    const replyBox = h('div', { class: 'reply-box', hidden: !R.replyOpen.has(c.id) });
    if (R.replyOpen.has(c.id)) {
      const inp = h('input', { class: 'input sm', placeholder: `Reply to ${c.authorName}…`, onkeydown: (e) => { if (e.key === 'Enter' && inp.value.trim()) { R.send('comment-add', { body: inp.value.trim(), parentId: c.id }); inp.value = ''; } } });
      replyBox.append(...replies.map((r) => commentEl(r)), inp);
    }
    return h('div', { class: `comment${c.parentId ? ' reply' : ''}` }, avatar(c.authorName, c.avatarUrl, 'sm'),
      h('div', { class: 'grow' }, h('div', { class: 'row gap-xs tiny' }, h('b', null, c.authorName), h('span', { class: 'muted' }, timeAgo(c.createdAt))), h('p', { html: linkify(c.body) }),
        h('div', { class: 'row gap-s acts' },
          h('button', { class: `act${c.liked ? ' liked' : ''}`, type: 'button', onclick: () => R.send('comment-like', { id: c.id }), html: icon('heart', { size: 15 }) + `<span>${c.likeCount || 0}</span>` }),
          !c.parentId ? h('button', { class: 'act', type: 'button', onclick: () => { if (R.replyOpen.has(c.id)) R.replyOpen.delete(c.id); else { R.replyOpen.add(c.id); R.send('comment-replies', { id: c.id }); } render(); }, html: icon('reply', { size: 15 }) + `<span>${Math.max(c.replyCount || 0, replies.length) || ''} Reply</span>` }) : null,
          R.isMod() ? h('button', { class: 'act', type: 'button', 'data-tip': 'Hide comment', onclick: () => R.send('comment-hide', { id: c.id }), html: icon('eyeOff', { size: 15 }) }) : null),
        replyBox));
  }

  /* ------------------------------------------------------------ TOOLS */
  const TOOLS = [
    ['scripture', 'Scripture', 'bookOpen', 'faith', 'Show verses — everyone reads in their own translation'],
    ['captions', 'Captions & transcript', 'captions', 'ai', 'Live “Name: text” captions, saved for summaries'],
    ['sounds', 'Sounds', 'music', 'engage', 'Applause, drum roll, suspense — for everyone'],
    ['ai', 'AI assistant', 'sparkles', 'ai', 'Catch up, ask, summarise, translate'],
    ['boards', 'Whiteboards', 'pen', 'content', 'Your personal board — share it to view'],
    ['present', 'Present content', 'presentation', 'content', 'YouTube, slides or an image for everyone'],
    ['timeline', 'Screen timeline', 'timeline', 'content', 'Snapshot slides into a shared strip'],
    ['record', 'Record', 'record', 'media', 'Saved to your device, never our servers'],
    ['breakouts', 'Breakout rooms', 'split', 'people', 'Split into small groups'],
    ['security', 'Security', 'shield', 'admin', 'Waiting room, lock, guest access'],
    ['activity', 'Activity', 'activity', 'nav', 'Who did what, live'],
    ['diagnostics', 'Diagnostics', 'signal', 'settings', 'Connection & media health'],
    ['shortcuts', 'Shortcuts', 'keyboard', 'settings', 'Keyboard keys for quick control'],
  ];
  function toolsView() {
    const t = sub.tools;
    if (t && R.tools[t]) {
      const v = R.tools[t]();
      const meta = TOOLS.find((x) => x[0] === t) || [t, t, 'wand', ''];
      return h('div', { class: 'tool-view', 'data-group': meta[3] }, h('div', { class: 'row sub-head' }, ibtn('chevronLeft', 'All tools', () => { sub.tools = null; render(); }), h('span', { class: 'ico-tile sm', 'data-group': meta[3], html: icon(meta[2], { size: 16 }) }), h('b', { class: 'grow' }, meta[1])), v);
    }
    return h('div', { class: 'tool-grid stagger' }, TOOLS.filter(([id]) => !(['security', 'breakouts'].includes(id) && !R.isMod())).map(([id, label, ic, g, desc]) =>
      h('button', { class: 'tool-card', 'data-group': g, type: 'button', onclick: () => { sub.tools = id; render(); } }, h('span', { class: 'ico-tile', 'data-group': g, html: icon(ic, { size: 20 }) }), h('b', null, label), h('small', null, desc), R.toolBadge(id) ? h('em', { class: 'dot-live' }) : null)));
  }

  return { el, open, close, toggle, isOpen, refresh, render, get tab() { return tab; }, sub };
}

export async function compressImage(file, max = 1280, q = 0.8) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let dataUrl = c.toDataURL('image/webp', q);
  if (dataUrl.length > 880000) dataUrl = c.toDataURL('image/webp', 0.55);
  if (dataUrl.length > 880000) throw new Error('Image is too large');
  return { dataUrl, size: Math.round(dataUrl.length * 0.75) };
}
