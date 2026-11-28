// Tool views for the room panel (rendered inside panels.js → Tools).
import { h, esc, api, toast, toastErr, copy, download, md, uploadFile, timeAgo, debounce, fmtDur, reportClientError, deckKind, DECK_HELP } from '../ui.js';
import { state } from '../app.js';
import { icon } from '../icons.js';
import { translationSelect, versesEl, refLabel, makeListenBtn } from '../pages/bible.js';
import { createBoard, boardToolbar } from '../pages/whiteboard.js';
import { SpeechRec } from './captions.js';
import { SOUNDS, playSound, soundsMuted, setSoundsMuted } from './sounds.js';
import { ytId } from './youtube.js';
import { add } from '../safe-text.js';
import { certEditor } from '../cert-ui.js';
import { priceLabel } from '../material-sale.js';

const btn = (ic, label, run, { group = '', cls = '', disabled } = {}) => h('button', { class: `btn ${cls}`, 'data-group': group, type: 'button', disabled: !!disabled, onclick: run, html: icon(ic, { size: 16 }) + (label ? `<span>${esc(label)}</span>` : '') });

// Content sharing helpers live at module level: the panel re-renders often, so the file input and progress must survive it.
// Random opening passage, picked once per page load per corpus so panel re-renders don't reshuffle it.
const OPEN_REFS = {
  bible: ['John 3:16', 'Psalm 23', 'Romans 8:28', 'Philippians 4:6-7', 'Isaiah 40:31', 'Proverbs 3:5-6', 'Jeremiah 29:11', 'Matthew 11:28-30', 'Joshua 1:9', '1 Corinthians 13:4-7', 'Psalm 46:1-3', 'Lamentations 3:22-23', 'Matthew 5:3-10', 'Hebrews 11:1', 'Psalm 121'],
  quran: ['1:1-7', '2:255', '112:1-4', '94:1-8', '2:286', '13:28', '3:139', '65:2-3', '93:1-11', '55:1-13', '39:53', '2:152-153', '103:1-3', '24:35', '49:13'],
};
const openPicks = {};
function randomRef(corpus) {
  if (!openPicks[corpus]) { const l = OPEN_REFS[corpus]; openPicks[corpus] = l[Math.floor(Math.random() * l.length)]; }
  return openPicks[corpus];
}

let presentBusy = '';

async function fillMaterialsInline(R, root) {
  const host = root.querySelector('[data-materials]');
  if (!host) return;
  host.replaceChildren(h('div', { class: 'tiny muted' }, 'Loading…'));
  try {
    if (!R._materials) {
      const r = await api('/api/materials');
      R._materials = r.materials || [];
    }
    const list = R._materials;
    if (!list.length) {
      host.replaceChildren(h('div', { class: 'tiny muted' }, 'No saved materials yet. Add some on the Materials page.'));
      return;
    }
    host.replaceChildren();
    list.slice(0, 12).forEach((m) => {
      const sub = m.kind === 'youtube' ? 'YouTube' : m.kind === 'image' ? 'Image' : m.kind === 'doc' ? 'Word document' : m.kind === 'sheet' ? 'Spreadsheet' : `${(m.payload?.pages || []).length || 0} pages`;
      const th = m.kind === 'youtube' && m.payload?.videoId ? `https://i.ytimg.com/vi/${m.payload.videoId}/mqdefault.jpg`
        : m.kind === 'image' && m.payload?.url ? m.payload.url
        : (m.payload?.pages && m.payload.pages[0]) || null;
      const row = h('div', { class: 'col', style: { gap: '.25rem' } },
        h('button', {
          class: 'list-item', type: 'button',
          onclick: () => presentMaterial(R, m),
        }, th ? h('img', { class: 'sug-thumb', src: th, alt: '' }) : h('span', { class: 'ico-tile sm', 'data-group': 'content', html: icon(m.kind === 'youtube' ? 'youtube' : m.kind === 'image' ? 'image' : m.kind === 'sheet' ? 'grid' : m.kind === 'doc' ? 'file' : 'presentation', { size: 16 }) }),
          h('div', { class: 'grow' }, h('b', null, m.title), h('div', { class: 'tiny muted' }, sub + (m.forSale ? ` · ${priceLabel(m)}` : ''))),
          h('span', { html: icon('play', { size: 14 }) })));
      if (R.isMod() && m.forSale) {
        row.append(h('div', { class: 'row gap-s wrap' },
          h('button', { class: 'btn xs', type: 'button', onclick: () => R.send('material-offer', { materialId: m.id }) }, 'Send to chat'),
          h('button', { class: 'btn xs', type: 'button', onclick: () => R.send('material-overlay', { materialId: m.id }) }, 'Show on screen')));
      }
      host.append(row);
    });
  } catch (e) {
    host.replaceChildren(h('div', { class: 'tiny muted' }, e.message || 'Could not load materials'));
  }
}

