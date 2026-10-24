// The live room: pre-join → join/create → waiting → room. The footer command bar doubles as the dock.
import { h, esc, api, toast, toastErr, sheet, menu, confirmDlg, promptDlg, copy, isMobile, avatar } from '../ui.js';
import { icon, LOGO } from '../icons.js';
import { state, navigate, requireLogin, toggleTheme } from '../app.js';
import { registerCommands, unregisterCommands, setBarContext, refreshBar, focusBar } from '../commands.js';
import { QUICK, emojiName, emojiPopover, pushRecent, searchEmoji } from '../emoji.js';
import { searchSounds } from './sounds.js';
import { Media, listDevices, devicePrefs, AUDIO_CONSTRAINTS } from './media.js';
import { createPanel } from './panels.js';
import { buildTools } from './tools.js';
import { createStage } from './stage.js';
import { Captioner } from './captions.js';
import { LocalRecorder } from './recorder.js';
import { handle, chime } from './wsHandlers.js';
import { maybeShowBanner } from '../pwa.js';

export const isRoom = true;
const fmtCode = (c) => c ? `${c.slice(0, 3)}-${c.slice(3)}` : '';
const roomsStore = () => { try { return JSON.parse(localStorage.getItem('venue.rooms')) || {}; } catch { return {}; } };
const saveRoom = (code, v) => { const s = roomsStore(); s[code] = { ...v, at: Date.now() }; for (const k of Object.keys(s)) if (Date.now() - s[k].at > 864e5 * 2) delete s[k]; localStorage.setItem('venue.rooms', JSON.stringify(s)); };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const deviceKind = () => (/iPhone|Android.+Mobile/.test(navigator.userAgent) ? 'mobile' : /iPad|Android/.test(navigator.userAgent) ? 'tablet' : 'desktop');
const ibtn = (ic, tip, run, { group = '', cls = '' } = {}) => h('button', { class: `icon-btn ${cls}`, 'data-group': group, 'data-tip': tip, 'aria-label': tip, type: 'button', onclick: run, html: icon(ic, { size: 18 }) });

export async function mount(view, params) {
  const room = new Room(view, params);
  await room.start();
  return { unmount: () => room.destroy() };
}

class Room {
  constructor(view, params) {
    this.view = view; this.params = params;
    this.code = params.code ? params.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    this.config = state.config || {};
    this.intent = lsGetSession('venue.intent');
    this.alive = true;
  }
  /* ------------------------------------------------------------------ pre-join */
  async start() {
    document.title = (this.code ? fmtCode(this.code) : 'New room') + ' · 1venue';
    setBarContext({ placeholders: ['Type to search actions…'], pinned: () => [] });
    if (!this.code && !(this.intent && this.intent.create)) this.intent = { create: true, name: 'Instant meeting' };
    const intent = this.intent;
    const creating = !!(intent && intent.create && (!this.code || !intent.code || intent.code === this.code));
    // quick rejoin if we already joined this room (e.g. refresh)
    const saved = this.code && roomsStore()[this.code];
    if (!creating && saved && saved.wsCredential && Date.now() - saved.at < 6 * 3600e3 && this.params.fresh == null) {
      this.joinRes = null; this.prefill = saved;
    }
    let ev = null;
    if (this.code && !creating) { ev = await api(`/api/events/${this.code}?optional=1`).catch(() => null); }
    this.event = ev;
    this.prejoin({ creating, ev });
  }
  prejoin({ creating, ev }) {
    const prefs = lsGet('venue.prejoin', { mic: true, cam: false });
    const stageEvent = (ev && ev.category && ev.category !== 'meeting') || (this.intent && this.intent.stage);
    const audience = stageEvent && !creating && !(ev && ev.isHost);
    let mic = audience ? false : prefs.mic, cam = audience ? false : prefs.cam, stream = null;
    const video = h('video', { autoplay: true, playsinline: true, muted: true, class: 'pj-video mirror' });
    const name = h('input', { class: 'input lg', placeholder: 'Your name', maxlength: 40, value: state.user?.displayName || state.user?.name || this.prefill?.name || lsGet('venue.name', ''), autocomplete: 'name' });
    const meter = h('div', { class: 'pj-meter' }, h('i'));
    let ac, raf;
    const stopPrev = () => { cancelAnimationFrame(raf); ac && ac.close().catch(() => {}); ac = null; stream && stream.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null; };
    const preview = async () => {
      stopPrev();
      if (!mic && !cam) { pv.classList.remove('has-video'); return; }
      try {
        const d = devicePrefs();
        stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { ...AUDIO_CONSTRAINTS, deviceId: d.audioinput } : false, video: cam ? { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: d.videoinput } : false });
        video.srcObject = stream; pv.classList.toggle('has-video', cam);
        if (mic) { ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaStreamSource(stream).connect(an); const b = new Uint8Array(an.fftSize);
          const loop = () => { an.getByteTimeDomainData(b); let p = 0; for (const v of b) p = Math.max(p, Math.abs(v - 128)); meter.firstChild.style.width = Math.min(100, p * 1.6) + '%'; raf = requestAnimationFrame(loop); }; loop(); }
      } catch (e) { toast('Camera/mic blocked — you can still join and turn them on later', { icon: 'alert', ms: 4500 }); mic = cam = false; paint(); }
    };
    const micB = h('button', { class: 'pj-btn', type: 'button', 'data-group': 'media', onclick: () => { if (audience) return toast('You’ll join as audience — request to speak once inside', { icon: 'stage' }); mic = !mic; paint(); preview(); } });
    const camB = h('button', { class: 'pj-btn', type: 'button', 'data-group': 'media', onclick: () => { if (audience) return toast('You’ll join as audience — request to speak once inside', { icon: 'stage' }); cam = !cam; paint(); preview(); } });
    const devB = h('button', { class: 'pj-btn', type: 'button', 'data-group': 'settings', 'data-tip': 'Devices', onclick: () => this.deviceSheet(() => preview()), html: icon('headphones') });
    const paint = () => {
      micB.innerHTML = icon(mic ? 'mic' : 'micOff'); micB.classList.toggle('off', !mic); micB.dataset.tip = mic ? 'Mic on' : 'Mic off';
      camB.innerHTML = icon(cam ? 'video' : 'videoOff'); camB.classList.toggle('off', !cam); camB.dataset.tip = cam ? 'Camera on' : 'Camera off';
      meter.hidden = !mic;
    };
    const pv = h('div', { class: 'pj-preview' }, h('div', { class: 'pj-av' }, avatar(name.value || 'You', state.user?.avatarUrl, 'xl')), video, h('div', { class: 'pj-ctl' }, micB, camB, devB), meter);
    name.addEventListener('input', () => pv.querySelector('.pj-av').replaceChildren(avatar(name.value || 'You', state.user?.avatarUrl, 'xl')));
    const title = creating ? (this.intent.name || 'New room') : ev ? ev.title : fmtCode(this.code);
    const joinB = h('button', { class: 'btn primary lg block pulse-btn', type: 'submit', html: icon(creating ? 'zap' : 'login', { size: 18 }) + `<span>${creating ? 'Start now' : ev && ev.isHost && !ev.live ? 'Go live' : audience ? 'Join the audience' : 'Join now'}</span>` });
    const form = h('form', { class: 'pj-form', onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim(); if (n.length < 1) { name.focus(); return toast('Enter your name', { icon: 'user' }); }
      lsSet('venue.name', n); if (!audience) lsSet('venue.prejoin', { mic, cam });
      joinB.disabled = true; joinB.classList.add('loading');
      stopPrev();
      try { await this.join({ name: n, mic, cam, creating }); }
      catch (err) { joinB.disabled = false; joinB.classList.remove('loading'); toastErr(err); preview(); }
    } }, h('div', { class: 'eyebrow' }, creating ? 'You’re hosting' : ev ? (ev.live ? '● Live now' : 'Event') : 'Joining'), h('h1', { class: 'pj-title' }, title),
      ev && ev.host ? h('div', { class: 'row gap-s muted small' }, avatar(ev.host.name, ev.host.avatarUrl, 'xs'), `Hosted by ${ev.host.name}`) : null,
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Display name'), name),
      !state.user && this.config.accountsEnabled ? h('p', { class: 'tiny muted' }, 'Joining as a guest. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); requireLogin('Sign in to keep your history'); } }, 'Sign in'), ' to save transcripts and history.') : null,
      joinB,
      h('div', { class: 'row gap-s tiny muted center' }, h('span', { html: icon('lock', { size: 12 }) }), 'Recordings stay on your device. Captions are processed privately.'));
    this.view.replaceChildren(h('div', { class: 'prejoin' }, h('div', { class: 'pj-art', 'aria-hidden': 'true' }), pv, form));
    this.cleanupPrejoin = stopPrev;
    paint(); preview();
    setTimeout(() => name.value ? joinB.focus() : name.focus(), 60);
  }
  /* ------------------------------------------------------------------ join */
  async join({ name, mic, cam, creating }) {
    const saved = this.code ? roomsStore()[this.code] : null;
    const pid = saved?.participantId || undefined;
    let r;
    if (creating) {
      const it = this.intent;
      try {
        r = await api('/api/create', { method: 'POST', body: { name: it.name || 'Meeting', participantName: name, eventId: it.eventId, stage: !!it.stage, speakerSeats: it.speakerSeats, waitingRoom: !!it.waitingRoom, device: deviceKind() } });
      } catch (e) {
        if (e.status === 409 && (e.data?.code || it.code)) { this.code = e.data?.code || it.code; sessionStorage.removeItem('venue.intent'); return this.join({ name, mic, cam, creating: false }); }
        throw e;
      }
      sessionStorage.removeItem('venue.intent');
      this.code = r.code; this.inviteKey = r.inviteToken;
      history.replaceState({}, '', '/' + fmtCode(r.code));
    } else {
      try {
        r = await api('/api/join', { method: 'POST', body: { code: this.code, participantName: name, key: this.params.key, participantId: pid, device: deviceKind() } });
      } catch (e) {
        if (e.status === 404 && this.event && this.event.isHost) {
          if (await confirmDlg('This event isn’t live yet. Start it now?', { ok: 'Go live' })) { this.intent = { create: true, eventId: this.event.id, name: this.event.title, stage: this.event.category !== 'meeting', speakerSeats: this.event.speakerSeats, code: this.event.code }; return this.join({ name, mic, cam, creating: true }); }
        }
        if (e.status === 404 && this.event) throw new Error('This event hasn’t started yet — we’ll be here when it goes live.');
        throw e;
      }
      if (this.params.key) this.inviteKey = this.params.key;
    }
    this.joinRes = r;
    this.me = { id: r.participantId, name, role: r.role || 'participant' };
    this.wsCredential = r.wsCredential;
    saveRoom(this.code, { participantId: r.participantId, wsCredential: r.wsCredential, name });
    this.want = { mic, cam };
    if (r.status === 'WAITING') return this.waitingScreen(r);
    this.enter(r);
  }
  waitingScreen(r) {
    this.view.replaceChildren(h('div', { class: 'waiting' }, h('div', { class: 'wait-orb', html: LOGO(64) }), h('h2', null, 'Waiting for the host to let you in'), h('p', { class: 'muted' }, `${r.name || fmtCode(this.code)} · we’ll bring you in automatically.`),
      h('div', { class: 'dots-loader' }, h('i'), h('i'), h('i')), h('button', { class: 'btn ghost', onclick: () => { this.destroy(); navigate('/'); } }, 'Cancel')));
    this.waitingMode = true;
    this.connectWs((m) => {
      if (m.type === 'admitted') { this.waitingMode = false; chime(880); api('/api/join', { method: 'POST', body: { code: this.code, participantName: this.me.name, participantId: this.me.id, key: this.params.key, device: deviceKind() } }).then((r2) => { this.wsCredential = r2.wsCredential || this.wsCredential; this.joinRes = r2; this.ws && this.ws.close(); this.ws = null; this.enter(r2); }).catch(toastErr); return true; }
      if (m.type === 'declined') { this.view.replaceChildren(h('div', { class: 'waiting' }, h('h2', null, 'The host declined your request'), h('a', { class: 'btn primary', href: '/' }, 'Back home'))); this.destroy(); return true; }
      return false;
    });
  }
  /* ------------------------------------------------------------------ websocket */
  connectWs(pre) {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/';
    let tries = 0;
    const open = () => {
      if (!this.alive) return;
      const ws = this.ws = new WebSocket(url);
      this.wsState = 'connecting';
      ws.onopen = () => { tries = 0; this.wsState = 'open'; ws.send(JSON.stringify({ type: 'register', participantId: this.me.id, code: this.code, wsCredential: this.wsCredential })); this.queue && this.queue.splice(0).forEach((x) => ws.send(x)); this.netBanner && this.netBanner(false); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (pre && pre(m)) return; if (!this.waitingMode && this.inRoom) handle(this, m); };
      ws.onclose = (e) => {
        this.wsState = 'closed';
        if (!this.alive || this.ws !== ws) return;
        if (e.code === 4403 || e.code === 4404) { if (this.inRoom) this.ended({ reason: 'gone' }); return; }
        this.netBanner && this.netBanner(true);
        setTimeout(open, Math.min(15000, 600 * 2 ** tries++));
      };
    };
    open();
  }
  send(type, obj = {}) {
    const s = JSON.stringify({ type, ...obj });
    if (this.ws && this.ws.readyState === 1) this.ws.send(s); else (this.queue ||= []).push(s);
  }
  headers() { return { 'X-Room-Code': this.code, 'X-Participant-Id': this.me.id, 'X-Room-Credential': this.wsCredential }; }
}
function lsGetSession(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } }
export { Room, fmtCode, ibtn, lsGet, lsSet, deviceKind };

