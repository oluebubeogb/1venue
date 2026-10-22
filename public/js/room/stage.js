// Stage rendering: tiles (grid / spotlight / speaker), presentation area (screen, content, scripture,
// boards, timeline), captions overlay and floating reactions.
import { h, esc, api, avatar, toast, download } from '../ui.js';
import { icon } from '../icons.js';
import { translationSelect, versesEl } from '../pages/bible.js';
import { createBoard, boardToolbar } from '../pages/whiteboard.js';

const I = (n, s = 16) => h('span', { class: 'i', html: icon(n, { size: s }) });

export function createStage(R) {
  const el = h('section', { class: 'stage', 'aria-label': 'Stage' });
  const present = h('div', { class: 'present', hidden: true });
  const tilesEl = h('div', { class: 'tiles' });
  const caps = h('div', { class: 'cap-overlay', 'aria-live': 'polite' });
  const fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  el.append(present, tilesEl, caps, fx);
  const tiles = new Map(); // id -> {el, video, screenEl}
  let presentKey = null, presentCleanup = null;

  // gestures: swipe to cycle layouts, double-tap to pin
  let sx = null, sy = null;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; sx = e.clientX; sy = e.clientY; });
  el.addEventListener('pointerup', (e) => {
    if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && !e.target.closest('.present .board-wrap, iframe, input, .wb')) R.cycleLayout(dx < 0 ? 1 : -1);
  });

  function tileFor(id, kind = 'camera') {
    const key = kind === 'screen' ? id + ':screen' : id;
    let t = tiles.get(key);
    if (t) return t;
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    const tile = h('div', { class: `tile${kind === 'screen' ? ' screen' : ''}`, 'data-id': id, ondblclick: () => R.pin(R.pinned === id ? null : id) },
      h('div', { class: 'tile-av' }), video,
      h('div', { class: 'tile-meta' }, h('span', { class: 'tile-mic' }), h('b', { class: 'tile-name ellipsis' }), h('span', { class: 'tile-q' })),
      h('div', { class: 'tile-badges' }),
      kind === 'screen' ? null : h('button', { class: 'tile-pin icon-btn sm glass', type: 'button', 'data-tip': 'Pin', 'data-group': 'media', onclick: (e) => { e.stopPropagation(); R.pin(R.pinned === id ? null : id); }, html: icon('pin', { size: 14 }) }));
    t = { el: tile, video, kind, id, track: null };
    tiles.set(key, t);
    return t;
  }
  function paintTile(t) {
    const p = R.p(t.id) || (t.id === R.me.id ? R.me : { name: 'Guest' });
    const st = R.mediaState(t.id);
    const self = t.id === R.me.id;
    t.el.querySelector('.tile-name').textContent = (t.kind === 'screen' ? `${p.name}’s screen` : p.name + (self ? ' (you)' : ''));
    const av = t.el.querySelector('.tile-av');
    if (av.dataset.n !== p.name) { av.dataset.n = p.name; av.replaceChildren(avatar(p.name, p.avatarUrl, 'xl')); }
    t.el.querySelector('.tile-mic').innerHTML = t.kind === 'screen' ? icon('screen', { size: 14 }) : icon(st.mic ? 'mic' : 'micOff', { size: 14 });
    t.el.querySelector('.tile-mic').classList.toggle('off', !st.mic);
    const q = R.quality[t.id]; t.el.querySelector('.tile-q').innerHTML = q && q !== 'excellent' && q !== 'unknown' ? icon('signal', { size: 13 }) : ''; t.el.querySelector('.tile-q').dataset.q = q || '';
    t.el.classList.toggle('has-video', !!t.track);
    t.el.classList.toggle('speaking', R.speaking.has(t.id) && t.kind !== 'screen');
    t.el.classList.toggle('pinned', R.pinned === t.id);
    t.el.classList.toggle('self', self && t.kind !== 'screen');
    const hand = R.hands.findIndex((x) => (x.participantId || x.id) === t.id);
    const b = t.el.querySelector('.tile-badges'); b.innerHTML = '';
    if (hand >= 0) b.append(h('span', { class: 'tb hand' }, '✋ ' + (hand + 1)));
    if (p.role === 'host') b.append(h('span', { class: 'tb', 'data-role': 'host', html: icon('crown', { size: 12 }) }));
    if (R.stage.enabled && R.isSpeaker(t.id) && p.role !== 'host') b.append(h('span', { class: 'tb', 'data-role': 'speaker', html: icon('mic', { size: 12 }) }));
  }
  function setTrack(id, track, source) {
    const kind = source === 'screen_share' || source === 'screenShare' ? 'screen' : 'camera';
    const t = tileFor(id, kind);
    if (t.track === track) return;
    t.track = track;
    if (track && track.attach) track.attach(t.video); else t.video.srcObject = null;
    t.video.muted = true;
    t.el.classList.toggle('mirror', id === R.me.id && kind === 'camera' && R.mirror);
    render();
  }
  function clearTrack(id, source) {
    const kind = source === 'screen_share' || source === 'screenShare' ? 'screen' : 'camera';
    const t = tiles.get(kind === 'screen' ? id + ':screen' : id); if (!t) return;
    try { t.track && t.track.detach && t.track.detach(t.video); } catch { /* */ }
    t.track = null; t.video.srcObject = null;
    if (kind === 'screen') { t.el.remove(); tiles.delete(id + ':screen'); }
    render();
  }

  function visiblePeople() {
    let people = R.people();
    if (R.stage.enabled) people = people.filter((p) => R.isSpeaker(p.id) || p.id === R.me.id && (R.isSpeaker(p.id)));
    return people;
  }
  function screens() { return [...tiles.values()].filter((t) => t.kind === 'screen' && t.track); }

  // ---------- presentation area ----------
  function presentation() {
    if (R.stageView === 'team-board') return ['team-board'];
    if (R.stageView && R.stageView.startsWith('pboard:')) return [R.stageView];
    if (R.stageView === 'my-board') return ['my-board'];
    const sc = screens(); if (sc.length) return ['screen:' + sc[0].id];
    if (R.content) return ['content:' + R.content.type + ':' + R.content.url];
    if (R.timeline.slideshow || R.timelineView) return R.timeline.items.length ? ['timeline'] : null;
    if (R.scripture) return ['scripture:' + R.scripture.reference + ':' + R.scripture.at];
    return null;
  }
  const closeBtn = (label, run) => h('button', { class: 'btn sm glass present-close', type: 'button', onclick: run, html: icon('x', { size: 14 }) + `<span>${esc(label)}</span>` });

  function buildPresent(key) {
    presentCleanup && presentCleanup(); presentCleanup = null;
    present.replaceChildren(); present.dataset.kind = key.split(':')[0];
    if (key.startsWith('screen:')) {
      const t = tiles.get(key.slice(7) + ':screen');
      if (t) { present.append(t.el); t.el.classList.add('big'); }
      present.append(h('div', { class: 'present-tools' }, R.isMod() || R.media.sharing ? h('button', { class: 'btn sm glass', 'data-group': 'content', 'data-tip': 'Save this slide to the timeline', onclick: () => R.snapshotToTimeline(), html: icon('camera', { size: 14 }) + '<span>Snapshot</span>' }) : null,
        h('button', { class: 'btn sm glass', 'data-group': 'media', 'data-tip': 'Fullscreen', onclick: () => (present.requestFullscreen ? present.requestFullscreen() : null), html: icon('maximize', { size: 14 }) })));
      return;
    }
    if (key.startsWith('content:')) return buildContent();
    if (key === 'timeline') return buildTimeline();
    if (key.startsWith('scripture:')) return buildScripture();
    if (key === 'team-board') return buildTeamBoard();
    if (key === 'my-board') return buildMyBoard();
    if (key.startsWith('pboard:')) return buildViewBoard(key.slice(7));
  }
  function buildContent() {
    const c = R.content; const holder = c.remoteHolderId === R.me.id;
    const head = h('div', { class: 'present-head' }, I('presentation'), h('b', { class: 'grow ellipsis' }, c.title || c.url), h('span', { class: 'tiny muted' }, (R.p(c.ownerId) || {}).name || ''),
      h('a', { class: 'icon-btn sm', href: c.url, target: '_blank', rel: 'noopener', 'data-tip': 'Open in new tab', html: icon('link', { size: 14 }) }),
      (c.ownerId === R.me.id || R.isMod()) ? closeBtn('Stop', () => R.send('content-stop', {})) : null);
    let body;
    if (c.type === 'video') {
      const v = body = h('video', { src: c.url, controls: holder, playsinline: true, class: 'present-video', preload: 'metadata' });
      const push = () => holder && R.send('content-update', { media: { paused: v.paused, t: v.currentTime, at: Date.now() } });
      ['play', 'pause', 'seeked'].forEach((ev) => v.addEventListener(ev, push));
      R.applyMediaSync = (m) => { if (!m || holder) return; const target = m.t + (m.paused ? 0 : (Date.now() - m.at) / 1000); if (Math.abs(v.currentTime - target) > 1.2) v.currentTime = target; if (m.paused) v.pause(); else v.play().catch(() => { toast('Tap the video to play along', { icon: 'play' }); }); };
      v.addEventListener('loadedmetadata', () => R.applyMediaSync(c.media));
      if (!holder) v.addEventListener('click', () => v.play().catch(() => {}));
    } else if (c.type === 'image') body = h('img', { src: c.url, alt: c.title || '', class: 'present-img' });
    else if (c.type === 'pdf') body = h('iframe', { src: c.url + '#page=' + (c.page || 1) + '&view=FitH', title: c.title || 'Document', class: 'present-frame' });
    else body = h('iframe', { src: c.url, title: c.title || 'Shared page', class: 'present-frame', allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation' });
    present.append(head, h('div', { class: 'present-body' }, body));
    if (c.type === 'pdf' && holder) {
      present.append(h('div', { class: 'present-tools' }, h('span', { class: 'tiny muted' }, 'Page'), h('button', { class: 'icon-btn sm glass', onclick: () => { c.page = Math.max(1, (c.page || 1) - 1); R.send('content-update', { page: c.page }); body.src = c.url + '#page=' + c.page; }, html: icon('chevronLeft', { size: 14 }) }),
        h('button', { class: 'icon-btn sm glass', onclick: () => { c.page = (c.page || 1) + 1; R.send('content-update', { page: c.page }); body.src = c.url + '#page=' + c.page; }, html: icon('chevronRight', { size: 14 }) })));
    }
    R.applyPage = (pg) => { if (c.type === 'pdf' && !holder && body.tagName === 'IFRAME') body.src = c.url + '#page=' + pg + '&view=FitH'; };
  }
  function buildTimeline() {
    const tl = R.timeline; const i = Math.min(tl.selected || 0, tl.items.length - 1); const it = tl.items[i];
    const go = (d) => { const n = (i + d + tl.items.length) % tl.items.length; tl.selected = n; if (R.isMod() && tl.slideshow) R.send('screen-timeline-select', { index: n }); render(true); };
    present.append(h('div', { class: 'present-head' }, I('timeline'), h('b', { class: 'grow' }, `Slide ${i + 1} of ${tl.items.length}`), tl.slideshow ? h('span', { class: 'pill live' }, 'Slideshow') : null,
      !tl.slideshow ? closeBtn('Close', () => { R.timelineView = false; render(true); }) : R.isMod() ? closeBtn('End slideshow', () => R.send('screen-timeline-slideshow', { on: false })) : null),
    h('div', { class: 'present-body' }, h('img', { src: it.dataUrl, alt: it.title || 'Slide', class: 'present-img' })),
    (!tl.slideshow || R.isMod()) ? h('div', { class: 'present-tools' }, h('button', { class: 'icon-btn glass', onclick: () => go(-1), html: icon('chevronLeft') }), h('button', { class: 'icon-btn glass', onclick: () => go(1), html: icon('chevronRight') })) : null);
  }
  function buildScripture() {
    const s = R.scripture;
    const body = h('div', { class: 'scripture-card' }, h('div', { class: 'skel', style: { height: '120px' } }));
    const tsel = translationSelect(R.bibleTr(), (v) => { R.setBibleTr(v); load(); }, { compact: true });
    present.append(h('div', { class: 'present-head', 'data-group': 'faith' }, I('bookOpen'), h('b', { class: 'grow' }, s.reference), h('span', { class: 'tiny muted' }, 'by ' + s.by), tsel,
      (R.isMod() || R.isSpeaker(R.me.id)) ? closeBtn('Clear', () => R.send('scripture-clear', {})) : null), h('div', { class: 'present-body scroll' }, body));
    async function load() {
      try { const p = await api(`/api/bible/passage?ref=${encodeURIComponent(s.reference)}&t=${R.bibleTr()}`);
        body.replaceChildren(h('div', { class: 'scripture-ref' }, p.reference, h('small', null, p.translation?.name || p.translation?.short || '')), versesEl(p, { selectable: false }));
      } catch (e) { body.replaceChildren(h('p', { class: 'muted' }, 'Couldn’t load this passage in that translation. ' + (e.message || ''))); }
    }
    load();
  }
  function buildTeamBoard() {
    const toStroke = (s) => ({ id: s.id, tool: s.erase ? 'eraser' : 'pen', color: s.color, width: s.width, points: s.points });
    const b = createBoard({ strokes: (R.teamStrokes || []).map(toStroke), onChange: (strokes, ns, bulk) => { R.teamStrokes = strokes.map((x) => ({ ...x, erase: x.tool === 'eraser' })); if (ns && !bulk) R.send('wb-stroke', { id: ns.id || 's' + Date.now(), points: ns.points, color: ns.color, width: ns.width, erase: ns.tool === 'eraser' }); } });
    R.teamBoard = b;
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('users'), h('b', { class: 'grow' }, 'Team board'), h('span', { class: 'tiny muted' }, 'Everyone can draw'),
      R.isMod() ? h('button', { class: 'btn sm ghost', onclick: () => R.send('wb-clear', {}), html: icon('trash', { size: 14 }) + '<span>Clear</span>' }) : null, closeBtn('Close', () => { R.stageView = null; render(true); })),
    h('div', { class: 'present-body board-wrap' }, b.el), boardToolbar(b));
    presentCleanup = () => { b.destroy && b.destroy(); R.teamBoard = null; };
  }
  function buildMyBoard() {
    let last = 0, pending = null;
    const flush = (strokes) => { last = Date.now(); pending = null; if (R.boardSharing) R.send('pboard-frame', { strokes: strokes.slice(-800) }); };
    const b = createBoard({ strokes: R.myStrokes || [], onChange: (strokes) => { R.myStrokes = strokes; R.saveMyBoard(); if (!R.boardSharing) return; clearTimeout(pending); const wait = 400 - (Date.now() - last); if (wait <= 0) flush(strokes); else pending = setTimeout(() => flush(R.myStrokes), wait); } });
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('pen'), h('b', { class: 'grow' }, 'My board'), h('span', { class: 'tiny muted' }, R.boardSharing ? '● Others can watch' : 'Private'),
      h('button', { class: `btn sm ${R.boardSharing ? 'ghost' : 'primary'}`, 'data-group': 'content', onclick: () => { R.shareBoard(!R.boardSharing); render(true); }, html: icon(R.boardSharing ? 'eyeOff' : 'eye', { size: 14 }) + `<span>${R.boardSharing ? 'Stop sharing' : 'Share to view'}</span>` }),
      closeBtn('Close', () => { R.stageView = null; render(true); })),
    h('div', { class: 'present-body board-wrap' }, b.el), boardToolbar(b, [h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Save PNG', 'aria-label': 'Save PNG', html: icon('download'), onclick: () => b.png().then((x) => download('my-board.png', x)) })]));
    presentCleanup = () => { clearTimeout(pending); b.destroy && b.destroy(); };
  }
  function buildViewBoard(ownerId) {
    const info = R.boards.find((x) => x.ownerId === ownerId);
    const b = createBoard({ strokes: R.viewStrokes[ownerId] || [], readOnly: true });
    R.viewingBoard = b; R.viewingOwner = ownerId;
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('eye'), h('b', { class: 'grow' }, `${info ? info.name : 'Someone'}’s board`), h('span', { class: 'pill live' }, 'Live'), closeBtn('Close', () => { R.stageView = null; render(true); })),
      h('div', { class: 'present-body board-wrap' }, b.el));
    presentCleanup = () => { R.viewingBoard = null; R.viewingOwner = null; b.destroy && b.destroy(); };
  }

  // ---------- layout ----------
  function render(force) {
    const pk = presentation(); const key = pk && pk[0];
    if (key !== presentKey || force) {
      // put a screen tile back if it was in the presentation area
      present.querySelectorAll('.tile').forEach((t) => t.classList.remove('big'));
      if (key) buildPresent(key); else { presentCleanup && presentCleanup(); presentCleanup = null; present.replaceChildren(); }
      presentKey = key;
    }
    present.hidden = !key;
    el.classList.toggle('presenting', !!key);
    const people = visiblePeople();
    const ids = people.map((p) => p.id);
    if (!ids.includes(R.me.id) && (!R.stage.enabled || R.isSpeaker(R.me.id))) ids.unshift(R.me.id);
    const list = ids.map((id) => tileFor(id));
    const presentScreenId = key && key.startsWith('screen:') ? key.slice(7) : null;
    const extraScreens = screens().filter((t) => t.id !== presentScreenId);
    let layout = R.layout;
    let main = null;
    if (!key) {
      if (layout === 'spotlight' || layout === 'speaker') {
        const focusId = R.pinned || [...R.speaking].find((x) => x !== R.me.id && ids.includes(x)) || R.lastSpeaker || ids.find((x) => x !== R.me.id) || R.me.id;
        if (focusId && ids.includes(focusId)) { R.lastSpeaker = focusId; main = tileFor(focusId); }
      }
    }
    el.dataset.layout = key ? 'present' : layout;
    const arr = [...extraScreens, ...list];
    const film = main ? arr.filter((t) => t !== main) : arr;
    tilesEl.replaceChildren();
    if (main) { tilesEl.append(h('div', { class: 'tile-main' }, main.el)); }
    const strip = (key || main) ? h('div', { class: 'filmstrip' }) : tilesEl;
    const maxTiles = key || main ? 12 : (R.isMobile ? 8 : 25);
    film.slice(0, maxTiles).forEach((t) => strip.append(t.el));
    if (film.length > maxTiles) strip.append(h('button', { class: 'tile more', onclick: () => R.panel.open('people') }, h('b', null, `+${film.length - maxTiles}`), h('small', null, 'more')));
    if (strip !== tilesEl) { if (layout === 'speaker' && main && !key) strip.classList.add('hidden-strip'); tilesEl.append(strip); }
    const n = Math.min(film.length, maxTiles) + (film.length > maxTiles ? 1 : 0);
    tilesEl.style.setProperty('--n', n);
    tilesEl.dataset.count = n > 9 ? 'many' : n;
    if (R.stage.enabled && !ids.length) tilesEl.append(h('div', { class: 'empty sm stage-empty' }, I('stage', 28), h('p', null, 'The stage is open — speakers will appear here.')));
    for (const t of tiles.values()) paintTile(t);
    // audience strip for stage events
    if (R.stage.enabled) {
      const aud = R.people().filter((p) => !R.isSpeaker(p.id));
      if (aud.length) tilesEl.append(h('div', { class: 'audience', onclick: () => R.panel.open('people') }, ...aud.slice(0, 7).map((p) => avatar(p.name, p.avatarUrl, 'xs')), h('span', { class: 'tiny' }, `${aud.length} in the audience`)));
    }
    // drop tiles of people that left
    for (const [k, t] of tiles) if (t.kind === 'camera' && t.id !== R.me.id && !R.p(t.id)) { t.el.remove(); tiles.delete(k); }
  }

  // ---------- captions overlay ----------
  const interim = new Map();
  function caption(c) {
    if (!c.final) interim.set(c.participantId, c); else interim.delete(c.participantId);
    paintCaps();
  }
  function paintCaps() {
    caps.hidden = !R.showCaptions;
    if (!R.showCaptions) return;
    const finals = R.data.captions.slice(-3).filter((l) => Date.now() - l.at < 15000);
    const lines = [...finals, ...interim.values()].slice(-3);
    caps.replaceChildren(...lines.map((l) => h('div', { class: `cap-line${l.final === false ? ' interim' : ''}` }, h('b', null, l.name + ': '), l.text)));
  }
  setInterval(paintCaps, 4000);

  // ---------- reactions ----------
  function burst(emoji, name) {
    const n = h('div', { class: 'fx', style: { left: (8 + Math.random() * 70) + '%', '--dx': (Math.random() * 80 - 40) + 'px' } }, h('span', { class: 'e' }, emoji), name ? h('small', null, name) : null);
    fx.append(n); setTimeout(() => n.remove(), 3200);
  }

  return { el, render, setTrack, clearTrack, caption, paintCaps, burst, paintAll: () => { for (const t of tiles.values()) paintTile(t); }, tiles, screens, presentEl: present, get presentKey() { return presentKey; } };
}
