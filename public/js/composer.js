// WhatsApp-style composer used by meeting chat, DMs, groups and feed comments.
// One pill: [emoji][attach] text… — then a round action button that is a mic when empty
// and turns into send as soon as there is text or an attachment.
import { h, toast, toastErr } from './ui.js';
import { icon } from './icons.js';
import { emojiPopover, searchEmoji, emojiName, pushRecent } from './emoji.js';

const fmtMB = (b) => (b / 1048576 >= 10 ? Math.round(b / 1048576) : Math.round(b / 104857.6) / 10) + ' MB';
const kindOf = (m) => (m.startsWith('image/') ? 'image' : m === 'application/pdf' ? 'pdf' : m.startsWith('audio/') ? 'audio' : m.startsWith('video/') ? 'video' : 'other');

/** Shrink a photo before upload (webp, longest side 1600). Returns a File. */
export async function shrinkImage(file, max = 1600, q = 0.82) {
  if (!/^image\/(png|jpe?g|webp|bmp)$/.test(file.type) || file.size < 350_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' }) : file;
  } catch { return file; }
}

/** Client-side copy of the server's upload limits, so people get a clear message before uploading. */
export function checkLimit(file, limits) {
  if (!limits) return null;
  const k = kindOf(file.type || '');
  const max = limits[k];
  const label = { image: 'Photos', pdf: 'PDFs', audio: 'Audio', video: 'Videos', other: 'Files' }[k];
  if (max === 0) return k === 'video' ? 'Video uploads are off — share a YouTube link instead.' : `${label} can’t be uploaded here`;
  if (max && file.size > max) return `${label} can be up to ${fmtMB(max)} (this one is ${fmtMB(file.size)})`;
  return null;
}

/**
 * @param {object} o
 * @param {string} o.placeholder
 * @param {(text:string, attachment:object|null)=>any} o.onSend
 * @param {(file:File, purpose:string)=>Promise<{url:string,mime:string,size:number,filename:string}>} [o.upload]
 * @param {boolean} [o.voice]   show the mic when empty (needs upload)
 * @param {object} [o.limits]   /api/config storage.limits
 * @param {object} [o.drafts]   object to persist drafts in; [o.draftKey]
 */