/* ======================================================================= in-room state & layout */
Object.assign(Room.prototype, {
  enter(r) {
    this.cleanupPrejoin && this.cleanupPrejoin();
    this.inRoom = true;
    this.roomName = r.name || fmtCode(this.code);
    this.data = { chat: [], dms: [], groups: new Map(), polls: [], questions: [], comments: [], captions: [], activity: [] };
    this.unread = { chat: 0, dm: 0, engage: 0 };
    Object.assign(this, { dmNames: {}, dmRead: {}, drafts: {}, replyOpen: new Set(), speaking: new Set(), quality: {}, viewFrames: {}, boards: [], groupOpen: null, dmWith: null });
    this.security = r.security || {}; this.maxParticipants = this.security.maxParticipants || this.config.maxParticipants;
    this.waiting = r.waiting || []; this.hands = r.raisedHands || [];
    this.stage = { enabled: false, requests: [], speakers: [] };
    this.timeline = { items: [], slideshow: false, selected: 0 };
    this.content = r.content || null; this.scripture = null; this.stageView = null;
    this.layout = lsGet('venue.layout', 'grid'); this.pinned = null; this.mirror = lsGet('venue.mirror', true);
    this.isMobile = isMobile(); this.showCaptions = lsGet('venue.showCaptions', true);
    this.myBoard = lsGet('venue.myboard2', null) || { strokes: lsGet('venue.myboard', []) }; this.myBoardRef = state.user ? lsGet('venue.myboard.ref', null) : null; this.boardSharing = false; this.teamStrokes = [];
    this.peopleMap = new Map(); this.setPeople(r.participants || []);
    this.startedAt = Date.now(); this.recording = null; this.transcribe = false;
    this.media = new Media({
      onTrack: (id, track, source, isLocal) => this.onTrack(id === '__local' ? this.me.id : id, track, source, isLocal),
      onTrackGone: (id, track, source) => this.onTrackGone(id === '__local' ? this.me.id : id, track, source),
      onSpeakers: (ids) => { this.speaking = new Set(ids); this.stageR.paintAll(); if (this.panel.tab === 'people') this.panel.refresh(); },
      onQuality: (id, q) => { this.quality[id] = String(q).toLowerCase(); this.stageR.paintAll(); },
      onState: (s) => { this.mediaStatus = s; this.paintHead(); if (s === 'disconnected' && this.alive && !this.switchingRoom) this.netBanner(true, 'Media disconnected — reconnecting…'); else if (s === 'connected') this.netBanner(false); },
      onLocal: () => { this.stageR.paintAll(); refreshBar(); this.paintHead(); },
    });
    this.captioner = new Captioner(this);
    this.recorder = new LocalRecorder(this.media); this.recorder.onChange = () => { this.paintHead(); refreshBar(); this.panel.refresh(); };
    this.tools = buildTools(this);
    this.panel = createPanel(this);
    this.stageR = createStage(this);
    this.buildUi();
    this.connectWs();
    this.connectMedia().then(() => this.applyWant());
    this.registerCmds();
    this.tick = setInterval(() => this.paintHead(), 1000);
    this.onKey = (e) => this.shortcut(e); window.addEventListener('keydown', this.onKey);
    this.onUnload = () => { navigator.sendBeacon && navigator.sendBeacon('/api/leave', new Blob([JSON.stringify({ code: this.code, participantId: this.me.id })], { type: 'application/json' })); };
    window.addEventListener('pagehide', this.onUnload);
    this.onResize = () => { const m = isMobile(); if (m !== this.isMobile) { this.isMobile = m; this.renderStage(true); } }; window.addEventListener('resize', this.onResize);
    if (this.peopleMap.size <= 1) setTimeout(() => this.peopleMap.size <= 1 && this.alive && toast('You’re the first one here — share the invite to bring people in', { icon: 'userPlus', group: 'people', ms: 5000 }), 1500);
    if (navigator.mediaSession) try { navigator.mediaSession.metadata = new MediaMetadata({ title: this.roomName, artist: '1venue' }); } catch { /* */ }
  },
  setPeople(list) { this.peopleMap = new Map(list.filter((p) => p.status !== 'WAITING').map((p) => [p.id, p])); const mp = this.peopleMap.get(this.me.id); if (mp) this.me.role = mp.role; },
  people() { return [...this.peopleMap.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0)); },
  p(id) { return this.peopleMap.get(id) || (id === this.me?.id ? this.me : null); },
  meP() { return this.peopleMap.get(this.me.id); },
  isMod() { const r = this.meP()?.role || this.me.role; return r === 'host' || r === 'cohost'; },
  isSpeaker(id) { if (!this.stage.enabled) return true; const p = this.p(id); if (p && (p.role === 'host' || p.role === 'cohost')) return true; return (this.stage.speakers || []).some((s) => (s.id || s) === id); },
  perm(k) { const p = this.meP(); return !p || !p.permissions || p.permissions[k] !== false; },
  mediaState(id) {
    if (id === this.me.id) return { mic: this.media.mic, cam: this.media.cam };
    const rp = this.media.room && this.media.room.remoteParticipants && this.media.room.remoteParticipants.get(id);
    return rp ? { mic: rp.isMicrophoneEnabled, cam: rp.isCameraEnabled } : { mic: false, cam: false };
  },
  bibleTr() { return lsGet('venue.bibleTr', this.config.bible?.defaultTranslation || 'kjv'); },
  setBibleTr(v) { lsSet('venue.bibleTr', v); if (this.scripture) this.renderStage(true); },
  captionLang() { return lsGet('venue.captionLang', 'en'); },
  setCaptionLang(v) { lsSet('venue.captionLang', v); if (this.captioner.on) { this.captioner.stop(); this.captioner.start(); } },
  setShowCaptions(v) { this.showCaptions = v; lsSet('venue.showCaptions', v); this.stageR.paintCaps(); },
  onCaptionMode(mode) { this.captionMode = mode; this.panel.refresh(); },
  // My board: kept on this device; when it came from (or was saved to) your account, edits autosave there too.
  saveMyBoard() {
    clearTimeout(this.mbT);
    this.mbT = setTimeout(() => {
      try { lsSet('venue.myboard2', this.myBoard); } catch { /* storage full: account copy still saves */ }
      const ref = this.myBoardRef;
      if (ref && state.user) api(`/api/whiteboards/${ref.id}`, { method: 'PUT', body: { data: this.myBoard } }).catch((e) => { if (e.status === 404) { this.myBoardRef = null; lsSet('venue.myboard.ref', null); } else toastErr(e); });
    }, 700);
  },
  boardFrame() { const d = this.myBoard || {}; const pages = d.pages || [{ strokes: d.strokes || [] }]; const i = Math.min(d.activePage || 0, pages.length - 1); const p = pages[i] || {}; return { page: i, pages: pages.length, bg: d.bg || 'dots', strokes: (p.strokes || []).slice(-1500), images: p.images || [], texts: p.texts || [] }; },
  // Live view for others: single strokes go out at once; page changes / edits as a throttled full frame.
  sendBoardFrame(info) {
    if (!this.boardSharing) return;
    if (info && info.type === 'stroke') { this.send('pboard-frame', { append: true, page: this.boardFrame().page, strokes: [info.stroke] }); return; }
    clearTimeout(this.bfT); const wait = Math.max(0, 300 - (Date.now() - (this.bfAt || 0)));
    this.bfT = setTimeout(() => { this.bfAt = Date.now(); this.send('pboard-frame', this.boardFrame()); }, wait);
  },
  setMyBoard(doc, ref) { this.myBoard = doc; this.myBoardRef = ref || null; lsSet('venue.myboard.ref', this.myBoardRef); this.saveMyBoard(); this.sendBoardFrame(); if (this.stageView === 'my-board') this.renderStage(true); },
  async openSavedBoard() {
    if (!state.user) return requireLogin('Sign in to open your saved boards');
    const s = sheet({ title: 'Open a saved board', icon: 'board', group: 'content' });
    s.body.append(h('p', { class: 'small muted' }, 'Loading…'));
    try {
      const { boards = [] } = await api('/api/whiteboards');
      s.body.replaceChildren(boards.length ? h('div', { class: 'stack-s' }, ...boards.map((b) => h('button', { class: 'list-item', type: 'button', onclick: async () => { try { const r = await api(`/api/whiteboards/${b.id}`); this.setMyBoard(r.data || {}, { id: r.id, title: r.title }); s.close(); toast(`Opened “${r.title}”`, { icon: 'board', group: 'content' }); } catch (e) { toastErr(e); } } },
        h('span', { class: 'ico-tile sm', 'data-group': 'content', html: icon('board', { size: 16 }) }), h('div', { class: 'grow' }, h('b', null, b.title), h('div', { class: 'tiny muted' }, `${b.pages || 1} page${(b.pages || 1) === 1 ? '' : 's'}`)), h('span', { html: icon('chevronRight', { size: 16 }) }))))
        : h('p', { class: 'small muted' }, 'No saved boards yet. Draw here and use “Save to my boards”.'));
    } catch (e) { s.body.replaceChildren(h('p', { class: 'small muted' }, e.message || 'Could not load your boards')); }
  },
  async saveBoardToAccount() {
    if (!state.user) return requireLogin('Sign in to save boards');
    const title = await promptDlg('Save board as', { value: `${this.event?.title || "Meeting"} board`, ok: 'Save' });
    if (title == null) return;
    try { const r = await api('/api/whiteboards', { method: 'POST', body: { title: title.trim() || 'Meeting board', data: this.myBoard } }); this.myBoardRef = { id: r.id, title: r.title }; lsSet('venue.myboard.ref', this.myBoardRef); toast('Saved to My boards — edits now autosave', { icon: 'check', group: 'content' }); if (this.stageView === 'my-board') this.renderStage(true); } catch (e) { toastErr(e); }
  },
  refreshBar() { refreshBar(); },
  toolBadge(id) { return (id === 'record' && this.recorder.state !== 'idle') || (id === 'captions' && this.captioner.on) || (id === 'boards' && this.boardSharing) || (id === 'present' && !!this.content); },
  recountDm() { const inc = {}; this.data.dms.forEach((e) => { if (e.fromId !== this.me.id) inc[e.fromId] = (inc[e.fromId] || 0) + 1; }); this.unread.dm = Object.keys(inc).reduce((s, k) => s + Math.max(0, inc[k] - (this.dmRead[k] || 0)), 0); },
  changed() {
    cancelAnimationFrame(this.rafC);
    this.rafC = requestAnimationFrame(() => { if (!this.alive) return; this.stageR.render(); this.stageR.paintAll(); this.panel.refresh(); this.paintHead(); refreshBar(); });
  },
  renderStage(force) { this.stageR.render(force); },
  cycleLayout(dir = 1) { const L = ['grid', 'spotlight', 'speaker']; this.setLayout(L[(L.indexOf(this.layout) + dir + 3) % 3]); },
  setLayout(l) { this.layout = l; lsSet('venue.layout', l); this.renderStage(true); this.paintHead(); refreshBar(); toast({ grid: 'Grid view', spotlight: 'Spotlight view', speaker: 'Speaker view' }[l], { icon: l === 'grid' ? 'grid' : l === 'spotlight' ? 'spotlight' : 'speaker', group: 'media', ms: 1200 }); },
  pin(id) { this.pinned = id; if (id && this.layout === 'grid') this.layout = 'spotlight'; this.renderStage(true); },
  applyWant() { const w = this.want || {}; if (!this.isSpeaker(this.me.id)) return; if (w.mic && this.perm('microphone')) this.toggleMic(true); if (w.cam && this.perm('camera')) this.toggleCam(true); },
  applyPerms() { if (!this.perm('microphone') && this.media.mic) this.media.setMic(false); if (!this.perm('camera') && this.media.cam) this.media.setCam(false); if (!this.perm('screenShare') && this.media.sharing) this.toggleShare(false); },
  promoted() { this.reconnectMedia(true); },
  demoted() { this.media.setMic(false).catch(() => {}); this.media.setCam(false).catch(() => {}); if (this.media.sharing) this.toggleShare(false); },

  /* --------------------------------------------------------------- media */
  async connectMedia(roomOverride) {
    if (!this.config.livekitConfigured) { await this.media.fallback(); this.mediaStatus = 'local'; this.netNote = 'Live audio/video server not configured — local preview only'; this.paintHead(); return; }
    try {
      const t = await api('/api/livekit-token', { method: 'POST', body: { code: this.code, participantId: this.me.id, participantName: this.me.name, wsCredential: this.wsCredential, room: roomOverride || undefined } });
      await this.media.connect({ url: t.url, token: t.token, media: t.media || this.config.media });
      const lr = this.media.room;
      if (lr && lr.canPlaybackAudio === false) this.audioBlocked();
      if (lr) lr.on && lr.on('audioPlaybackChanged', () => { if (lr.canPlaybackAudio === false) this.audioBlocked(); });
      // tracks already published by others
      lr && lr.remoteParticipants && lr.remoteParticipants.forEach((rp) => rp.trackPublications.forEach((pub) => pub.track && pub.isSubscribed && this.onTrack(rp.identity, pub.track, pub.source)));
    } catch (e) { console.warn('media', e); toast('Couldn’t connect audio/video — retrying from Tools › Diagnostics', { icon: 'wifi', group: 'media' }); await this.media.fallback().catch(() => {}); }
  },
  audioBlocked() {
    if (this.audioBtn) return;
    this.audioBtn = h('button', { class: 'audio-unlock btn primary', onclick: async () => { await this.media.room.startAudio().catch(() => {}); this.audioBtn.remove(); this.audioBtn = null; }, html: icon('volume', { size: 18 }) + '<span>Tap to hear the room</span>' });
    this.root.append(this.audioBtn);
  },
  async reconnectMedia(silent) { this.switchingRoom = true; await this.media.disconnect().catch(() => {}); this.audioEls && this.audioEls.forEach((a) => a.remove()); this.audioEls = new Map(); await this.connectMedia(this.breakoutRoom); this.switchingRoom = false; if (!silent) toast('Media reconnected', { icon: 'refresh', group: 'settings' }); },
  onTrack(id, track, source) {
    if (track.kind === 'audio') {
      if (id === this.me.id) return;
      this.audioEls ||= new Map();
      let a = this.audioEls.get(id + source); if (!a) { a = h('audio', { autoplay: true, hidden: true }); this.root.append(a); this.audioEls.set(id + source, a); }
      track.attach(a); const out = lsGet('venue.speaker', null); if (out && a.setSinkId) a.setSinkId(out).catch(() => {});
      this.stageR.paintAll(); return;
    }
    this.stageR.setTrack(id, track, source); this.stageR.render();
    if (source === 'screen_share' && id !== this.me.id) toast(`${this.p(id)?.name || 'Someone'} is presenting`, { icon: 'screen', group: 'media', ms: 1800 });
  },
  onTrackGone(id, track, source) {
    if (track && track.kind === 'audio') { const a = this.audioEls && this.audioEls.get(id + source); if (a) { try { track.detach(a); } catch { /* */ } } this.stageR.paintAll(); return; }
    this.stageR.clearTrack(id, source);
  },
  async toggleMic(force) {
    const on = typeof force === 'boolean' ? force : !this.media.mic;
    if (on && !this.isSpeaker(this.me.id)) { toast('You’re in the audience — request to speak first', { icon: 'stage', group: 'engage' }); return; }
    if (on && !this.perm('microphone') && !this.isMod()) { toast('The host has disabled microphones', { icon: 'micOff' }); return; }
    if (on && this.meP()?.mutedByHost && !this.isMod()) this.send('unmute-self', {});
    try { await this.media.setMic(on); if (this.captioner.on && this.captioner.mode === 'webspeech') { this.captioner.stop(); this.captioner.start(); } } catch (e) { toastErr(e); }
    this.changed();
  },
  async toggleCam(force) {
    const on = typeof force === 'boolean' ? force : !this.media.cam;
    if (on && !this.isSpeaker(this.me.id)) { toast('You’re in the audience — request to speak first', { icon: 'stage', group: 'engage' }); return; }
    if (on && !this.perm('camera') && !this.isMod()) { toast('The host has disabled cameras', { icon: 'videoOff' }); return; }
    try { await this.media.setCam(on); } catch (e) { toastErr(e); }
    this.changed();
  },
  async toggleShare(force) {
    const on = typeof force === 'boolean' ? force : !this.media.sharing;
    if (on && !this.perm('screenShare') && !this.isMod()) { toast('Screen sharing is off for participants', { icon: 'screenOff' }); return; }
    if (on && !navigator.mediaDevices?.getDisplayMedia) { toast('Screen sharing isn’t supported on this device', { icon: 'alert' }); return; }
    try {
      await this.media.setShare(on, lsGet('venue.shareQuality', 'auto'));
      this.send(on ? 'start-share' : 'stop-share', {});
    } catch (e) { if (e && e.name !== 'NotAllowedError') toastErr(e); }
    this.changed();
  },
  requestStage() { promptDlg('Want to speak? Add a short note for the host (optional).', { placeholder: 'e.g. A question about the budget', ok: 'Request' }).then((note) => { if (note === null) return; this.send('stage-request', { note }); toast('Request sent — you’ll be notified when it’s your turn', { icon: 'hand', group: 'engage' }); }); },
  raiseHand() {
    if (this.stage.enabled && !this.isSpeaker(this.me.id)) { const mine = (this.stage.requests || []).some((q) => q.id === this.me.id); if (mine) this.send('stage-cancel', {}); else this.requestStage(); return; }
    const up = this.meP()?.handRaised; this.send(up ? 'lower-hand' : 'raise-hand', {});
  },
  react(emoji) {
    if (this.security.reactions === false && !this.isMod()) return toast('Reactions are off', { icon: 'smile' });
    this.send('reaction', { emoji });
    if (emoji !== this.lastEmoji()) { lsSet('venue.react.last', emoji); pushRecent(emoji); refreshBar(); }
  },
  lastEmoji() { return lsGet('venue.react.last', '👏'); },
  reactMenu() {
    const EM = [...new Set([this.lastEmoji(), ...QUICK])].slice(0, 10);
    const s = sheet({ title: 'React', icon: 'smile', group: 'engage' });
    const box = h('div', { class: 'react-pop' }, EM.map((e) => h('button', { type: 'button', class: 'react-b', 'aria-label': emojiName(e), onclick: () => { this.react(e); } }, e)));
    const more = h('button', { class: 'btn sm block', type: 'button', html: icon('search', { size: 16 }) + '<span>Search all emoji</span>' });
    more.onclick = () => emojiPopover(more, (e) => this.react(e), { keepOpen: true });
    s.body.append(box, more);
  },
  playRoomSound(id) {
    if (this.security.sounds === false && !this.isMod()) return toast('The host has turned off sounds', { icon: 'volumeX' });
    this.send('sound', { id });
  },
});

