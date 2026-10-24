// Stage rendering: tiles (grid / spotlight / speaker), presentation area (screen, content, scripture,
// boards, timeline), captions overlay and floating reactions.
import { h, esc, api, avatar, toast, download, confirmDlg, uploadFile } from '../ui.js';
import { state } from '../app.js';
import { icon } from '../icons.js';
import { translationSelect, versesEl, refLabel } from '../pages/bible.js';
import { sharePassageToFeed } from '../passage.js';
import { createBoard, boardToolbar, boardKeys } from '../pages/whiteboard.js';
import { mountYouTube } from './youtube.js';

const I = (n, s = 16) => h('span', { class: 'i', html: icon(n, { size: s }) });

export function createStage(R) {
  const el = h('section', { class: 'stage', 'aria-label': 'Stage' });
  const present = h('div', { class: 'present', hidden: true });
  const tilesEl = h('div', { class: 'tiles' });
  const caps = h('div', { class: 'cap-overlay', 'aria-live': 'polite' });
  const fx = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  const dock = h('div', { class: 'scr-dock', hidden: true, 'data-group': 'faith' });
  el.append(present, tilesEl, dock, caps, fx);
  let dockKey = null;
  // Scripture on screen: 'dock' (compact card over the tiles, default), 'min' (just a pill) or 'full' (presentation area).
  const scrMode = () => { try { return localStorage.getItem('venue.scr.mode') || 'dock'; } catch { return 'dock'; } };
  const setScrMode = (m) => { try { localStorage.setItem('venue.scr.mode', m); } catch { /* */ } render(true); };
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
    if (R.content) return ['content:' + R.content.type + ':' + (R.content.videoId || R.content.url) + ':' + R.content.remoteHolderId];
    if (R.timeline.slideshow || R.timelineView) return R.timeline.items.length ? ['timeline'] : null;
    if (R.scripture && scrMode() === 'full') return ['scripture:' + R.scripture.reference + ':' + R.scripture.at];
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
    const c = R.content; const holder = c.remoteHolderId === R.me.id; const canStop = c.ownerId === R.me.id || R.isMod();
    const who = (R.p(c.ownerId) || {}).name || '';
    const sub = h('span', { class: 'tiny muted ellipsis' }, who + (c.type === 'youtube' ? (holder ? ' · you have the remote' : ' · synced') : ''));
    const head = h('div', { class: 'present-head' }, I(c.type === 'youtube' ? 'youtube' : 'presentation'), h('div', { class: 'grow col-tight' }, h('b', { class: 'ellipsis' }, c.title || 'Shared content'), sub),
      c.type === 'youtube' ? h('a', { class: 'icon-btn sm', href: c.url, target: '_blank', rel: 'noopener', 'data-tip': 'Open on YouTube', 'aria-label': 'Open on YouTube', html: icon('link', { size: 14 }) }) : null,
      canStop ? closeBtn('Stop', () => R.send('content-stop', {})) : null);
    const body = h('div', { class: 'present-body' });
    present.append(head, body);
    R.applyMediaSync = null; R.applyPage = null;
    if (c.type === 'youtube' && c.videoId) {
      body.classList.add('yt-wrap');
      const tap = h('button', { class: 'btn sm glass yt-tap', type: 'button', hidden: true, html: icon('volume', { size: 14 }) + '<span>Tap for sound</span>' });
      const fail = (msg) => body.replaceChildren(h('div', { class: 'empty-card' }, I('youtube'), h('b', null, msg || 'YouTube couldn’t play this video'), h('a', { class: 'btn sm', href: c.url, target: '_blank', rel: 'noopener' }, 'Watch on YouTube')));
      const yt = mountYouTube(body, { videoId: c.videoId, holder, media: c.media,
        onState: (m) => R.send('content-update', { media: m }),
        onError: fail,
        onNeedTap: () => { tap.hidden = false; } });
      tap.onclick = () => { yt.unmute(); tap.hidden = true; };
      body.append(tap);
      R.applyMediaSync = (m) => yt.apply(m);
      presentCleanup = () => { yt.destroy(); R.applyMediaSync = null; };
      return;
    }
    if (c.type === 'slides' && Array.isArray(c.pages) && c.pages.length) {
      const n = c.pages.length; let pg = Math.min(Math.max(1, c.page || 1), n);
      const img = h('img', { class: 'present-img', alt: '', decoding: 'async' });
      const count = h('span', { class: 'tiny muted slide-count' });
      const preload = (i) => { if (c.pages[i - 1]) { const im = new Image(); im.src = c.pages[i - 1]; } };
      const show = (p) => { pg = p; img.src = c.pages[p - 1]; img.alt = `${c.title || 'Slide'} — page ${p}`; count.textContent = `${p} / ${n}`; preload(p + 1); };
      const go = (d) => { const p = Math.min(n, Math.max(1, pg + d)); if (p === pg) return; show(p); R.send('content-update', { page: p }); };
      body.append(img); show(pg);
      if (holder) {
        present.append(h('div', { class: 'present-tools' }, h('button', { class: 'icon-btn glass', type: 'button', 'aria-label': 'Previous page', onclick: () => go(-1), html: icon('chevronLeft') }), count, h('button', { class: 'icon-btn glass', type: 'button', 'aria-label': 'Next page', onclick: () => go(1), html: icon('chevronRight') })));
        const key = (e) => { if (e.target.closest('input,textarea,[contenteditable]')) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); };
        document.addEventListener('keydown', key);
        let sx = null; body.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
        body.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }, { passive: true });
        presentCleanup = () => document.removeEventListener('keydown', key);
      } else present.append(h('div', { class: 'present-tools' }, count));
      R.applyPage = (p) => show(Math.min(n, Math.max(1, p || 1)));
      return;
    }
    if (c.type === 'image' && c.url) { body.append(h('img', { src: c.url, alt: c.title || '', class: 'present-img' })); return; }
    body.append(h('div', { class: 'empty-card' }, I('presentation'), h('b', null, 'This content type isn’t supported any more'), h('div', { class: 'tiny muted' }, 'Ask the presenter to share YouTube, slides or an image.')));
  }
  function buildTimeline() {
    const tl = R.timeline; const i = Math.min(tl.selected || 0, tl.items.length - 1); const it = tl.items[i];
    const go = (d) => { const n = (i + d + tl.items.length) % tl.items.length; tl.selected = n; if (R.isMod() && tl.slideshow) R.send('screen-timeline-select', { index: n }); render(true); };
    present.append(h('div', { class: 'present-head' }, I('timeline'), h('b', { class: 'grow' }, `Slide ${i + 1} of ${tl.items.length}`), tl.slideshow ? h('span', { class: 'pill live' }, 'Slideshow') : null,
      !tl.slideshow ? closeBtn('Close', () => { R.timelineView = false; render(true); }) : R.isMod() ? closeBtn('End slideshow', () => R.send('screen-timeline-slideshow', { on: false })) : null),
    h('div', { class: 'present-body' }, h('img', { src: it.dataUrl, alt: it.title || 'Slide', class: 'present-img' })),
    (!tl.slideshow || R.isMod()) ? h('div', { class: 'present-tools' }, h('button', { class: 'icon-btn glass', onclick: () => go(-1), html: icon('chevronLeft') }), h('button', { class: 'icon-btn glass', onclick: () => go(1), html: icon('chevronRight') })) : null);
  }
  // Verses + a selection bar (share to meeting chat / feed, copy).
  function scriptureBody(box) {
    const s = R.scripture;
    const selBar = h('div', { class: 'scr-sel', hidden: true });
    box.replaceChildren(h('div', { class: 'skel', style: { height: '90px' } }));
    api(`/api/bible/passage?ref=${encodeURIComponent(s.reference)}&t=${R.bibleTr()}`).then((p) => {
      const paint = (vs) => {
        selBar.hidden = !vs.length; if (!vs.length) return;
        const text = p.verses.filter((v) => vs.includes(v.v)).map((v) => String(v.text).replace(/^¶\s*/, '')).join(' ');
        const ref = refLabel(p.bookName || p.reference.replace(/\s+\d.*$/, ''), p.chapter, vs);
        const passage = { reference: ref, text, translation: p.translation?.id || R.bibleTr(), short: p.translation?.short || '' };
        selBar.replaceChildren(h('b', { class: 'grow ellipsis' }, ref),
          h('button', { class: 'btn sm primary', 'data-group': 'social', onclick: () => { R.send('chat', { text: '', attachment: { kind: 'passage', ...passage } }); toast(`${ref} shared to chat`, { icon: 'chat', group: 'social', ms: 2000 }); clear(); }, html: icon('chat', { size: 14 }) + '<span>Share to chat</span>' }),
          h('button', { class: 'btn sm', 'data-group': 'social', onclick: () => sharePassageToFeed(passage), html: icon('feed', { size: 14 }) + '<span>Feed</span>' }),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Clear selection', html: icon('x', { size: 14 }), onclick: () => clear() }));
      };
      p.selected = []; // selection here is the reader's own, not the host's highlight
      const verses = versesEl(p, { onSelect: paint });
      const clear = () => { verses.querySelectorAll('.verse.sel').forEach((e) => e.classList.remove('sel')); p.selected = []; selBar.hidden = true; };
      box.replaceChildren(h('div', { class: 'scripture-ref' }, p.reference, h('small', null, p.translation?.name || p.translation?.short || '')), verses, h('p', { class: 'tiny faint scr-hint' }, 'Tap verses to share them'));
    }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, 'Couldn’t load this passage in that translation. ' + (e.message || ''))));
    return selBar;
  }
  const canClear = () => R.isMod() || R.isSpeaker(R.me.id);
  const modeBtn = (ic, tip, m) => h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': tip, 'aria-label': tip, html: icon(ic, { size: 15 }), onclick: (e) => { e.stopPropagation(); setScrMode(m); } });
  function buildScripture() {
    const s = R.scripture;
    const body = h('div', { class: 'scripture-card' });
    const tsel = translationSelect(R.bibleTr(), (v) => R.setBibleTr(v), { compact: true });
    const selBar = scriptureBody(body);
    present.append(h('div', { class: 'present-head', 'data-group': 'faith' }, I('bookOpen'), h('b', { class: 'grow' }, s.reference), h('span', { class: 'tiny muted' }, 'by ' + s.by), tsel,
      modeBtn('minimize', 'Dock it small', 'dock'),
      canClear() ? closeBtn('Clear', () => R.send('scripture-clear', {})) : null), h('div', { class: 'present-body scroll' }, body), selBar);
  }
  function renderDock() {
    const s = R.scripture, mode = scrMode();
    const k = s && mode !== 'full' ? [s.reference, s.at, mode, R.bibleTr()].join('|') : null;
    if (k === dockKey) return;
    dockKey = k; dock.hidden = !k; dock.dataset.mode = mode;
    if (!k) { dock.replaceChildren(); return; }
    if (mode === 'min') {
      dock.replaceChildren(h('button', { class: 'scr-pill', type: 'button', onclick: () => setScrMode('dock'), 'aria-label': `Show ${s.reference}` }, h('span', { html: icon('bookOpen', { size: 15 }) }), h('b', null, s.reference), h('span', { class: 'chev', html: icon('chevronDown', { size: 14 }) })));
      return;
    }
    const body = h('div', { class: 'scr-body' });
    const selBar = scriptureBody(body);
    dock.replaceChildren(h('div', { class: 'scr-head' }, h('span', { class: 'scr-ic', html: icon('bookOpen', { size: 15 }) }), h('b', { class: 'grow ellipsis' }, s.reference),
      translationSelect(R.bibleTr(), (v) => R.setBibleTr(v), { compact: true }),
      modeBtn('chevronDown', 'Collapse', 'min'), modeBtn('maximize', 'Expand', 'full'),
      canClear() ? h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Take off screen', 'aria-label': 'Take off screen', html: icon('x', { size: 15 }), onclick: () => R.send('scripture-clear', {}) }) : null),
    body, selBar);
  }
  function buildTeamBoard() {
    const toStroke = (s) => ({ ...s, tool: s.tool || (s.erase ? 'eraser' : 'pen') });
    const b = createBoard({ strokes: (R.teamStrokes || []).map(toStroke), pages: false, upload: null,
      onChange: (bd, info) => { if (info.type !== 'stroke') return; const s = info.stroke; (R.teamStrokes ||= []).push({ ...s, erase: s.tool === 'eraser' }); R.send('wb-stroke', { id: s.id, tool: s.tool, points: s.points, color: s.color, width: s.width, erase: s.tool === 'eraser' }); } });
    R.teamBoard = { set strokes(v) { b.strokes = (v || []).map(toStroke); }, append: (list) => b.append(list.map(toStroke)) };
    const bar = boardToolbar(b, { tools: ['pencil', 'pen', 'brush', 'eraser'], files: false, pages: false, history: false, clear: false, title: () => 'team-board', compact: true });
    const unbind = boardKeys(b, bar);
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('users'), h('b', { class: 'grow' }, 'Team board'), h('span', { class: 'tiny muted' }, 'Everyone can draw'),
      R.isMod() ? h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmDlg('Clear the team board for everyone?', { ok: 'Clear', danger: true })) R.send('wb-clear', {}); }, html: icon('trash', { size: 14 }) + '<span>Clear</span>' }) : null, closeBtn('Close', () => { R.stageView = null; render(true); })),
    bar, h('div', { class: 'present-body board-wrap' }, b.el));
    presentCleanup = () => { unbind(); b.destroy(); R.teamBoard = null; };
  }
  function buildMyBoard() {
    const ref = R.myBoardRef;
    const b = createBoard({ doc: R.myBoard, upload: (f) => uploadFile(f, { purpose: 'whiteboard', headers: R.headers() }),
      onChange: (bd, info) => { R.myBoard = bd.doc; R.saveMyBoard(); R.sendBoardFrame(info); }, onPage: () => bar && bar.sync() });
    R.myBoard = b.doc;
    const bar = boardToolbar(b, { title: () => (R.myBoardRef && R.myBoardRef.title) || 'my-board', compact: true });
    const unbind = boardKeys(b, bar);
    const signed = !!state.user;
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('pen'),
      h('b', { class: 'ellipsis' }, ref ? ref.title : 'My board'), h('span', { class: 'tiny muted grow ellipsis' }, R.boardSharing ? '● Live for everyone' : ref ? 'Autosaves to My boards' : 'Private'),
      signed ? h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Open a saved board', 'aria-label': 'Open a saved board', html: icon('folder', { size: 16 }), onclick: () => R.openSavedBoard() }) : null,
      signed && !ref ? h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Save to my boards', 'aria-label': 'Save to my boards', html: icon('download', { size: 16 }), onclick: () => R.saveBoardToAccount() }) : null,
      h('button', { class: `btn sm ${R.boardSharing ? 'ghost' : 'primary'}`, 'data-group': 'content', onclick: () => { R.shareBoard(!R.boardSharing); render(true); }, html: icon(R.boardSharing ? 'eyeOff' : 'eye', { size: 14 }) + `<span>${R.boardSharing ? 'Stop sharing' : 'Share live'}</span>` }),
      closeBtn('Close', () => { R.stageView = null; render(true); })),
    bar, h('div', { class: 'present-body board-wrap' }, b.el));
    presentCleanup = () => { unbind(); b.destroy(); };
  }
  function buildViewBoard(ownerId) {
    const info = R.boards.find((x) => x.ownerId === ownerId);
    const b = createBoard({ readOnly: true, pages: false });
    const pg = h('span', { class: 'tiny muted' });
    const show = (f) => { if (!f) return; b.doc = { bg: f.bg, pages: [f] }; pg.textContent = f.pages > 1 ? `Page ${f.page + 1} of ${f.pages}` : ''; };
    R.viewingBoard = { show, append: (list) => b.append(list) }; R.viewingOwner = ownerId;
    show(R.viewFrames[ownerId]);
    present.append(h('div', { class: 'present-head', 'data-group': 'content' }, I('eye'), h('b', { class: 'grow ellipsis' }, `${info ? info.name : 'Someone'}’s board`), pg, h('span', { class: 'pill live' }, 'Live'),
      h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Save a PNG of this page', 'aria-label': 'Save PNG', html: icon('download', { size: 16 }), onclick: () => b.png().then((x) => download(`${(info && info.name) || 'board'}-board.png`, x)) }),
      closeBtn('Close', () => { R.stageView = null; render(true); })),
      h('div', { class: 'present-body board-wrap' }, b.el));
    presentCleanup = () => { R.viewingBoard = null; R.viewingOwner = null; b.destroy(); };
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
    if (force) dockKey = null;
    renderDock();
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