export function pillComposer({ placeholder = 'Message', onSend, upload, voice = !!upload, limits, drafts, draftKey, disabled = false, maxLength = 2000, suggest, accept = 'image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip,audio/*' } = {}) {
  const ta = h('textarea', { rows: 1, placeholder: disabled ? 'Chat is turned off by the host' : placeholder, disabled: !!disabled, 'data-focus': '', enterkeyhint: 'send', maxlength: maxLength, 'aria-label': placeholder });
  if (drafts && draftKey) ta.value = drafts[draftKey] || '';
  let pending = null, busy = false;
  const prev = h('div', { class: 'att-prev', hidden: true });
  const ib = (ic, label, run, cls = '') => h('button', { class: `wa-ib ${cls}`, type: 'button', 'aria-label': label, 'data-tip': label, disabled: !!disabled, onclick: run, html: icon(ic, { size: 20 }) });
  const fit = () => { if (!ta.offsetWidth) return; ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  if (typeof ResizeObserver !== 'undefined') { let w = 0; new ResizeObserver(() => { if (ta.offsetWidth !== w) { w = ta.offsetWidth; fit(); } }).observe(ta); }
  const paintPrev = () => {
    prev.hidden = !pending;
    if (!pending) return prev.replaceChildren();
    const thumb = pending.kind === 'image' && pending.preview ? h('img', { src: pending.preview, alt: '' }) : h('span', { class: 'i', html: icon(pending.kind === 'voice' ? 'mic' : 'paperclip', { size: 16 }) });
    prev.replaceChildren(thumb, h('span', { class: 'grow ellipsis' }, pending.uploading ? `Uploading ${pending.name}…` : pending.name),
      h('button', { class: 'wa-ib sm', type: 'button', 'aria-label': 'Remove attachment', html: icon('x', { size: 16 }), onclick: () => { pending = null; paintPrev(); paintAct(); } }));
  };
  const act = h('button', { class: 'wa-act', type: 'button', disabled: !!disabled });
  const hasContent = () => !!(ta.value.trim() || (pending && !pending.uploading));
  function paintAct() {
    const mode = rec ? 'stop' : hasContent() || !voice ? 'send' : 'mic';
    act.dataset.mode = mode;
    act.classList.toggle('rec', !!rec);
    act.classList.toggle('ready', hasContent());
    act.setAttribute('aria-label', mode === 'mic' ? 'Record voice note' : mode === 'stop' ? 'Stop and send voice note' : 'Send');
    act.dataset.tip = mode === 'mic' ? 'Voice note' : mode === 'stop' ? 'Send voice note' : 'Send (Enter)';
    act.innerHTML = icon(mode === 'mic' ? 'mic' : mode === 'stop' ? 'send' : 'send', { size: 19 });
  }
  // Suggestions row: sounds for the whole text, emoji for a trailing “:word”.
  const sugg = h('div', { class: 'wa-sugg', hidden: true });
  function paintSugg() {
    const t = ta.value, out = [];
    if (suggest) out.push(...(suggest(t.trim()) || []));
    const m = t.match(/(?:^|\s):([a-z]{2,20})$/i);
    if (m) searchEmoji(m[1], 8).forEach((e) => out.push({ glyph: e, label: '', tip: emojiName(e), run: () => { ta.value = t.slice(0, t.length - m[1].length - 1) + e; pushRecent(e); ta.dispatchEvent(new Event('input')); ta.focus(); } }));
    sugg.hidden = !out.length;
    sugg.replaceChildren(...out.slice(0, 10).map((x) => h('button', { type: 'button', class: `wa-chip${x.label ? '' : ' em'}`, 'data-tip': x.tip || null, onclick: () => x.run() }, x.glyph ? h('span', { class: 'g' }, x.glyph) : null, x.label || null)));
  }
  ta.addEventListener('input', () => { if (drafts && draftKey) drafts[draftKey] = ta.value; fit(); paintAct(); paintSugg(); });
  async function send() {
    if (busy || disabled) return;
    if (pending && pending.uploading) return toast('Still uploading…', { icon: 'upload' });
    const text = ta.value.trim();
    if (!text && !pending) return;
    const att = pending ? { kind: pending.kind, name: pending.name, mime: pending.mime, size: pending.size, url: pending.url } : null;
    busy = true;
    try {
      const r = await onSend(text, att);
      if (r === false) return;
      ta.value = ''; if (drafts && draftKey) drafts[draftKey] = ''; pending = null; paintPrev(); fit();
    } catch (e) { toastErr(e); } finally { busy = false; paintAct(); }
  }
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });

  // attachments ------------------------------------------------------------
  const file = h('input', { type: 'file', hidden: true, accept });
  async function attachFile(f, purpose = 'chat') {
    if (!upload) return;
    const prepared = f.type.startsWith('image/') ? await shrinkImage(f) : f;
    const why = checkLimit(prepared, limits);
    if (why) { toast(why, { icon: 'alert', group: 'admin', ms: 5000 }); return; }
    const kind = prepared.type.startsWith('image/') ? 'image' : purpose === 'voice' ? 'voice' : 'file';
    pending = { kind, name: f.name || 'file', mime: prepared.type || 'application/octet-stream', size: prepared.size, uploading: true, preview: kind === 'image' ? URL.createObjectURL(prepared) : null };
    const mine = pending; paintPrev(); paintAct();
    try {
      const r = await upload(prepared, purpose);
      if (pending !== mine) return;
      Object.assign(pending, { url: r.url, mime: r.mime || pending.mime, size: r.size || pending.size, uploading: false });
    } catch (e) { if (pending === mine) pending = null; toast(e.message || 'Upload failed', { icon: 'alert', group: 'admin', ms: 5000 }); }
    paintPrev(); paintAct();
  }
  file.onchange = () => { const f = file.files[0]; file.value = ''; if (f) attachFile(f); };
  ta.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f && upload) { e.preventDefault(); attachFile(f); } });

  // voice notes ------------------------------------------------------------
  let rec = null, recTimer = null, recStart = 0, cancelRec = false;
  const recBar = h('div', { class: 'wa-rec', hidden: true }, h('i', { class: 'dot' }), h('span', { class: 'grow t' }, '0:00'),
    h('button', { class: 'wa-ib sm', type: 'button', 'aria-label': 'Cancel recording', html: icon('trash', { size: 16 }), onclick: () => { cancelRec = true; rec && rec.stop(); } }));
  async function startRec() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const chunks = []; cancelRec = false;
      rec = new MediaRecorder(s, { audioBitsPerSecond: 32000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        s.getTracks().forEach((t) => t.stop()); clearInterval(recTimer);
        const mime = rec.mimeType || 'audio/webm'; rec = null; recBar.hidden = true; ta.hidden = false; paintAct();
        if (cancelRec || !chunks.length) return;
        const b = new File(chunks, 'Voice note.webm', { type: mime.split(';')[0] });
        try {
          const r = await upload(b, 'voice');
          await onSend('', { kind: 'voice', name: 'Voice note', mime: r.mime || b.type, size: r.size || b.size, url: r.url });
        } catch (e) { toast(e.message || 'Could not send voice note', { icon: 'alert', group: 'admin' }); }
      };
      rec.start(); recStart = Date.now(); recBar.hidden = false; ta.hidden = true; paintAct();
      recTimer = setInterval(() => { const s2 = Math.floor((Date.now() - recStart) / 1000); recBar.querySelector('.t').textContent = `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`; if (s2 >= 120) rec && rec.stop(); }, 250);
    } catch (e) { toast(e.name === 'NotAllowedError' ? 'Microphone permission is needed for voice notes' : (e.message || 'Microphone unavailable'), { icon: 'micOff', group: 'admin' }); }
  }
  act.onclick = () => { const m = act.dataset.mode; if (m === 'mic') startRec(); else if (m === 'stop') rec && rec.stop(); else send(); };

  const emojiBtn = ib('smile', 'Emoji', () => emojiPopover(emojiBtn, (e) => insertAtCaret(e), { keepOpen: true }));
  function insertAtCaret(t) {
    const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + t.length;
    ta.dispatchEvent(new Event('input')); ta.focus({ preventScroll: true });
  }
  const pill = h('div', { class: 'wa-pill' }, emojiBtn, upload ? ib('paperclip', 'Attach photo or file', () => file.click()) : null, ta, recBar, file);
  const el = h('div', { class: `wa${disabled ? ' off' : ''}` }, sugg, prev, h('div', { class: 'wa-row' }, pill, act));
  paintAct(); requestAnimationFrame(fit);
  const clear = () => { ta.value = ''; ta.dispatchEvent(new Event('input')); };
  return { el, ta, clear, focus: () => ta.focus(), insert: insertAtCaret, attachFile, setText: (v) => { ta.value = v; ta.dispatchEvent(new Event('input')); } };
}
