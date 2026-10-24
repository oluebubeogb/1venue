// Tool views for the room panel (rendered inside panels.js → Tools).
import { h, esc, api, toast, toastErr, copy, download, md, uploadFile, timeAgo, debounce, fmtDur } from '../ui.js';
import { state } from '../app.js';
import { icon } from '../icons.js';
import { translationSelect, versesEl, refLabel } from '../pages/bible.js';
import { createBoard, boardToolbar } from '../pages/whiteboard.js';
import { SpeechRec } from './captions.js';
import { SOUNDS, playSound, soundsMuted, setSoundsMuted } from './sounds.js';
import { ytId } from './youtube.js';

const btn = (ic, label, run, { group = '', cls = '', disabled } = {}) => h('button', { class: `btn ${cls}`, 'data-group': group, type: 'button', disabled: !!disabled, onclick: run, html: icon(ic, { size: 16 }) + (label ? `<span>${esc(label)}</span>` : '') });

// Content sharing helpers live at module level: the panel re-renders often, so the file input and progress must survive it.
let presentBusy = '';
const startContent = (R, payload) => { R.send('content-start', payload); toast('Presenting to everyone', { icon: 'presentation', group: 'content' }); };
let contentInput = null;
function pickContentFile(R) {
  if (!contentInput) { contentInput = h('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true }); document.body.append(contentInput); }
  contentInput.onchange = () => { const f = contentInput.files[0]; contentInput.value = ''; if (f) shareContentFile(R, f); };
  contentInput.click();
}
export async function shareContentFile(R, f) {
  const setBusy = (t) => { presentBusy = t || ''; R.panel.refresh('tools'); };
  const name = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
  try {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      setBusy('Preparing slides…');
      const { pdfToImages } = await import('./pdfslides.js');
      const { files, total, truncated } = await pdfToImages(f, { onProgress: (i, n) => setBusy(`Rendering page ${i} of ${n}…`) });
      const pages = [];
      for (let i = 0; i < files.length; i++) { setBusy(`Uploading page ${i + 1} of ${files.length}…`); pages.push((await uploadFile(files[i], { purpose: 'content', headers: R.headers() })).url); }
      startContent(R, { contentType: 'slides', pages, title: name || 'Slides', fileMeta: { name: f.name, size: f.size, mime: f.type } });
      if (truncated) toast(`Only the first ${files.length} of ${total} pages were shared`, { icon: 'alert' });
    } else if (f.type.startsWith('image/')) {
      setBusy('Uploading…');
      const r = await uploadFile(f, { purpose: 'content', headers: R.headers() });
      startContent(R, { contentType: 'image', url: r.url, title: name || 'Image', fileMeta: { name: f.name, size: f.size, mime: f.type } });
    } else toast('Pick a PDF or an image', { icon: 'alert' });
  } catch (e) { toastErr(e); } finally { setBusy(''); }
}
const sw = (checked, onchange, disabled) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (e) => onchange(e.target.checked) }), h('span'));
const row = (ic, label, sub, ctl) => h('label', { class: 'set-row' }, h('span', { class: 'ico', html: icon(ic, { size: 18 }) }), h('span', { class: 'grow' }, h('b', null, label), sub ? h('small', { class: 'muted block' }, sub) : null), ctl);
const lsGetRaw = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSetRaw = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const note = (t) => h('p', { class: 'tiny muted', style: { margin: '.4rem 0' } }, t);