// Confirm only once the server accepted the share (it answers content-state, or an error toast saying why).
const startContent = (R, payload) => {
  R._presentPending = true;
  R._presentToast = () => toast('Presenting to everyone', { icon: 'presentation', group: 'content' });
  R.send('content-start', payload);
  setTimeout(() => R.panel && R.panel.refresh('tools'), 300);
  setTimeout(() => { if (R._presentPending) { R._presentPending = false; toast('Presenting did not start. Check your connection and try again.', { icon: 'alert' }); } }, 8000);
};
let contentInput = null;
function pickContentFile(R) {
  if (!contentInput) { contentInput = h('input', { type: 'file', accept: 'application/pdf,image/*,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.doc,.docx,.csv,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: true, hidden: true }); document.body.append(contentInput); }
  contentInput.onchange = () => {
    const files = Array.from(contentInput.files); contentInput.value = '';
    if (!files.length) return;
    if (files.length > 1) {
      if (!files.every((f) => f.type.startsWith('image/'))) return toast('Select multiple images, or one document at a time', { icon: 'alert' });
      if (files.length > 200) return toast('Select up to 200 images', { icon: 'alert' });
      return shareContentImages(R, files);
    } else return shareContentFile(R, files[0]);
  };
  contentInput.click();
}
export async function shareContentFile(R, f) {
  const setBusy = (t) => { presentBusy = t || ''; R.panel.refresh('tools'); };
  const name = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
  let step = 'start';
  try {
    step = 'detect type';
    const kind = await deckKind(f);
    if (DECK_HELP[kind]) throw new Error(DECK_HELP[kind]);
    if (kind === 'pdf') {
      step = 'render PDF'; setBusy('Preparing slides…');
      const { pdfToImages } = await import('./pdfslides.js');
      const { files, total, truncated } = await pdfToImages(f, { onProgress: (i, n) => setBusy(`Rendering page ${i} of ${n}…`) });
      const pages = [];
      for (let i = 0; i < files.length; i++) { step = `upload page ${i + 1}/${files.length}`; setBusy(`Uploading page ${i + 1} of ${files.length}…`); pages.push((await uploadFile(files[i], { purpose: 'content', headers: R.headers() })).url); }
      startContent(R, { contentType: 'slides', pages, title: name || 'Slides', fileMeta: { name: f.name, size: f.size, mime: f.type } });
      if (truncated) toast(`Only the first ${files.length} of ${total} pages were shared`, { icon: 'alert' });
    } else if (kind === 'image') {
      setBusy('Uploading…');
      const r = await uploadFile(f, { purpose: 'content', headers: R.headers() });
      startContent(R, { contentType: 'image', url: r.url, title: name || 'Image', fileMeta: { name: f.name, size: f.size, mime: f.type } });
    } else if (kind === 'pptx') {
      step = 'convert PPTX'; setBusy('Converting PPTX on server…');
      const q = name ? `?title=${encodeURIComponent(name)}` : '';
      const res = await fetch('/api/convert/pptx' + q, {
        method: 'POST',
        body: f,
        credentials: 'include',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ...R.headers() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `PPTX conversion failed (${res.status})`);
      if (!Array.isArray(data.pages) || !data.pages.length) throw new Error('No slides were produced from this presentation');
      startContent(R, {
        contentType: 'slides',
        pages: data.pages,
        title: data.title || name || 'Slides',
        fileMeta: { name: f.name, size: f.size, mime: f.type },
      });
      if (data.truncated) toast(`Only the first ${data.pages.length} of ${data.total} pages were shared`, { icon: 'alert' });
    } else if (kind === 'doc') {
      step = 'upload document'; setBusy('Uploading document…');
      const up = await uploadFile(f, { purpose: 'content', headers: R.headers() });
      step = 'prepare document'; setBusy('Preparing document…');
      await shareDocUrl(R, { url: up.url, name: f.name, mime: f.type, title: name });
    } else throw new Error(`“${f.name}” isn’t a PDF, PPTX, Word, spreadsheet or image${f.type ? ` (${f.type})` : ''}`);
  } catch (e) { reportClientError('present', e, { step, file: f.name, mime: f.type || '(none)', size: f.size }); } finally { setBusy(''); }
}
/** Word / CSV / Excel: the server extracts it into a paged doc; then present it like slides. */
async function shareDocUrl(R, { url, name, mime, title }) {
  const res = await fetch('/api/convert/doc', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...R.headers() }, body: JSON.stringify({ url, name, mime, title }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not prepare the document (${res.status})`);
  startContent(R, { contentType: 'doc', url: data.url, docKind: data.docKind, pageCount: data.pageCount, title: data.title || title || 'Document', fileMeta: data.fileMeta });
}
async function shareContentImages(R, files, { append = false } = {}) {
  const setBusy = (t) => { presentBusy = t || ''; R.panel.refresh('tools'); };
  try {
    const pages = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading image ${i + 1} of ${files.length}…`);
      const r = await uploadFile(files[i], { purpose: 'content', headers: R.headers() });
      pages.push(r.url);
    }
    const c = R.content;
    if (append && c && c.type === 'slides' && Array.isArray(c.pages) && R.canControlContent()) {
      R.setContentPages([...(c.pages || []), ...pages]);
      toast(`Added ${pages.length} image${pages.length === 1 ? '' : 's'}`, { icon: 'image', group: 'content' });
      R.panel.refresh('tools');
    } else {
      startContent(R, { contentType: 'slides', pages, title: pages.length + ' images', fileMeta: { name: 'images', size: 0, mime: 'image/*' } });
    }
  } catch (e) { reportClientError('present', e, { step: 'upload images', file: files[0]?.name, pages: files.length }); } finally { setBusy(''); }
}
function pickMoreImages(R) {
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  document.body.append(input);
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (!files.length) return;
    if (files.length > 200) return toast('Select up to 200 images', { icon: 'alert' });
    shareContentImages(R, files, { append: true });
  };
  input.click();
}
async function presentMaterial(R, m) {
  if (!m) return;
  if (m.kind === 'youtube' && m.payload?.videoId) {
    startContent(R, { contentType: 'youtube', videoId: m.payload.videoId, title: m.title || 'YouTube video' });
    return;
  }
  if (m.kind === 'image' && m.payload?.url) {
    startContent(R, { contentType: 'image', url: m.payload.url, title: m.title || 'Image' });
    return;
  }
  if ((m.kind === 'doc' || m.kind === 'sheet') && m.payload?.sourceUrl) {
    presentBusy = 'Preparing document…'; R.panel.refresh('tools');
    try { await shareDocUrl(R, { url: m.payload.sourceUrl, name: m.payload.sourceName || m.title, mime: m.payload.sourceMime || '', title: m.title }); }
    catch (e) { reportClientError('present', e, { step: 'present material doc', file: m.payload.sourceName || m.title }); }
    finally { presentBusy = ''; R.panel.refresh('tools'); }
    return;
  }
  const pages = m.payload?.pages;
  if (Array.isArray(pages) && pages.length) {
    startContent(R, { contentType: 'slides', pages, title: m.title || 'Slides', fileMeta: { name: m.payload?.sourceName || m.title, mime: m.payload?.sourceMime || '' } });
    return;
  }
  toast('This material has no pages to present', { icon: 'alert' });
}
const sw = (checked, onchange, disabled) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (e) => onchange(e.target.checked) }), h('span'));
const row = (ic, label, sub, ctl) => h('label', { class: 'set-row' }, h('span', { class: 'ico', html: icon(ic, { size: 18 }) }), h('span', { class: 'grow' }, h('b', null, label), sub ? h('small', { class: 'muted block' }, sub) : null), ctl);
const lsGetRaw = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSetRaw = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const note = (t) => h('p', { class: 'tiny muted', style: { margin: '.4rem 0' } }, t);