/* ======================================================================= chrome, commands, lifecycle */
Object.assign(Room.prototype, {
  buildUi() {
    this.headEl = h('header', { class: 'room-head' });
    this.peekHost = h('div', { class: 'peeks', 'aria-live': 'polite' });
    this.netEl = h('div', { class: 'net-banner', hidden: true });
    this.main = h('div', { class: 'room-main' }, this.stageR.el, this.panel.el);
    this.root = h('div', { class: 'room', 'data-layout': this.layout }, h('div', { class: 'room-art', 'aria-hidden': 'true' }), this.headEl, this.netEl, this.main, this.peekHost);
    this.view.replaceChildren(this.root);
    this.paintHead(true); this.renderStage(true);
    if (this.netNote) this.netBanner(true, this.netNote, true);
  },
  paintHead(full) {
    if (!this.headEl || !this.alive) return;
    const secs = Math.floor((Date.now() - this.startedAt) / 1000);
    const tstr = `${Math.floor(secs / 3600) ? Math.floor(secs / 3600) + ':' : ''}${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    if (!full && this.headEl.firstChild) {
      const t = this.headEl.querySelector('.rh-timer'); if (t) t.textContent = tstr;
      const rec = this.recorder.state !== 'idle' || (this.recording && this.recording.status && this.recording.status !== 'stopped');
      this.headEl.querySelector('.rh-rec').hidden = !rec;
      this.headEl.querySelector('.rh-count').textContent = this.peopleMap.size;
      this.headEl.querySelector('.rh-cap').hidden = !this.captioner.on && !this.transcribe;
      this.headEl.querySelector('.rh-lock').hidden = !this.security.locked;
      this.headEl.querySelectorAll('[data-lay]').forEach((b) => b.classList.toggle('on', b.dataset.lay === this.layout));
      this.root.dataset.layout = this.layout;
      return;
    }
    const lay = (l, ic, tip) => h('button', { class: 'seg-b', 'data-lay': l, 'data-group': 'media', 'data-tip': tip, type: 'button', onclick: () => this.setLayout(l), html: icon(ic, { size: 16 }) });
    this.headEl.replaceChildren(
      h('a', { class: 'rh-logo', href: '/', 'aria-label': '1venue home', onclick: (e) => { e.preventDefault(); this.leave(); }, html: LOGO(26) }),
      h('div', { class: 'rh-title' }, h('b', { class: 'ellipsis' }, this.roomName), h('div', { class: 'tiny muted row gap-xs' }, h('span', { class: 'rh-timer' }, tstr), '·', h('button', { class: 'linkish', type: 'button', 'data-tip': 'Copy room code', 'data-group': 'people', onclick: () => copy(location.origin + '/' + fmtCode(this.code)).then(() => toast('Link copied', { icon: 'link' })) }, fmtCode(this.code)))),
      h('span', { class: 'pill rec rh-rec', hidden: true }, h('i', { class: 'rec-dot' }), 'REC'),
      h('span', { class: 'pill rh-cap', 'data-group': 'content', hidden: true, html: icon('captions', { size: 13 }) + 'CC' }),
      h('span', { class: 'pill rh-lock', 'data-group': 'admin', hidden: true, html: icon('lock', { size: 13 }) }),
      h('div', { class: 'grow' }),
      h('div', { class: 'seg rh-lay hide-sm' }, lay('grid', 'grid', 'Grid'), lay('spotlight', 'spotlight', 'Spotlight'), lay('speaker', 'speaker', 'Speaker')),
      h('button', { class: 'pill rh-people', 'data-group': 'people', 'data-tip': 'People', type: 'button', onclick: () => this.panel.toggle('people'), html: icon('users', { size: 14 }) + '<span class="rh-count"></span>' }),
      ibtn('userPlus', 'Invite', () => this.invite(), { group: 'people', cls: 'hide-xs' }),
      ibtn('pip', 'Picture-in-picture', () => this.pip(), { group: 'media', cls: 'hide-xs' }),
      ibtn('phoneOff', 'Leave', () => this.leaveMenu(), { group: 'danger', cls: 'danger' }));
    this.paintHead();
  },
  netBanner(on, text = 'Reconnecting…', sticky = false) {
    if (!this.netEl) return;
    this.netEl.hidden = !on; if (on) this.netEl.replaceChildren(h('span', { html: icon(sticky ? 'info' : 'wifi', { size: 15 }) }), h('span', null, text), sticky ? h('button', { class: 'linkish', onclick: () => { this.netEl.hidden = true; } }, 'Dismiss') : h('span', { class: 'dots-loader sm' }, h('i'), h('i'), h('i')));
  },
  peek(title, text, onClick) {
    if (!this.peekHost) return;
    const el = h('button', { class: 'peek', type: 'button', onclick: () => { el.remove(); onClick ? onClick() : this.panel.open('chat'); } }, h('b', null, title), h('span', { class: 'ellipsis' }, String(text).slice(0, 120)));
    this.peekHost.append(el); while (this.peekHost.children.length > 2) this.peekHost.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
  },
  ring(from) {
    if (this.ringEl) return;
    let n = 0; const tone = setInterval(() => { chime(n++ % 2 ? 660 : 880, 0.18); if (n > 10) stop(); }, 700);
    const stop = () => { clearInterval(tone); this.ringEl && this.ringEl.remove(); this.ringEl = null; };
    this.ringEl = h('div', { class: 'ring-overlay', onclick: stop }, h('div', { class: 'ring-card' }, h('span', { class: 'ring-ico', html: icon('bellRing', { size: 34 }) }), h('b', null, `${from || 'The host'} is calling you`), h('button', { class: 'btn primary', onclick: stop }, 'I’m here')));
    this.root.append(this.ringEl); navigator.vibrate && navigator.vibrate([200, 100, 200]);
  },
  invite() {
    const link = location.origin + '/' + fmtCode(this.code) + (this.inviteKey && this.security.requireInviteKey ? '?key=' + this.inviteKey : '');
    const dark = document.documentElement.dataset.theme === 'dark';
    const qr = `/api/qr.svg?text=${encodeURIComponent(link)}&title=${encodeURIComponent(this.roomName)}&subtitle=${encodeURIComponent(fmtCode(this.code))}${dark ? '&dark=1' : ''}`;
    const s = sheet({ title: 'Invite people', icon: 'userPlus', group: 'people' });
    const share = navigator.share ? h('button', { class: 'btn', 'data-group': 'social', onclick: () => navigator.share({ title: this.roomName, text: `Join me on 1venue: ${this.roomName}`, url: link }).catch(() => {}), html: icon('share', { size: 16 }) + 'Share' }) : null;
    s.body.append(h('div', { class: 'stack' },
      h('div', { class: 'invite-link' }, h('input', { class: 'input', readonly: true, value: link, onclick: (e) => e.target.select() }), h('button', { class: 'btn primary', 'data-group': 'people', onclick: () => copy(link).then(() => toast('Invite link copied', { icon: 'check' })), html: icon('copy', { size: 16 }) + 'Copy' })),
      h('div', { class: 'qr-wrap' }, h('img', { src: qr, alt: 'Room QR code', style: { width: '100%', maxWidth: '300px' } })),
      h('div', { class: 'row gap-s center wrap' }, share, h('a', { class: 'btn', href: qr + '&download=1', download: `1venue-${this.code}.svg`, html: icon('download', { size: 16 }) + 'QR' }),
        h('button', { class: 'btn', 'data-group': 'content', onclick: () => import('../pages/event.js').then((m) => m.qrMaker(link)), html: icon('palette', { size: 16 }) + 'Customise QR' }),
        this.isMod() ? h('button', { class: 'btn', 'data-group': 'people', onclick: () => { this.send('ring-all', {}); toast('Ringing everyone', { icon: 'bellRing' }); }, html: icon('bellRing', { size: 16 }) + 'Ring all' }) : null),
      h('p', { class: 'tiny muted center' }, `Room code ${fmtCode(this.code)} — anyone can type it in the search bar to join.`)));
  },
  async deviceSheet(after) {
    const s = sheet({ title: 'Audio & video devices', icon: 'headphones', group: 'media' });
    const list = await listDevices().catch(() => ({}));
    const prefs = devicePrefs();
    const sel = (kind, label, items) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('select', { class: 'input', onchange: async (e) => { if (kind === 'audiooutput') { lsSet('venue.speaker', e.target.value); this.audioEls && this.audioEls.forEach((a) => a.setSinkId && a.setSinkId(e.target.value).catch(() => {})); } try { await this.media?.switchDevice(kind, e.target.value); } catch (err) { toastErr(err); } after && after(); } },
      (items || []).map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === (kind === 'audiooutput' ? lsGet('venue.speaker', '') : prefs[kind]) }, d.label || `${label} ${i + 1}`))));
    s.body.append(h('div', { class: 'stack' }, sel('audioinput', 'Microphone', list.audioinput), sel('videoinput', 'Camera', list.videoinput), list.audiooutput && list.audiooutput.length ? sel('audiooutput', 'Speaker', list.audiooutput) : null,
      h('label', { class: 'switch-row' }, h('span', { class: 'grow' }, 'Mirror my camera'), h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: this.mirror, onchange: (e) => { this.mirror = e.target.checked; lsSet('venue.mirror', this.mirror); this.stageR?.paintAll(); } }), h('span'))),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Screen share quality'), h('select', { class: 'input', onchange: (e) => lsSet('venue.shareQuality', e.target.value) }, [['auto', 'Auto (balanced)'], ['text', 'Sharp text & slides'], ['motion', 'Smooth video']].map(([v, l]) => h('option', { value: v, selected: lsGet('venue.shareQuality', 'auto') === v }, l))))));
  },
  async pip() {
    if (window.documentPictureInPicture) {
      try {
        if (this.pipWin) { this.pipWin.close(); return; }
        const w = await documentPictureInPicture.requestWindow({ width: 380, height: 300 });
        this.pipWin = w;
        [...document.styleSheets].forEach((ss) => { try { const st = w.document.createElement('style'); st.textContent = [...ss.cssRules].map((r) => r.cssText).join('\n'); w.document.head.append(st); } catch { const l = w.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; w.document.head.append(l); } });
        w.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
        w.document.body.className = 'pip-body';
        const stageEl = this.stageR.el; const ph = h('div', { class: 'pip-placeholder' }, h('span', { html: icon('pip', { size: 28 }) }), 'Playing in picture-in-picture', h('button', { class: 'btn sm', onclick: () => w.close() }, 'Bring back'));
        stageEl.replaceWith(ph);
        const mini = w.document.createElement('div'); mini.className = 'pip-dock';
        const mk = (ic, fn, on) => { const b = w.document.createElement('button'); b.className = 'icon-btn' + (on() ? '' : ' off'); b.innerHTML = icon(ic(), { size: 18 }); b.onclick = async () => { await fn(); b.innerHTML = icon(ic(), { size: 18 }); b.className = 'icon-btn' + (on() ? '' : ' off'); }; return b; };
        mini.append(mk(() => (this.media.mic ? 'mic' : 'micOff'), () => this.toggleMic(), () => this.media.mic), mk(() => (this.media.cam ? 'video' : 'videoOff'), () => this.toggleCam(), () => this.media.cam), mk(() => 'hand', () => this.raiseHand(), () => true), mk(() => 'phoneOff', () => { w.close(); this.leave(); }, () => true));
        w.document.body.append(stageEl, mini);
        w.addEventListener('pagehide', () => { ph.replaceWith(stageEl); this.pipWin = null; this.renderStage(true); });
        return;
      } catch (e) { console.warn('docPiP', e); }
    }
    const v = [...this.stageR.el.querySelectorAll('video')].find((x) => x.srcObject && x.readyState >= 2 && !x.closest('.tile[data-id="' + this.me.id + '"]')) || this.stageR.el.querySelector('video');
    if (!v || !document.pictureInPictureEnabled) return toast('Picture-in-picture needs someone’s video on screen', { icon: 'pip' });
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); } catch (e) { toastErr(e); }
  },
  /* boards / timeline / breakouts */
  openMyBoard() { this.stageView = this.stageView === 'my-board' ? null : 'my-board'; this.renderStage(true); refreshBar(); },
  openTeamBoard() { this.stageView = this.stageView === 'team-board' ? null : 'team-board'; this.renderStage(true); refreshBar(); },
  viewBoard(ownerId) { this.send('pboard-view', { ownerId }); this.stageView = 'pboard:' + ownerId; this.renderStage(true); this.panel.isOpen() && this.isMobile && this.panel.close(); },
  shareBoard(on) { this.boardSharing = on; this.send('pboard-share', { on }); if (on) this.send('pboard-frame', this.boardFrame()); toast(on ? 'Your board is now viewable by others' : 'Board is private again', { icon: on ? 'eye' : 'eyeOff', group: 'content' }); this.panel.refresh(); },
  snapshotToTimeline() {
    const v = this.stageR.el.querySelector('.tile.screen video') || this.stageR.el.querySelector('.present video') || [...this.stageR.el.querySelectorAll('.tile video')].find((x) => x.srcObject);
    let canvas;
    if (v && v.videoWidth) { const sc = Math.min(1, 1280 / v.videoWidth); canvas = h('canvas', { width: Math.round(v.videoWidth * sc), height: Math.round(v.videoHeight * sc) }); canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height); }
    else { const c = this.stageR.el.querySelector('.present canvas'); if (c) { const sc = Math.min(1, 1280 / c.width); canvas = h('canvas', { width: Math.round(c.width * sc), height: Math.round(c.height * sc) }); const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.drawImage(c, 0, 0, canvas.width, canvas.height); } }
    if (!canvas) return toast('Nothing visual to snapshot yet — share a screen or open a board', { icon: 'camera' });
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    this.send('screen-timeline-add', { item: { dataUrl, title: (this.content?.title || 'Snapshot') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } });
    toast('Added to the timeline', { icon: 'timeline', group: 'content' });
  },
  async joinBreakout(room) { this.breakoutRoom = room ? (room.livekitRoom || room.id) : null; this.root.dataset.breakout = room ? room.name : ''; await this.reconnectMedia(true); toast(room ? `You’re in ${room.name}` : 'Main room', { icon: 'split', group: 'people' }); },
  /* leaving */
  leaveMenu() {
    if (!this.isMod() || this.me.role !== 'host') return this.leave();
    const s = sheet({ title: 'Leave the room?', icon: 'phoneOff', group: 'danger' });
    s.body.append(h('div', { class: 'stack' }, h('button', { class: 'btn block', onclick: () => { s.close(); this.leave(); }, html: icon('logout', { size: 16 }) + 'Leave (room stays open)' }),
      h('button', { class: 'btn danger block', onclick: () => { s.close(); this.endForAll(); }, html: icon('phoneOff', { size: 16 }) + 'End for everyone' })));
  },
  async endForAll() { if (await confirmDlg('End the session for everyone? Transcripts and summaries will be saved.', { ok: 'End session', danger: true })) this.send('end-meeting', {}); },
  async leave() {
    if (this.recorder.state !== 'idle') { this.recorder.stop(); await new Promise((r) => setTimeout(r, 600)); }
    api('/api/leave', { method: 'POST', body: { code: this.code, participantId: this.me.id } }).catch(() => {});
    const s = roomsStore(); delete s[this.code]; localStorage.setItem('venue.rooms', JSON.stringify(s));
    this.destroy(); navigate(state.user ? '/dashboard' : '/'); setTimeout(() => maybeShowBanner('after-room'), 1200);
  },
  ended(m) {
    if (this.recorder.state !== 'idle') this.recorder.stop();
    const s = roomsStore(); delete s[this.code]; localStorage.setItem('venue.rooms', JSON.stringify(s));
    this.destroy();
    toast('The session has ended', { icon: 'phoneOff', ms: 4000 });
    navigate(m.historyId ? '/session/' + m.historyId : m.eventSlug ? '/e/' + m.eventSlug : '/'); setTimeout(() => maybeShowBanner('after-room'), 1500);
  },
  kicked(m) {
    this.destroy();
    this.view.replaceChildren(h('div', { class: 'waiting' }, h('span', { class: 'ico-tile lg', 'data-group': 'danger', html: icon('userX', { size: 30 }) }), h('h2', null, 'You were removed from the room'), h('p', { class: 'muted' }, m.byName ? `Removed by ${m.byName}` : ''), h('a', { class: 'btn primary', href: '/' }, 'Back home')));
  },
  destroy() {
    if (!this.alive) return; this.alive = false;
    this.cleanupPrejoin && this.cleanupPrejoin();
    clearInterval(this.tick); window.removeEventListener('keydown', this.onKey); window.removeEventListener('pagehide', this.onUnload); window.removeEventListener('resize', this.onResize);
    try { this.ws && this.ws.close(); } catch { /* */ }
    this.captioner && this.captioner.stop(); this.media && this.media.disconnect().catch(() => {});
    this.pipWin && this.pipWin.close();
    unregisterCommands('room');
  },
  /* keyboard */
  shortcut(e) {
    const tag = document.activeElement?.tagName; if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.activeElement?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const map = { m: () => this.toggleMic(), v: () => this.toggleCam(), s: () => this.toggleShare(), h: () => this.raiseHand(), c: () => this.panel.toggle('chat'), p: () => this.panel.toggle('people'), e: () => this.panel.toggle('engage'), t: () => this.panel.toggle('tools'), g: () => this.cycleLayout(1), f: () => this.fullscreen(), i: () => this.invite() };
    if (map[k]) { e.preventDefault(); map[k](); }
  },
  fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else this.root.requestFullscreen && this.root.requestFullscreen().catch(() => {}); },
});

/* ======================================================================= the footer bar = the dock */
Object.assign(Room.prototype, {
  registerCmds() {
    const R = this;
    const mod = () => R.isMod(), host = () => R.me.role === 'host';
    const tool = (id) => () => R.panel.open('tools', id);
    const cmds = [
      { id: 'r-mic', label: 'Microphone on/off', short: () => (R.media.mic ? 'Mute' : 'Unmute'), icon: () => (R.media.mic ? 'mic' : 'micOff'), group: 'media', kbd: 'M', active: () => R.media.mic, keywords: 'mute unmute audio voice talk sound', run: () => R.toggleMic() },
      { id: 'r-cam', label: 'Camera on/off', short: () => (R.media.cam ? 'Stop video' : 'Video'), icon: () => (R.media.cam ? 'video' : 'videoOff'), group: 'media', kbd: 'V', active: () => R.media.cam, keywords: 'camera webcam face video', run: () => R.toggleCam() },
      { id: 'r-share', label: 'Share screen', short: () => (R.media.sharing ? 'Stop share' : 'Share'), icon: () => (R.media.sharing ? 'screenOff' : 'screen'), group: 'media', kbd: 'S', active: () => R.media.sharing, keywords: 'present screen share display slides', when: () => !R.stage.enabled || R.isSpeaker(R.me.id), run: () => R.toggleShare() },
      { id: 'r-hand', label: 'Raise hand / request to speak', short: () => (R.stage.enabled && !R.isSpeaker(R.me.id) ? ((R.stage.requests || []).some((q) => q.id === R.me.id) ? 'Queued' : 'Ask to speak') : R.meP()?.handRaised ? 'Lower' : 'Hand'), icon: () => (R.stage.enabled && !R.isSpeaker(R.me.id) ? 'stage' : 'hand'), group: 'engage', kbd: 'H', active: () => !!R.meP()?.handRaised || (R.stage.requests || []).some((q) => q.id === R.me.id), keywords: 'raise hand question speak stage queue mic request', run: () => R.raiseHand() },
      { id: 'r-react', label: 'React', short: 'React', icon: 'smile', group: 'engage', keywords: 'emoji reaction clap love like', run: () => R.reactMenu() },
      { id: 'r-again', label: () => `Send ${R.lastEmoji()} again`, tip: () => `Send ${R.lastEmoji()} again`, short: 'Again', glyph: () => R.lastEmoji(), group: 'engage', keywords: 'emoji again repeat last reaction', run: () => R.react(R.lastEmoji()) },
      { id: 'r-chat', label: 'Chat', short: () => 'Chat' + (R.unread.chat + R.unread.dm ? ` ·${R.unread.chat + R.unread.dm}` : ''), icon: 'chat', group: 'social', kbd: 'C', active: () => R.panel.tab === 'chat', keywords: 'message talk dm private group', run: () => R.panel.toggle('chat') },
      { id: 'r-people', label: 'People', short: () => `People ${R.peopleMap.size}`, icon: 'users', group: 'people', kbd: 'P', active: () => R.panel.tab === 'people', keywords: 'participants attendees roster waiting audience speakers', run: () => R.panel.toggle('people') },
      { id: 'r-engage', label: 'Polls, Q&A & comments', short: () => 'Engage' + (R.unread.engage ? ` ·${R.unread.engage}` : ''), icon: 'poll', group: 'engage', kbd: 'E', active: () => R.panel.tab === 'engage', keywords: 'engage engagement poll vote question qa comments feed', run: () => R.panel.toggle('engage') },
      { id: 'r-tools', label: 'Tools', short: 'Tools', icon: 'wand', group: 'content', kbd: 'T', active: () => R.panel.tab === 'tools', keywords: 'tools bible scripture captions ai board record more', run: () => R.panel.toggle('tools') },
      { id: 'r-layout', label: 'Change layout', short: () => ({ grid: 'Grid', spotlight: 'Spotlight', speaker: 'Speaker' }[R.layout]), icon: () => ({ grid: 'grid', spotlight: 'spotlight', speaker: 'speaker' }[R.layout]), group: 'media', kbd: 'G', keywords: 'view layout grid spotlight speaker gallery tiles', run: () => R.cycleLayout(1) },
      { id: 'r-more', label: 'More', short: 'More', icon: 'more', group: 'nav', keywords: 'more menu options', run: () => R.moreMenu() },
      { id: 'r-leave', label: 'Leave room', short: 'Leave', icon: 'phoneOff', group: 'danger', keywords: 'leave exit hang up quit end', run: () => R.leaveMenu() },
      // searchable
      { id: 'r-grid', label: 'Grid view', icon: 'grid', group: 'media', keywords: 'gallery tiles everyone', run: () => R.setLayout('grid') },
      { id: 'r-spot', label: 'Spotlight view', icon: 'spotlight', group: 'media', keywords: 'focus big pin', run: () => R.setLayout('spotlight') },
      { id: 'r-speaker', label: 'Speaker view', icon: 'speaker', group: 'media', keywords: 'active speaker talking', run: () => R.setLayout('speaker') },
      { id: 'r-captions', label: 'Live captions & transcript', icon: 'captions', group: 'content', keywords: 'subtitles cc transcript speech text stt transcription yoruba igbo hausa pidgin', run: () => { if (!R.captioner.on) R.captioner.start(); R.panel.open('tools', 'captions'); } },
      { id: 'r-cc-toggle', label: 'Show/hide captions overlay', icon: 'captions', group: 'content', keywords: 'subtitles hide show', run: () => R.setShowCaptions(!R.showCaptions) },
      { id: 'r-record', label: 'Record on this device', icon: 'record', group: 'media', keywords: 'record recording save video audio capture', run: tool('record') },
      { id: 'r-pip', label: 'Picture-in-picture', icon: 'pip', group: 'media', keywords: 'pip float mini window popout', run: () => R.pip() },
      { id: 'r-invite', label: 'Invite people / QR code', icon: 'qr', group: 'people', kbd: 'I', keywords: 'invite link share qr code add people', run: () => R.invite() },
      { id: 'r-copy', label: 'Copy room link', icon: 'link', group: 'people', keywords: 'copy link url code', run: () => copy(location.origin + '/' + fmtCode(R.code)).then(() => toast('Link copied', { icon: 'link' })) },
      { id: 'r-bible', label: 'Bible & scripture', icon: 'bookOpen', group: 'faith', keywords: 'bible scripture verse kjv web passage sermon john psalm', run: tool('scripture') },
      { id: 'r-poll', label: 'Create a poll', icon: 'poll', group: 'engage', keywords: 'poll vote survey', run: () => R.panel.open('engage', 'polls') },
      { id: 'r-qa', label: 'Q&A', icon: 'question', group: 'engage', keywords: 'questions ask qa', run: () => R.panel.open('engage', 'qa') },
      { id: 'r-comments', label: 'Comments', icon: 'chats', group: 'social', keywords: 'comments feed social reply like', run: () => R.panel.open('engage', 'comments') },
      { id: 'r-myboard', label: 'My whiteboard', icon: 'pen', group: 'content', active: () => R.stageView === 'my-board', keywords: 'whiteboard draw sketch personal board notes', run: () => R.openMyBoard() },
      { id: 'r-teamboard', label: 'Team whiteboard', icon: 'board', group: 'content', active: () => R.stageView === 'team-board', keywords: 'shared whiteboard collaborate draw', run: () => R.openTeamBoard() },
      { id: 'r-boards', label: 'Shared boards', icon: 'eye', group: 'content', keywords: 'view boards others', run: tool('boards') },
      { id: 'r-present', label: 'Present YouTube, slides or an image', icon: 'presentation', group: 'content', keywords: 'present pdf slides youtube watch together image file deck', run: tool('present') },
      { id: 'r-timeline', label: 'Screen timeline', icon: 'timeline', group: 'content', keywords: 'timeline snapshots slides history slideshow', run: tool('timeline') },
      { id: 'r-snap', label: 'Snapshot to timeline', icon: 'camera', group: 'content', keywords: 'screenshot capture snapshot', run: () => R.snapshotToTimeline() },
      { id: 'r-sounds', label: 'Sounds: applause, drum roll, suspense…', icon: 'music', group: 'engage', keywords: 'sounds sound effects sfx applause clap drum roll suspense laugh cheers ding boo crickets tada', run: tool('sounds') },
      { id: 'r-ai', label: 'AI assistant', icon: 'sparkles', group: 'ai', keywords: 'ai ask summary catch up translate assistant gpt', run: tool('ai') },
      { id: 'r-catchup', label: 'AI catch-up: what did I miss?', icon: 'sparkles', group: 'ai', keywords: 'summary recap missed catch up', run: () => R.panel.open('tools', 'ai') },
      { id: 'r-devices', label: 'Audio & video devices', icon: 'headphones', group: 'media', keywords: 'microphone camera speaker device settings input output', run: () => R.deviceSheet() },
      { id: 'r-full', label: 'Full screen', icon: 'maximize', group: 'media', kbd: 'F', keywords: 'fullscreen maximize', run: () => R.fullscreen() },
      { id: 'r-diag', label: 'Connection diagnostics', icon: 'activity', group: 'settings', keywords: 'network quality stats bitrate diagnostics lag', run: tool('diagnostics') },
      { id: 'r-keys', label: 'Keyboard shortcuts', icon: 'keyboard', group: 'settings', keywords: 'shortcuts keys hotkeys', run: tool('shortcuts') },
      { id: 'r-theme', label: 'Toggle dark/light theme', icon: 'moon', group: 'settings', keywords: 'theme dark light mode', run: () => toggleTheme() },
      { id: 'r-activity', label: 'Activity log', icon: 'history', group: 'admin', keywords: 'activity log history events', run: tool('activity') },
      { id: 'r-lock', label: 'Lock / unlock room', icon: () => (R.security.locked ? 'unlock' : 'lock'), group: 'admin', when: mod, keywords: 'lock unlock security', run: () => R.send(R.security.locked ? 'unlock-meeting' : 'lock-meeting', {}) },
      { id: 'r-muteall', label: 'Mute everyone', icon: 'micOff', group: 'admin', when: mod, keywords: 'mute all silence', run: () => R.send('mute-all', {}) },
      { id: 'r-lowerall', label: 'Lower all hands', icon: 'hand', group: 'admin', when: mod, keywords: 'hands clear lower', run: () => R.send('lower-all-hands', {}) },
      { id: 'r-admitall', label: 'Admit everyone waiting', icon: 'userCheck', group: 'admin', when: () => mod() && R.waiting.length > 0, keywords: 'admit waiting lobby', run: () => R.send('admit-all', {}) },
      { id: 'r-security', label: 'Security & permissions', icon: 'shield', group: 'admin', when: mod, keywords: 'security permissions waiting room guests chat lock invite key', run: tool('security') },
      { id: 'r-stagecfg', label: 'Stage & speaker seats', icon: 'stage', group: 'engage', when: mod, keywords: 'stage speakers seats audience webinar', run: () => R.panel.open('people') },
      { id: 'r-breakouts', label: 'Breakout rooms', icon: 'split', group: 'people', keywords: 'breakout groups rooms split', run: tool('breakouts') },
      { id: 'r-ringall', label: 'Ring everyone', icon: 'bellRing', group: 'people', when: mod, keywords: 'ring call notify alert', run: () => R.send('ring-all', {}) },
      { id: 'r-transcript', label: 'Save transcript for summary', icon: 'fileText', group: 'content', when: mod, active: () => R.transcribe, keywords: 'transcript save summary minutes notes', run: () => R.send('transcript-toggle', { on: !R.transcribe }) },
      { id: 'r-end', label: 'End session for everyone', icon: 'phoneOff', group: 'danger', when: host, keywords: 'end close finish stop meeting', run: () => R.endForAll() },
    ];
    registerCommands('room', cmds);
    const by = (id) => cmds.find((c) => c.id === id);
    setBarContext({
      placeholders: ['Type: mute, share, poll, John 3:16…', 'Try “captions”', 'Try “my whiteboard”', 'Try “invite”', 'Try “what did I miss”'],
      pinned: () => ['r-mic', 'r-cam', 'r-share', 'r-hand', 'r-react', 'r-again', 'r-chat', 'r-people', 'r-engage', 'r-tools', 'r-layout', 'r-more', 'r-leave'].map(by),
      dynamic: (q) => {
        const out = [];
        const em = q.match(/^(\p{Extended_Pictographic}\uFE0F?)$/u); if (em) out.push({ id: 'dyn-react', label: 'React ' + em[1], glyph: em[1], short: 'React', group: 'engage', run: () => R.react(em[1]) });
        searchSounds(q).forEach((sd) => out.push({ id: 'dyn-snd-' + sd.id, label: `Play ${sd.label} for everyone`, short: sd.label, glyph: sd.emoji, group: 'engage', run: () => R.playRoomSound(sd.id) }));
        if (q.trim().length >= 3 && !/\s/.test(q.trim())) searchEmoji(q.trim(), 4).forEach((e) => out.push({ id: 'dyn-em-' + e, label: `React ${e} (${emojiName(e)})`, short: emojiName(e).split(' ')[0], glyph: e, group: 'engage', run: () => R.react(e) }));
        if (/^[1-3]?\s?[a-z]+\.?\s+\d+(:\d+(-\d+)?)?$/i.test(q.trim())) out.push({ id: 'dyn-scr', label: `Scripture: ${q.trim()}`, short: q.trim(), icon: 'bookOpen', group: 'faith', run: () => { R.scriptureDraft = q.trim(); R.panel.open('tools', 'scripture'); } });
        const pp = R.people().filter((p) => p.id !== R.me.id && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3);
        pp.forEach((p) => out.push({ id: 'dyn-p' + p.id, label: `Message ${p.name}`, short: p.name, icon: 'user', group: 'people', tail: true, run: () => { R.panel.sub.chat = 'dm'; R.dmWith = p.id; R.focusNext = true; R.panel.open('chat'); } }));
        if (q.trim().length > 2) out.push({ id: 'dyn-say', label: `Send “${q.trim().slice(0, 20)}” to chat`, short: 'Send to chat', icon: 'send', group: 'social', tail: true, run: () => R.send('chat', { text: q.trim() }) });
        return out;
      },
      fallback: (q) => R.send('chat', { text: q }),
    });
  },
  moreMenu() {
    const R = this;
    const s = sheet({ title: 'More', icon: 'more' });
    const it = (ic, label, g, run) => h('button', { class: 'tool-card', 'data-group': g, type: 'button', onclick: () => { s.close(); run(); } }, h('span', { class: 'ico-tile', 'data-group': g, html: icon(ic, { size: 20 }) }), h('b', null, label));
    s.body.append(h('div', { class: 'tool-grid' },
      it('captions', R.captioner.on ? 'Stop captions' : 'Captions', 'content', () => (R.captioner.on ? R.captioner.stop() : R.captioner.start(), R.changed())),
      it('record', 'Record', 'media', () => R.panel.open('tools', 'record')),
      it('pip', 'Mini window', 'media', () => R.pip()),
      it('qr', 'Invite & QR', 'people', () => R.invite()),
      it('pen', 'My board', 'content', () => R.openMyBoard()),
      it('board', 'Team board', 'content', () => R.openTeamBoard()),
      it('bookOpen', 'Bible', 'faith', () => R.panel.open('tools', 'scripture')),
      it('sparkles', 'AI assistant', 'ai', () => R.panel.open('tools', 'ai')),
      it('presentation', 'Present', 'content', () => R.panel.open('tools', 'present')),
      it('timeline', 'Timeline', 'content', () => R.panel.open('tools', 'timeline')),
      it('split', 'Breakouts', 'people', () => R.panel.open('tools', 'breakouts')),
      it('headphones', 'Devices', 'media', () => R.deviceSheet()),
      it('maximize', 'Full screen', 'media', () => R.fullscreen()),
      it('activity', 'Diagnostics', 'settings', () => R.panel.open('tools', 'diagnostics')),
      R.isMod() ? it('shield', 'Security', 'admin', () => R.panel.open('tools', 'security')) : null,
      R.me.role === 'host' ? it('phoneOff', 'End for all', 'danger', () => R.endForAll()) : null));
  },
});