export function buildTools(R) {
  return {
    scripture() {
      const box = h('div', { class: 'stack' });
      const canShow = R.isMod() || R.isSpeaker(R.me.id);
      const ref = h('input', { class: 'input', placeholder: 'John 3:16, Psalm 23, Rom 8:28-39 … or “verses about hope”', value: R.scriptureDraft || '', oninput: (e) => { R.scriptureDraft = e.target.value; } });
      const tr = translationSelect(R.bibleTr(), (v) => { R.setBibleTr(v); preview(); });
      const out = h('div', { class: 'scripture-preview' });
      async function preview() {
        const q = ref.value.trim(); if (!q) { out.replaceChildren(); return; }
        out.replaceChildren(h('div', { class: 'skel', style: { height: '80px' } }));
        try { const p = await api(`/api/bible/passage?ref=${encodeURIComponent(q)}&t=${R.bibleTr()}`); out.replaceChildren(h('b', null, `${p.reference} · ${p.translation?.short || ''}`), versesEl(p, { selectable: false })); }
        catch {
          try { const r = await api('/api/ai/scripture', { method: 'POST', headers: R.headers(), body: { query: q, translation: R.bibleTr() } });
            out.replaceChildren(h('div', { class: 'tiny muted' }, 'Suggested passages'), h('div', { class: 'chips' }, (r.refs || []).map((x) => h('button', { class: 'chip', onclick: () => { ref.value = x.reference || x; R.scriptureDraft = ref.value; preview(); } }, x.reference || x))));
          } catch (e) { out.replaceChildren(h('p', { class: 'muted small' }, 'Couldn’t find that passage.')); }
        }
      }
      ref.addEventListener('keydown', (e) => { if (e.key === 'Enter') preview(); });
      box.append(ref, h('div', { class: 'row gap-s' }, h('div', { class: 'grow' }, tr), btn('search', 'Preview', preview, { group: 'faith', cls: 'sm' })),
        canShow ? h('div', { class: 'row gap-s' }, btn('presentation', 'Show to everyone', () => { if (ref.value.trim()) R.send('scripture-show', { reference: ref.value.trim(), translation: R.bibleTr() }); }, { group: 'faith', cls: 'primary grow' }),
          R.scripture ? btn('x', 'Clear', () => R.send('scripture-clear', {}), { cls: 'ghost' }) : null) : note('Hosts and speakers can put verses on screen. You’ll always read them in your chosen translation.'),
        out);
      if (R.scripture) box.prepend(h('div', { class: 'shade', 'data-group': 'faith' }, h('div', { class: 'tiny muted' }, `On screen now · shown by ${R.scripture.by}`), h('b', null, R.scripture.reference)));
      if (ref.value) preview();
      return box;
    },
    captions() {
      const box = h('div', { class: 'stack' });
      const c = R.captioner;
      const cfg = R.config.stt || {};
      const LANGS = [['en', 'English (Nigeria)'], ['pcm', 'Naijá / Pidgin'], ['yo', 'Yorùbá'], ['ig', 'Igbo'], ['ha', 'Hausa']];
      const lang = h('select', { class: 'input sm', onchange: (e) => R.setCaptionLang(e.target.value) }, LANGS.map(([v, l]) => h('option', { value: v, selected: R.captionLang() === v }, l)));
      const open = lsGetRaw('venue.cap.settings') === '1';
      const toggleOpen = () => { lsSetRaw('venue.cap.settings', open ? '0' : '1'); R.panel.render(); };
      const chip = (ic, label, on, run, tip, disabled) => h('button', { class: `chip sm${on ? ' on' : ''}`, type: 'button', 'data-group': 'media', 'aria-pressed': on ? 'true' : 'false', 'data-tip': tip, 'aria-label': label, disabled: !!disabled, onclick: run, html: icon(ic, { size: 14 }) + `<span>${esc(label)}</span>` });
      const text = () => R.data.captions.map((l) => `${l.name}: ${l.text}`).join('\n');
      const ib = (ic, tip, run, group) => h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': tip, 'aria-label': tip, 'data-group': group || undefined, onclick: run, html: icon(ic, { size: 15 }) });
      const canMic = !!(cfg.server || SpeechRec);
      const micSub = c.on ? `Active · ${c.mode === 'stt' ? 'Nigerian STT (' + (cfg.providers || []).join(' → ') + ')' : 'on-device speech'}` : (cfg.server ? 'Uses ' + (cfg.providers || []).join(' → ') : SpeechRec ? 'Uses your browser’s speech engine' : 'Not supported on this browser');
      const head = h('div', { class: 'cap-head' },
        h('div', { class: 'cap-bar' },
          chip('captions', 'Show', R.showCaptions, () => { R.setShowCaptions(!R.showCaptions); R.panel.render(); }, 'Overlay captions on the stage'),
          chip('mic', c.on ? 'Captioning me' : 'Caption me', c.on, () => (c.on ? (c.stop(), R.panel.render()) : c.start().then(() => R.panel.render()).catch(toastErr)), micSub, !canMic && !c.on),
          R.transcribe ? h('span', { class: 'pill sm live', 'data-tip': 'Transcript is being saved' }, 'Saving') : null,
          h('span', { class: 'grow' }),
          ib('copy', 'Copy transcript', () => copy(text(), 'Transcript copied')),
          ib('download', 'Download .txt', () => download(`${R.code}-transcript.txt`, text())),
          R.historyId ? ib('sparkles', 'Summary & full transcript', () => window.open('/session/' + R.historyId, '_blank'), 'ai') : null,
          h('button', { class: `icon-btn sm cap-more${open ? ' on' : ''}`, type: 'button', 'aria-expanded': open ? 'true' : 'false', 'data-tip': open ? 'Hide settings' : 'Settings', 'aria-label': 'Caption settings', onclick: toggleOpen, html: icon('settings', { size: 15 }) })),
        open ? h('div', { class: 'cap-settings' },
          row('languages', 'Spoken language', 'Nigerian English, Pidgin, Yorùbá, Igbo and Hausa', lang),
          row('mic', 'Caption my voice', micSub, sw(c.on, (v) => v ? c.start().then(() => R.panel.render()).catch(toastErr) : (c.stop(), R.panel.render()), !canMic && !c.on)),
          R.isMod() ? row('fileText', 'Save transcript', 'Store captions for summaries after the session', sw(R.transcribe, (v) => R.send('transcript-toggle', { on: v }))) : null) : null);
      const lines = R.data.captions.slice(-200);
      const list = h('div', { class: 'transcript live', 'data-autoscroll': '' }, lines.length ? lines.map((l) => h('div', { class: 'tline' }, h('span', { class: 'ts' }, new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', null, h('b', null, l.name + ': '), l.text))) : h('div', { class: 'empty sm' }, h('p', null, 'Captions will appear here as people speak.')));
      box.classList.add('cap-view');
      box.append(head, list);
      return box;
    },
    ai() {
      const box = h('div', { class: 'stack' });
      const out = h('div', { class: 'ai-out stack' });
      const show = (title, r) => { out.prepend(h('div', { class: 'ai-box' }, h('div', { class: 'row tiny muted' }, h('span', { class: 'grow', html: icon('sparkles', { size: 14 }) + ' ' + esc(title) }), h('span', null, r.provider || '')), h('div', { class: 'prose', html: md(r.text || '') }), h('div', { class: 'row' }, btn('copy', 'Copy', () => copy(r.text), { cls: 'xs ghost' })))); };
      const run = async (title, url, body, b) => { b && (b.disabled = true); const sp = h('div', { class: 'skel', style: { height: '60px' } }); out.prepend(sp); try { show(title, await api(url, { method: 'POST', headers: R.headers(), body })); } catch (e) { toastErr(e); } finally { sp.remove(); b && (b.disabled = false); } };
      const q = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Ask anything about this session…' });
      const ask = btn('send', 'Ask', () => q.value.trim() && run(q.value.trim(), '/api/ai/ask', { question: q.value.trim() }, ask), { cls: 'primary sm', group: 'ai' });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask.click(); } });
      const cu = btn('history', 'Catch me up (10 min)', () => run('Catch-up', '/api/ai/catchup', { minutes: 10 }, cu), { group: 'ai' });
      const lang = h('select', { class: 'input sm' }, ['Yoruba', 'Igbo', 'Hausa', 'Nigerian Pidgin', 'French', 'English'].map((l) => h('option', null, l)));
      const tr = btn('languages', 'Translate last captions', () => { const t = R.data.captions.slice(-8).map((l) => `${l.name}: ${l.text}`).join('\n'); if (!t) return toast('No captions yet', { icon: 'captions' }); run('Translation → ' + lang.value, '/api/ai/translate', { text: t, lang: lang.value }, tr); }, { group: 'ai', cls: 'sm' });
      box.append(h('div', { class: 'compose-card' }, q, h('div', { class: 'row' }, h('span', { class: 'tiny muted grow' }, R.config.ai?.providers?.length ? 'AI: ' + R.config.ai.providers.map((p) => (p && typeof p === 'object' ? p.name || p.model : p)).filter(Boolean).join(' → ') : 'AI'), ask)),
        h('div', { class: 'chips' }, cu, R.isMod() ? btn('fileText', 'Summarise so far', () => run('Summary so far', '/api/ai/ask', { question: 'Summarise the session so far in 5 bullet points, then list action items.' }), { group: 'ai' }) : null),
        h('div', { class: 'row gap-s' }, lang, tr), out);
      return box;
    },
    boards() {
      const box = h('div', { class: 'stack' });
      const sharing = R.boardSharing;
      box.append(h('div', { class: 'tool-hero', 'data-group': 'content' }, h('b', null, 'Your personal board'), note(R.myBoardRef ? `“${R.myBoardRef.title}” · autosaves to My boards. Share it and others watch live.` : 'Only you draw on it. Pages, pencil, pen, airbrush, images and .mwb files. Share it and others watch live.'),
        h('div', { class: 'row gap-s wrap' }, btn('pen', 'Open my board', () => R.openMyBoard(), { group: 'content', cls: 'primary' }), btn(sharing ? 'eyeOff' : 'eye', sharing ? 'Stop sharing' : 'Share live', () => R.shareBoard(!sharing), { group: 'content' }), state.user ? btn('folder', 'Open saved board', () => { R.openSavedBoard(); }, { group: 'content' }) : null)));
      const others = R.boards.filter((b) => b.ownerId !== R.me.id);
      box.append(h('div', { class: 'sec-sub' }, `Boards shared in this room (${others.length})`));
      others.forEach((b) => box.append(h('button', { class: 'list-item', onclick: () => R.viewBoard(b.ownerId) }, h('span', { class: 'ico-tile sm', 'data-group': 'content', html: icon('board', { size: 16 }) }), h('div', { class: 'grow' }, h('b', null, `${b.name}’s board`), h('div', { class: 'tiny muted' }, 'Live · ' + timeAgo(b.at))), h('span', { html: icon('chevronRight', { size: 16 }) }))));
      if (!others.length) box.append(note('Nobody else is sharing a board right now.'));
      box.append(h('div', { class: 'sec-sub' }, 'Team board'), note('A board everyone in the room can draw on together.'), btn('users', 'Open team board', () => R.openTeamBoard(), { group: 'content' }));
      return box;
    },
    present() {
      const box = h('div', { class: 'stack' });
      const c = R.content;
      if (c) box.append(h('div', { class: 'shade', 'data-group': 'content' }, h('div', { class: 'tiny muted' }, `Presenting now · ${c.type}`), h('b', null, c.title || c.url),
        h('div', { class: 'row gap-s wrap', style: { marginTop: '.5rem' } }, (c.ownerId === R.me.id || R.isMod()) ? btn('stop', 'Stop presenting', () => R.send('content-stop', {}), { cls: 'sm danger' }) : null,
          c.ownerId === R.me.id ? btn('users', 'Hand remote to…', (e) => import('../ui.js').then(({ menu }) => menu(e.currentTarget, R.people().filter((p) => p.id !== R.me.id).map((p) => ({ label: p.name, icon: 'user', run: () => R.send('remote-handoff', { targetId: p.id }) })))), { cls: 'sm' }) : null,
          c.remoteHolderId === R.me.id || c.ownerId === R.me.id ? null : btn('hand', 'Request remote', () => R.send('remote-claim', {}), { cls: 'sm ghost' }))));
      const canPresent = R.perm('screenShare') || R.isMod();
      if (!canPresent) { box.append(note('The host controls who can present.')); return box; }
      const yurl = h('input', { class: 'input', type: 'url', inputmode: 'url', 'data-focus': '', value: R.ytDraft || '', placeholder: 'Paste a YouTube link…', oninput: (e) => { R.ytDraft = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') goYT(); } });
      const goYT = () => { const id = ytId(yurl.value); if (!id) { toast('That doesn’t look like a YouTube link', { icon: 'alert' }); return; } startContent(R, { contentType: 'youtube', videoId: id, title: 'YouTube video' }); R.ytDraft = ''; yurl.value = ''; };
      const busy = presentBusy ? h('div', { class: 'tiny muted row gap-s' }, h('span', { class: 'spin sm' }), presentBusy) : null;
      const lkOk = !!R.media.room;
      box.append(btn('screen', R.media.sharing ? 'Stop sharing screen' : 'Share your screen', () => R.toggleShare(), { group: 'media', cls: 'primary block', disabled: !lkOk }),
        lkOk ? null : note('Screen sharing needs the audio/video server, which isn’t connected right now.'),
        h('div', { class: 'sec-sub' }, 'Watch together'),
        h('div', { class: 'row gap-s' }, h('div', { class: 'grow' }, yurl), btn('youtube', 'Play', goYT, { group: 'content' })),
        h('div', { class: 'sec-sub' }, 'Slides & images'),
        h('div', { class: 'row gap-s wrap' }, btn('upload', 'Upload PDF or image', () => pickContentFile(R), { group: 'content', disabled: !!presentBusy })), busy,
        note('These work even when audio/video is down. YouTube streams from YouTube on each device and play, pause and seek follow the presenter. PDFs become page images everyone can see on any phone.'));
      return box;
    },
    sounds() {
      const box = h('div', { class: 'stack' });
      const off = R.security.sounds === false && !R.isMod();
      box.append(h('div', { class: 'sound-grid' }, SOUNDS.map((sd) => h('div', { class: 'sound-card' },
        h('button', { class: 'sound-play', type: 'button', disabled: off, 'aria-label': `Play ${sd.label} for everyone`, onclick: () => R.playRoomSound(sd.id) }, h('span', { class: 'em' }, sd.emoji), h('b', null, sd.label)),
        h('button', { class: 'icon-btn sm', type: 'button', 'data-tip': 'Preview just for me', 'aria-label': `Preview ${sd.label}`, onclick: () => playSound(sd.id, { force: true }), html: icon('headphones', { size: 14 }) })))),
        row(soundsMuted() ? 'volumeX' : 'volume', 'Mute sounds for me', 'Others still hear them', sw(soundsMuted(), (v) => { setSoundsMuted(v); R.panel.render(); })),
        R.isMod() ? row('shield', 'Allow everyone to play sounds', 'Off = only hosts and moderators', sw(R.security.sounds !== false, (v) => R.send('update-security', { settings: { sounds: v } }))) : null,
        note(off ? 'The host has turned sounds off for this room.' : 'Plays for everyone in the room. One sound every few seconds per person. Tip: type “applause” or “sounds” in the command bar or chat.'));
      return box;
    },
    timeline() {
      const box = h('div', { class: 'stack' });
      const tl = R.timeline;
      if (R.isMod() || R.media.sharing) box.append(h('div', { class: 'row gap-s wrap' }, btn('camera', 'Snapshot stage', () => R.snapshotToTimeline(), { group: 'content', cls: 'primary' }),
        R.isMod() ? btn(tl.slideshow ? 'pause' : 'play', tl.slideshow ? 'Stop slideshow' : 'Slideshow for all', () => R.send('screen-timeline-slideshow', { on: !tl.slideshow }), { group: 'content' }) : null));
      if (!tl.items.length) box.append(note('Snapshots of shared screens and slides collect here, so late joiners can scroll back.'));
      box.append(h('div', { class: 'tl-grid' }, tl.items.map((it, i) => h('figure', { class: `tl-item${i === tl.selected ? ' on' : ''}` }, h('img', { src: it.dataUrl, alt: it.title || 'Snapshot', loading: 'lazy', onclick: () => { R.send('screen-timeline-select', { index: i }); R.timeline.selected = i; R.timelineView = true; R.renderStage(); } }),
        h('figcaption', { class: 'row' }, h('span', { class: 'grow tiny ellipsis' }, it.ownerName || ''), h('button', { class: 'icon-btn sm', 'data-tip': 'Download', onclick: () => fetch(it.dataUrl).then((r) => r.blob()).then((b) => download(`slide-${i + 1}.jpg`, b, b.type)), html: icon('download', { size: 14 }) }),
          R.isMod() ? h('button', { class: 'icon-btn sm', 'data-tip': 'Remove', onclick: () => R.send('screen-timeline-remove', { id: it.id }), html: icon('trash', { size: 14 }) }) : null)))));
      return box;
    },
    record() {
      const box = h('div', { class: 'stack' });
      const mine = R.recorder.state;
      box.append(h('div', { class: 'tool-hero', 'data-group': 'media' }, h('b', null, 'Recordings never leave your device'), note('We capture this tab with everyone’s audio and save a .webm file straight to your computer or phone.')));
      if (R.me.role === 'host') {
        const rs = R.recording;
        box.append(h('div', { class: 'sec-sub' }, 'Session recording (everyone is notified)'),
          !rs || rs.status === 'stopped' ? btn('record', 'Start recording', () => R.send('start-recording', { audio: true, video: true, screenShare: true, chat: true }), { group: 'media', cls: 'primary block' })
            : h('div', { class: 'row gap-s' }, rs.status === 'paused' ? btn('play', 'Resume', () => R.send('resume-recording', {}), { group: 'media' }) : btn('pause', 'Pause', () => R.send('pause-recording', {}), { group: 'media' }), btn('stop', 'Stop & save', () => R.send('stop-recording', {}), { cls: 'danger grow' })));
      } else if (R.recording && R.recording.status !== 'stopped') box.append(h('div', { class: 'shade', 'data-group': 'media' }, h('b', null, '● The host is recording this session')));
      box.append(h('div', { class: 'sec-sub' }, 'Personal recording'),
        mine === 'idle' ? h('div', { class: 'row gap-s wrap' }, btn('video', 'Record screen + audio', () => R.recorder.start({ video: true, name: R.code }).catch(toastErr), { group: 'media' }), btn('mic', 'Audio only', () => R.recorder.start({ video: false, name: R.code + '-audio' }).catch(toastErr), { group: 'media' }))
          : h('div', { class: 'row gap-s' }, h('span', { class: 'rec-dot' }), h('span', { class: 'grow' }, mine === 'paused' ? 'Paused' : 'Recording ' + fmtDur((Date.now() - R.recorder.started) / 1000)), mine === 'paused' ? btn('play', '', () => R.recorder.resume()) : btn('pause', '', () => R.recorder.pause()), btn('stop', 'Save', () => R.recorder.stop(), { cls: 'danger' })));
      return box;
    },
    breakouts() {
      const box = h('div', { class: 'stack' });
      const b = R.breakouts;
      if (!b || !b.open) {
        let n = 2;
        const cnt = h('b', null, '2');
        box.append(note('People are spread evenly. You can move anyone and close all rooms at once.'), h('div', { class: 'row gap-s' }, h('span', { class: 'grow' }, 'Rooms'),
          h('button', { class: 'icon-btn', onclick: () => { n = Math.max(2, n - 1); cnt.textContent = n; }, html: icon('chevronLeft') }), cnt, h('button', { class: 'icon-btn', onclick: () => { n = Math.min(10, n + 1); cnt.textContent = n; }, html: icon('chevronRight') })),
          btn('split', 'Open breakout rooms', () => R.send('breakout-create', { count: n }), { group: 'people', cls: 'primary block' }));
      } else {
        box.append(btn('x', 'Close all rooms', () => R.send('breakout-close', {}), { cls: 'danger block' }));
        b.rooms.forEach((room) => box.append(h('div', { class: 'shade', 'data-group': 'people' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, room.name), btn('login', 'Visit', () => R.joinBreakout(room), { cls: 'xs' })),
          ...room.participantIds.map((pid) => { const p = R.p(pid); return h('div', { class: 'person' }, h('span', { class: 'grow' }, p ? p.name : pid), h('select', { class: 'input sm', onchange: (e) => R.send('breakout-move', { targetId: pid, roomId: e.target.value }) }, b.rooms.map((r) => h('option', { value: r.id, selected: r.id === room.id }, r.name)))); }))));
      }
      return box;
    },
    security() {
      const s = R.security;
      const set = (k) => (v) => R.send('update-security', { settings: { [k]: v } });
      const max = h('input', { class: 'input sm', type: 'number', min: 2, max: 1000, value: R.maxParticipants || '', style: { width: '90px' }, onchange: (e) => R.send('set-max-participants', { max: Number(e.target.value) }) });
      return h('div', { class: 'stack' },
        row('lock', 'Lock room', 'No new people can join', sw(s.locked, (v) => R.send(v ? 'lock-meeting' : 'unlock-meeting', {}))),
        row('door', 'Waiting room', 'You admit everyone who joins', sw(s.waitingRoom, set('waitingRoom'))),
        row('user', 'Guest access', 'Allow people without an account', sw(s.guestAccess !== false, set('guestAccess'))),
        h('div', { class: 'sec-sub' }, 'Everyone can…'),
        row('mic', 'Unmute themselves', null, sw(s.participantMicrophone !== false, set('participantMicrophone'))),
        row('video', 'Turn on camera', null, sw(s.participantCamera !== false, set('participantCamera'))),
        row('screen', 'Share screen', null, sw(s.participantScreenShare !== false, set('participantScreenShare'))),
        row('chat', 'Send chat messages', null, sw(s.chat !== false, set('chat'))),
        row('smile', 'Send reactions', null, sw(s.reactions !== false, set('reactions'))),
        row('hand', 'Raise hand', null, sw(s.raiseHand !== false, set('raiseHand'))),
        row('music', 'Play sounds', 'Applause, drum roll… (rate-limited)', sw(s.sounds !== false, set('sounds'))),
        row('userPlus', 'Invite others', null, sw(s.participantsCanInvite !== false, set('participantsCanInvite'))),
        row('users', 'Max participants', 'Cap the room size', max),
        btn('refresh', 'Reset invite link', async () => { try { const r = await api('/api/invite/regenerate', { method: 'POST', headers: R.headers(), body: { code: R.code, participantId: R.me.id } }); R.inviteKey = r.key || r.inviteKey || null; toast('New invite link created — old links stop working', { icon: 'link', group: 'admin' }); } catch (e) { toastErr(e); } }, { cls: 'block' }),
        R.me.role === 'host' ? btn('phoneOff', 'End session for everyone', () => R.endForAll(), { cls: 'danger block' }) : null);
    },
    activity() {
      const box = h('div', { class: 'stack' });
      if (!R.activityLoaded) { R.activityLoaded = true; api(`/api/activity?code=${R.code}`, { headers: R.headers() }).then((r) => { const list = r.activity || r.entries || []; R.data.activity = [...list.reverse(), ...R.data.activity].slice(-300); R.panel.render(); }).catch(() => {}); }
      const list = [...R.data.activity].reverse().slice(0, 200);
      if (!list.length) box.append(note('Joins, role changes and moderation show up here.'));
      list.forEach((a) => box.append(h('div', { class: 'act-row' }, h('span', { class: 'dot', 'data-type': a.eventType || a.event_type }), h('div', { class: 'grow' }, h('b', null, a.actorName || a.actor_name || 'Someone'), ' ', h('span', null, String(a.eventType || a.event_type || '').replace(/[_-]/g, ' ')), a.detail && typeof a.detail === 'object' && a.detail.targetName ? ` → ${a.detail.targetName}` : ''), h('time', { class: 'tiny muted' }, timeAgo(a.at || a.created_at)))));
      return box;
    },
    diagnostics() {
      const box = h('div', { class: 'stack' });
      const grid = h('div', { class: 'set-grid diag' });
      const put = (k, v, ok) => grid.append(h('div', { class: `set-card${ok === false ? ' bad' : ok ? ' good' : ''}` }, h('small', { class: 'muted' }, k), h('b', null, v ?? '—')));
      put('Signal (WebSocket)', R.wsState, R.wsState === 'open');
      put('Media server', R.config.livekitConfigured ? R.media.state : 'Not configured', R.config.livekitConfigured ? R.media.state === 'connected' : false);
      put('Your network', R.quality[R.me.id] || 'unknown', ['excellent', 'good'].includes(R.quality[R.me.id]));
      put('Mic', R.media.mic ? 'On' : 'Off'); put('Camera', R.media.cam ? 'On' : 'Off');
      put('Simulcast', R.config.media?.simulcast !== false ? 'On' : 'Off', true);
      put('Video cap', `${Math.round((R.config.media?.videoMaxBitrate || 1200000) / 1000)} kbps @ ${R.config.media?.videoMaxFps || 24}fps`);
      put('Screen cap', `${Math.round((R.config.media?.screenMaxBitrate || 2500000) / 1000)} kbps @ ${R.config.media?.screenMaxFps || 15}fps`);
      R.media.stats().then((s) => { if (!s) return; if (s.sendRes) put('Sending', s.sendRes); if (s.rtt) put('Round trip', s.rtt); if (s.uplink) put('Uplink estimate', s.uplink); if (s.region) put('SFU region', s.region); });
      box.append(grid, h('div', { class: 'row gap-s wrap' }, btn('headphones', 'Devices', () => R.deviceSheet(), { group: 'media' }), btn('refresh', 'Reconnect media', () => R.reconnectMedia(), { group: 'settings' })));
      return box;
    },
    shortcuts() {
      const keys = [['M', 'Mute / unmute'], ['V', 'Camera on / off'], ['S', 'Share screen'], ['H', 'Raise / lower hand'], ['C', 'Chat'], ['P', 'People'], ['E', 'Engage (polls, Q&A)'], ['G', 'Cycle layout'], ['F', 'Fullscreen'], ['/', 'Command bar'], ['Ctrl K', 'Command bar'], ['Esc', 'Close panel / sheet']];
      return h('div', { class: 'list' }, keys.map(([k, l]) => h('div', { class: 'set-row' }, h('span', { class: 'kbd' }, k), h('span', { class: 'grow' }, l))), note('Text-size shortcuts were removed — use Settings → Text size for a comfortable reading size.'));
    },
  };
}
export { createBoard, boardToolbar, refLabel, debounce };