function scriptureView(R, corpus = 'bible') {
  // Compact sidebar reader: one control line, then as much room as possible for the verses.
  const isQuran = corpus === 'quran';
  const defaultRef = randomRef(isQuran ? 'quran' : 'bible');
  const box = h('div', { class: 'scr-tool' });
  const canShow = R.canScripture();
  const shared = R.scripture && R.scrCorpus(R.scripture.translation) === corpus ? R.scripture : null;
  const draft = () => (isQuran ? R.quranDraft : R.bibleDraft) || '';
  const setDraft = (v) => { if (isQuran) R.quranDraft = v; else R.bibleDraft = v; };
  const trIdOf = () => R.corpusTr(corpus);
  const ref = h('input', { class: 'input sm grow', placeholder: isQuran ? 'Al-Ikhlas, Al-Fatihah 1, 2:255, family\u2026' : 'John 3:16, family, hope, \u201ca man shall leave\u2026\u201d', value: draft(), 'aria-label': isQuran ? 'Ayah or topic' : 'Verse or topic', oninput: (e) => { setDraft(e.target.value); } });
  const tr = translationSelect(shared ? R.scrTr() : trIdOf(), (v) => {
    if (shared && canShow) R.showScripture(shared.reference, { translation: v }); // live: everyone follows
    else if (shared) { R.scrOwnTr = true; R.setCorpusTr(corpus, v); R.panel.refresh('tools'); }
    else { R.setCorpusTr(corpus, v); preview(); }
  }, { compact: true, corpus });
  const ib = (ic, label, run, cls = '') => h('button', { class: `scr-ib ${cls}`, type: 'button', title: label, 'data-tip': label, 'aria-label': label, onclick: run, html: icon(ic, { size: 15 }) });
  const out = h('div', { class: 'scripture-preview scr-read' });
  const showNow = () => { const q = ref.value.trim() || shared?.reference; if (q) R.showScripture(q, { translation: trIdOf(), mode: shared?.mode || 'side' }); };
  function openHit(x) {
    ref.value = x.reference || x; setDraft(ref.value); preview();
  }
  function hitRow(x) {
    const text = x.text || x.excerpt || '';
    const body = (x.verses && x.verses.length)
      ? versesEl({ verses: x.verses }, { selectable: false, compact: true })
      : (text ? h('div', { class: 'scr-hit-text' }, text) : null);
    return h('div', { class: 'scr-hit' },
      h('button', { class: 'scr-hit-ref', type: 'button', onclick: () => openHit(x) }, x.reference || x),
      x.why ? h('div', { class: 'tiny muted' }, x.why) : null,
      body,
      h('div', { class: 'row gap-xs', style: { marginTop: '.25rem', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => openHit(x), html: icon('bookOpen', { size: 13 }) + ' Open' }),
        canShow ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => { ref.value = x.reference; setDraft(ref.value); R.showScripture(x.reference, { translation: x.translation || trIdOf(), mode: shared?.mode || 'side' }); }, html: icon('presentation', { size: 13 }) + ' Show' }) : null,
        makeListenBtn(() => ({
          verses: x.verses?.length ? x.verses : null,
          text: text || null,
          lang: x.lang,
          translation: x.translation || trIdOf(),
        }), { headers: R.headers() }),
        h('button', {
          class: 'icon-btn has-bg sm', type: 'button',
          'data-tip': 'Copy', 'aria-label': 'Copy',
          html: icon('copy', { size: 14 }),
          onclick: () => copy(`\u201c${x.text || text}\u201d - ${x.reference}${x.short ? ` (${x.short})` : ''}`, 'Verse copied'),
        }),
      ));
  }
  async function preview() {
    const q = ref.value.trim(); if (!q) return;
    if (shared && canShow) return showNow(); // while sharing, previewing a new chapter re-broadcasts it
    out.replaceChildren(h('div', { class: 'skel', style: { height: '80px' } }));
    const trId = trIdOf();
    try {
      const p = await api(`/api/books/passage?ref=${encodeURIComponent(q)}&t=${trId}`);
      const head = h('div', { class: 'row between', style: { alignItems: 'center', gap: '.4rem' } },
        h('b', { class: 'small' }, `${p.reference} \u00b7 ${p.translation?.short || ''}`),
        makeListenBtn(() => ({ verses: p.verses, lang: p.translation?.lang, translation: trId }), { headers: R.headers() }));
      out.replaceChildren(head, versesEl(p, { selectable: false }));
    } catch {
      try {
        const r = await api('/api/ai/scripture', { method: 'POST', headers: R.headers(), body: { query: q, translation: trId, corpus } });
        if (!(r.refs || []).length) {
          out.replaceChildren(h('p', { class: 'muted small' }, 'No matching passages. Try a reference or topic like \u201cfamily\u201d, \u201chope\u201d.'));
          return;
        }
        out.replaceChildren(
          h('div', { class: 'tiny muted', style: { marginBottom: '.35rem' } }, `${isQuran ? 'Qur\u2019an' : 'Bible'} topic matches`),
          h('div', { class: 'scr-hits col', style: { gap: '.55rem' } }, ...(r.refs || []).map(hitRow)),
        );
      } catch (e) { out.replaceChildren(h('p', { class: 'muted small' }, 'Couldn\u2019t find that passage.')); }
    }
  }
  ref.addEventListener('keydown', (e) => { if (e.key === 'Enter') preview(); });
  const onStage = shared && shared.mode === 'stage';
  // One line: verse | preview | show everyone | clear - icon-only, label on hover.
  const clear = () => {
    if (shared && canShow) R.send('scripture-clear', {});
    else { ref.value = defaultRef; setDraft(''); preview(); }
  };
  box.append(h('div', { class: 'scr-line' }, ref,
    ib('search', 'Preview', preview),
    canShow ? ib('presentation', shared ? 'Show this to everyone' : 'Show to everyone', showNow, 'pri') : null,
    canShow || !shared ? ib('x', shared ? 'Clear for everyone' : 'Clear', clear, 'x') : null));
  // Translation + big-screen toggle live on the tool header line (panels.js) to free room for verses.
  tr.classList.add('tr-select');
  box.headExtras = [tr,
    canShow && shared ? ib(onStage ? 'sidebar' : 'maximize', onStage ? 'Move to sidebar' : 'Show on the big screen', () => R.showScripture(shared.reference, { translation: shared.translation, mode: onStage ? 'side' : 'stage' })) : null].filter(Boolean);
  if (shared) {
    // chapter stepping for the sharer (syncs to everyone)
    const nav = canShow ? (d) => { const m = /^(.*?)(\d+)(?::[\d\-,]+)?\s*$/.exec(shared.reference); if (!m) return; const ch = Math.max(1, +m[2] + d); R.showScripture(`${m[1].trim()} ${ch}`, { translation: shared.translation }); } : null;
    const sel = R.stageR.scriptureBody(out);
    if (nav) box.append(h('div', { class: 'scr-nav' }, ib('chevronLeft', 'Previous chapter', () => nav(-1)), h('span', { class: 'tiny muted grow center' }, shared.reference), ib('chevronRight', 'Next chapter', () => nav(1))));
    box.append(out, sel);
  } else {
    box.append(out);
    if (!ref.value.trim()) ref.value = defaultRef;
    preview();
  }
  return box;
}

export function captionLineEl(l) {
  return h('div', { class: 'tline' }, h('span', { class: 'ts' }, new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', null, h('b', null, l.name + ': '), l.text));
}
export function followTranscript(list) {
  if (!list || list._followBound) return list;
  list._followBound = true;
  list._follow = true;
  list.addEventListener('scroll', () => {
    const atBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 48;
    list._follow = atBottom;
    const pill = list.parentElement && list.parentElement.querySelector('.cap-new-lines');
    if (atBottom && pill) pill.hidden = true;
  }, { passive: true });
  queueMicrotask(() => { list.scrollTop = list.scrollHeight; });
  return list;
}
export function pushCaptionLine(list, line) {
  if (!list || !line) return false;
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  list.append(captionLineEl(line));
  const rows = list.querySelectorAll('.tline');
  if (rows.length > 200) rows[0].remove();
  if (list._follow !== false) {
    list.scrollTop = list.scrollHeight;
    const pill = list.parentElement && list.parentElement.querySelector('.cap-new-lines');
    if (pill) pill.hidden = true;
  } else {
    let pill = list.parentElement && list.parentElement.querySelector('.cap-new-lines');
    if (!pill && list.parentElement) {
      pill = h('button', { class: 'cap-new-lines', type: 'button' }, 'New lines ↓');
      pill.onclick = () => { list._follow = true; list.scrollTop = list.scrollHeight; pill.hidden = true; };
      list.parentElement.append(pill);
    }
    if (pill) pill.hidden = false;
  }
  return true;
}

export function buildTools(R) {

  return {
    bible() { return scriptureView(R, 'bible'); },
    quran() { return scriptureView(R, 'quran'); },
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
      const canMic = c.usesServer || !!SpeechRec;
      const micSub = c.on ? `Active · ${c.mode === 'stt' ? 'Nigerian STT (' + (cfg.providers || []).join(' → ') + ')' : 'on-device speech'}` : (c.usesServer ? 'Uses ' + (cfg.providers || []).join(' → ') : SpeechRec ? 'Uses your browser’s speech engine' : 'Not supported on this browser');
      const head = h('div', { class: 'cap-head' },
        h('div', { class: 'cap-bar' },
          chip('captions', 'Show', R.showCaptions, () => { R.setShowCaptions(!R.showCaptions); R.panel.render(); }, 'Overlay captions on the stage'),
          chip('mic', c.on ? 'Captioning me' : 'Caption me', c.on, () => c.setMine(!c.on).then(() => R.panel.render()).catch(toastErr), micSub, !canMic && !c.on),
          R.transcribe ? h('span', { class: 'pill sm live', 'data-tip': 'Transcript is being saved' }, 'Saving') : null,
          h('span', { class: 'grow' }),
          ib('copy', 'Copy transcript', () => copy(text(), 'Transcript copied')),
          ib('download', 'Download .txt', () => download(`${R.code}-transcript.txt`, text())),
          R.historyId ? ib('sparkles', 'Summary & full transcript', () => window.open('/session/' + R.historyId, '_blank'), 'ai') : null,
          h('button', { class: `icon-btn sm cap-more${open ? ' on' : ''}`, type: 'button', 'aria-expanded': open ? 'true' : 'false', 'data-tip': open ? 'Hide settings' : 'Settings', 'aria-label': 'Caption settings', onclick: toggleOpen, html: icon('settings', { size: 15 }) })),
        open ? h('div', { class: 'cap-settings' },
          row('languages', 'Spoken language', 'Nigerian English, Pidgin, Yorùbá, Igbo and Hausa', lang),
          row('mic', 'Caption my voice', micSub, sw(c.on, (v) => c.setMine(v).then(() => R.panel.render()).catch(toastErr), !canMic && !c.on)),
          R.isMod() ? row('fileText', 'Save transcript', 'Store captions for summaries after the session', sw(R.transcribe, (v) => R.send('transcript-toggle', { on: v }))) : null) : null);
      const lines = R.data.captions.slice(-200);
      const list = followTranscript(h('div', { class: 'transcript live', 'data-autoscroll': '' }, lines.length ? lines.map(captionLineEl) : h('div', { class: 'empty sm' }, h('p', null, 'Captions will appear here as people speak.'))));
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
      if (c) {
        const canControl = c.ownerId === R.me.id || c.remoteHolderId === R.me.id;
        const canStop = c.ownerId === R.me.id || R.isMod();
        const canHand = c.ownerId === R.me.id || c.remoteHolderId === R.me.id || R.isMod();
        const stopBtn = canStop ? h('button', { class: 'icon-btn sm danger', 'data-tip': 'Stop presenting', type: 'button', onclick: () => R.confirmStopContent(), html: icon('stop', { size: 16 }) }) : null;
        const handBtn = canHand ? h('button', { class: 'icon-btn sm', 'data-tip': 'Hand remote', type: 'button', onclick: (e) => {
          const people = R.people().filter((p) => p.id !== R.me.id);
          if (!people.length) return toast('No one else in the call', { icon: 'users' });
          import('../ui.js').then(({ menu }) => menu(e.currentTarget, people.map((p) => ({ label: p.name, icon: 'user', run: () => R.send('remote-handoff', { targetId: p.id }) }))));
        }, html: icon('users', { size: 16 }) }) : null;
        box.append(h('div', { class: 'shade', 'data-group': 'content', style: { padding: '.8rem' } },
          h('div', { class: 'tiny muted', style: { marginBottom: '.3rem' } }, `Presenting now · ${c.type}`),
          h('div', { class: 'row between', style: { alignItems: 'center', gap: '.5rem' } },
            h('b', { class: 'grow', style: { fontSize: '1.05rem' } }, c.title || c.url),
            h('div', { class: 'row gap-xs' }, stopBtn, handBtn)
          )
        ));
        if (c.type === 'slides' && Array.isArray(c.pages) && c.pages.length) {
          const thumbs = h('div', { class: 'slide-thumbs deck-edit' });
          let dragFrom = null;
          c.pages.forEach((url, i) => {
            const t = h('div', {
              class: 'slide-thumb' + ((c.page || 1) === i + 1 ? ' on' : ''),
              draggable: canControl,
              'aria-label': 'Page ' + (i + 1),
              onclick: (e) => { if (!canControl || e.target.closest('.thumb-rm')) return; R.setContentPage(i + 1); },
            },
              h('img', { src: url, alt: 'Page ' + (i + 1), draggable: false }),
              h('span', { class: 'tiny' }, String(i + 1)),
              canControl ? h('button', {
                class: 'thumb-rm', type: 'button', title: 'Remove', 'aria-label': 'Remove page ' + (i + 1),
                onclick: (e) => {
                  e.stopPropagation();
                  if (c.pages.length <= 1) return toast('Keep at least one image', { icon: 'alert' });
                  const next = c.pages.filter((_, j) => j !== i);
                  const page = (c.page || 1) > i + 1 ? (c.page - 1) : Math.min(c.page || 1, next.length);
                  R.setContentPages(next, { page });
                  setTimeout(() => R.panel.refresh('tools'), 200);
                },
                html: '−',
              }) : null,
            );
            if (canControl) {
              t.addEventListener('dragstart', (e) => { dragFrom = i; t.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
              t.addEventListener('dragend', () => { dragFrom = null; t.classList.remove('dragging'); });
              t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('drag-over'); });
              t.addEventListener('dragleave', () => t.classList.remove('drag-over'));
              t.addEventListener('drop', (e) => {
                e.preventDefault(); t.classList.remove('drag-over');
                if (dragFrom == null || dragFrom === i) return;
                const next = c.pages.slice();
                const [item] = next.splice(dragFrom, 1);
                next.splice(i, 0, item);
                const cur = (c.page || 1) - 1;
                let page = cur + 1;
                if (cur === dragFrom) page = i + 1;
                else if (dragFrom < cur && i >= cur) page = cur;
                else if (dragFrom > cur && i <= cur) page = cur + 2;
                R.setContentPages(next, { page });
                setTimeout(() => R.panel.refresh('tools'), 200);
              });
            }
            thumbs.append(t);
          });
          const ss = h('label', { class: 'row gap-xs tiny', style: { marginTop: '.5rem' } },
            h('input', { type: 'checkbox', checked: !!c.slideshow, disabled: !canControl, onchange: (e) => R.toggleSlideshow(e.target.checked) }),
            'Slideshow'
          );
          box.append(h('div', { class: 'slide-nav', style: { marginTop: '.6rem' } },
            h('div', { class: 'row gap-s' },
              btn('chevronLeft', 'Previous', () => R.setContentPage((R.content.page || 1) - 1), { disabled: !canControl || c.page <= 1 }),
              h('span', { class: 'tiny grow center' }, `${c.page || 1} / ${c.pages.length}`),
              btn('chevronRight', 'Next', () => R.setContentPage((R.content.page || 1) + 1), { disabled: !canControl || c.page >= c.pages.length })),
            thumbs, ss,
            canControl ? h('div', { class: 'row gap-s wrap', style: { marginTop: '.5rem' } },
              btn('image', 'Add images', () => pickMoreImages(R), { group: 'content', disabled: !!presentBusy }),
            ) : null));
        }
      }
      const canPresent = R.perm('screenShare') || R.isMod();
      if (!canPresent) { box.append(note('The host controls who can present.')); return box; }
      const yurl = h('input', { class: 'input', type: 'url', inputmode: 'url', 'data-focus': '', value: R.ytDraft || '', placeholder: 'Paste a YouTube link…', oninput: (e) => { R.ytDraft = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') goYT(); } });
      const goYT = () => { const id = ytId(yurl.value); if (!id) { toast('That doesn’t look like a YouTube link', { icon: 'alert' }); return; } startContent(R, { contentType: 'youtube', videoId: id, title: 'YouTube video' }); R.ytDraft = ''; yurl.value = ''; };
      const busy = presentBusy ? h('div', { class: 'tiny muted row gap-s' }, h('span', { class: 'spin sm' }), presentBusy) : null;
      const lkOk = !!R.media.room;
      const items = [
        btn('screen', R.media.sharing ? 'Stop sharing screen' : 'Share your screen', () => R.toggleShare(), { group: 'media', cls: 'primary block', disabled: !lkOk }),
        lkOk ? null : note('Screen sharing needs the audio/video server, which isn’t connected right now.'),
        h('div', { class: 'sec-sub', style: { marginTop: '1rem' } }, 'Watch together'),
        h('div', { class: 'row gap-s' }, h('div', { class: 'grow' }, yurl), btn('youtube', 'Play', goYT, { group: 'content' })),
        h('div', { class: 'sec-sub', style: { marginTop: '1rem' } }, 'Slides, documents & images'),
        h('div', { class: 'row gap-s wrap' }, btn('upload', 'Upload PDF, slides, Word, Excel or images', () => pickContentFile(R), { group: 'content', disabled: !!presentBusy })),
        h('div', { class: 'sec-sub', style: { marginTop: '1rem' } }, 'Materials'),
        h('div', { class: 'tiny muted', style: { marginBottom: '.4rem' } }, 'Preloaded decks and links - present instantly without re-uploading.'),
        h('div', { class: 'materials-inline', 'data-materials': '1' }),
        h('div', { class: 'row gap-s wrap', style: { marginTop: '.4rem' } },
          btn('folder', 'Manage materials', () => { window.open('/materials', '_blank'); }, { group: 'content' }),
          btn('refresh', 'Refresh', async () => {
            try {
              const r = await api('/api/materials');
              R._materials = r.materials || [];
              R.panel.refresh('tools');
            } catch (e) { toastErr(e); }
          }, { group: 'content' }),
        ),
        busy,
      ].filter(Boolean);
      box.append(...items);
      fillMaterialsInline(R, box);
      return box;
    },
    sounds() {
      const box = h('div', { class: 'stack' });
      const off = R.security.sounds === false && !R.isMod();
      add(box, h('div', { class: 'sound-grid' }, SOUNDS.map((sd) => h('div', { class: 'sound-card' },
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
      box.append(h('div', { class: 'tool-hero', 'data-group': 'media' }, h('b', null, 'Recordings never leave your device'), note('The host and every co-host can each auto-record locally so a copy is saved even if one tab is lost. A single Recording notice is shown to everyone. Files stay on your device.')));
      if (R.me.role === 'host') {
        const rs = R.recording;
        box.append(h('div', { class: 'sec-sub' }, 'Session recording (everyone is notified)'),
          !rs || rs.status === 'stopped' ? btn('record', 'Start recording', () => R.send('start-recording', { audio: true, video: true, screenShare: true, chat: true }), { group: 'media', cls: 'primary block' })
            : h('div', { class: 'row gap-s' }, rs.status === 'paused' ? btn('play', 'Resume', () => R.send('resume-recording', {}), { group: 'media' }) : btn('pause', 'Pause', () => R.send('pause-recording', {}), { group: 'media' }), btn('stop', 'Stop & save', () => R.send('stop-recording', {}), { cls: 'danger grow' })));
      } else if (R.recording && R.recording.status !== 'stopped') box.append(h('div', { class: 'shade', 'data-group': 'media' }, h('b', null, '● The host is recording this session')));
      box.append(h('div', { class: 'sec-sub' }, 'On this device'),
        mine === 'idle' ? h('div', { class: 'col', style: { gap: '.45rem' } },
          R.isMod() ? note('Auto-record is off in Settings, or it could not start. You can still record manually.') : null,
          h('div', { class: 'row gap-s wrap' }, btn('video', 'Record screen + audio', () => R.recorder.start({ video: true, name: R.code }).catch(toastErr), { group: 'media' }), btn('mic', 'Audio only', () => R.recorder.start({ video: false, name: R.code + '-audio' }).catch(toastErr), { group: 'media' })))
          : h('div', { class: 'row gap-s wrap' }, h('span', { class: 'rec-dot' }), h('span', { class: 'grow' }, mine === 'paused' ? 'Paused' : 'Recording ' + fmtDur((Date.now() - R.recorder.started) / 1000)), mine === 'paused' ? btn('play', '', () => R.recorder.resume()) : btn('pause', '', () => R.recorder.pause()), btn('stop', 'Stop & save', () => { R.announceRecording(false); R.recorder.stop(); }, { cls: 'danger' })));
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
          btn('split', 'Open breakout rooms', () => R.send('breakout-create', { count: n }), { group: 'people', cls: 'primary block' }),
          R.me.role === 'host' ? btn('sparkles', 'Open backstage', () => R.send('breakout-open-backstage', {}), { group: 'people', cls: 'block' }) : null);
      } else {
        if (R.me.role === 'host') box.append(btn('sparkles', 'Open backstage', () => R.send('breakout-open-backstage', {}), { group: 'people', cls: 'block' }));
        box.append(btn('x', 'Close all rooms', () => R.send('breakout-close', {}), { cls: 'danger block' }));
        b.rooms.forEach((room) => box.append(h('div', { class: 'shade', 'data-group': 'people' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, room.name + (room.backstage ? ' · ticket perk' : '')), (R.isMod() || (room.backstage && R.me.ticket && R.me.ticket.perks && R.me.ticket.perks.backstage) || !room.backstage) ? btn('login', 'Visit', () => { if (room.backstage) R.send('breakout-join', { roomId: room.id }); else R.joinBreakout && R.joinBreakout(room); }, { cls: 'xs' }) : null),
          ...room.participantIds.map((pid) => { const p = R.p(pid); return h('div', { class: 'person' }, h('span', { class: 'grow' }, p ? p.name : pid), h('select', { class: 'input sm', onchange: (e) => R.send('breakout-move', { targetId: pid, roomId: e.target.value }) }, b.rooms.map((r) => h('option', { value: r.id, selected: r.id === room.id }, r.name)))); }))));
      }
      return box;
    },
    certs() {
      const box = h('div', { class: 'stack' });
      if (!R.isMod()) { box.append(note('Only the host or a co-host can turn certificates on.')); return box; }
      const current = (R.settings && R.settings.certs) || {};
      const accent = (R.theme && R.theme.accent) || '#2563eb';
      const editor = certEditor(current, {
        accent,
        eventTitle: R.eventTitle || R.name || R.title || '',
        hostName: R.hostName || (R.host && R.host.name) || '',
        startsAt: R.startsAt || R.eventStartsAt || '',
        endsAt: R.endsAt || R.eventEndsAt || '',
        onChange: (c) => { R._certsDraft = c; },
      });
      const save = async () => {
        const certs = (editor.get && editor.get()) || R._certsDraft || current;
        try {
          if (R.eventId) await api(`/api/events/${R.eventId}/certs`, { method: 'POST', body: certs });
          else if (R.code) await api(`/api/rooms/${R.code}/certs`, { method: 'POST', body: certs });
          R.settings = { ...(R.settings || {}), certs };
          toast('Certificates saved', { icon: 'check' });
        } catch (e) { toastErr(e); }
      };
      box.append(note('When the meeting ends, everyone who stayed long enough gets a PDF by Notification and email. Settings are saved for this session, including after it ends.'), editor,
        btn('check', 'Save', save, { group: 'content', cls: 'primary block' }));
      return box;
    },
    security() {
      const s = R.security;

      const set = (k) => (v) => R.send('update-security', { settings: { [k]: v } });
      const max = h('input', { class: 'input sm', type: 'number', min: 2, max: 1000, value: R.maxParticipants || '', style: { width: '90px' }, onchange: (e) => R.send('set-max-participants', { max: Number(e.target.value) }) });
      return h('div', { class: 'stack' },
        row('lock', 'Lock room', 'No new people can join', sw(s.locked, (v) => R.send(v ? 'lock-meeting' : 'unlock-meeting', {}))),
        R.joinRes?.venue ? row('door', 'Waiting room', 'Always on in a venue', h('span', { class: 'tiny muted' }, 'On')) : row('door', 'Waiting room', 'You admit everyone who joins', sw(s.waitingRoom, set('waitingRoom'))),
        row('user', 'Guest access', 'Allow people without an account', sw(s.guestAccess !== false, set('guestAccess'))),
        h('div', { class: 'sec-sub' }, 'Everyone can…'),
        row('mic', 'Unmute themselves', null, sw(s.participantMicrophone !== false, set('participantMicrophone'))),
        row('video', 'Turn on camera', null, sw(s.participantCamera !== false, set('participantCamera'))),
        row('screen', 'Share screen', null, sw(s.participantScreenShare !== false, set('participantScreenShare'))),
        row('chat', 'Send chat messages', null, sw(s.chat !== false, set('chat'))),
        row('smile', 'Send reactions', null, sw(s.reactions !== false, set('reactions'))),
        row('hand', 'Raise hand', null, sw(s.raiseHand !== false, set('raiseHand'))),
        row('music', 'Play sounds', 'Applause, drum roll… (rate-limited)', sw(s.sounds !== false, set('sounds'))),
        row('layout', 'Force audience view', 'Everyone follows the host’s grid / speaker / screenshare view', sw(!!s.forceLayout, (v) => { set('forceLayout')(v); if (v) R.send('force-layout', { layout: R.layout }); })),
        row('userPlus', 'Invite others', null, sw(s.participantsCanInvite !== false, set('participantsCanInvite'))),
        row('users', 'Max participants', 'Cap the room size', max),
        btn('refresh', 'Reset invite link', async () => { try { const r = await api('/api/invite/regenerate', { method: 'POST', headers: R.headers(), body: { code: R.code, participantId: R.me.id } }); R.inviteKey = r.key || r.inviteKey || null; toast('New invite link created - old links stop working', { icon: 'link', group: 'admin' }); } catch (e) { toastErr(e); } }, { cls: 'block' }),
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
      const put = (k, v, ok) => grid.append(h('div', { class: `set-card${ok === false ? ' bad' : ok ? ' good' : ''}` }, h('small', { class: 'muted' }, k), h('b', null, v ?? '-')));
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
      const keys = [['M', 'Mute / unmute'], ['V', 'Camera on / off'], ['S', 'Share screen'], ['H', 'Raise / lower hand'], ['C', 'Chat'], ['P', 'People'], ['E', 'Engage (polls, Q&A)'], ['G', 'Cycle layout'], ['F', 'Fullscreen'], ['O', 'Pop out / back to tab'], ['/', 'Command bar'], ['Ctrl K', 'Command bar'], ['Esc', 'Close panel / sheet']];
      return h('div', { class: 'list' }, keys.map(([k, l]) => h('div', { class: 'set-row' }, h('span', { class: 'kbd' }, k), h('span', { class: 'grow' }, l))), note('For a comfortable reading size, use Settings → Text size.'));
    },
  };
}
export { createBoard, boardToolbar, refLabel, debounce };
