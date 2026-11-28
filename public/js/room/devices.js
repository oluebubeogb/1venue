// Auto-pick an available mic and a camera that produces content. Virtual add-ons
// (OBS, Snap, ManyCam, VB-Cable, Voicemeeter, NDI, "Virtual", …) go last.
import { AUDIO_CONSTRAINTS, devicePrefs, saveDevicePref, listDevices } from './media.js';
import { h, toast, toastErr } from '../ui.js';

export const VIRTUAL_RE = /\b(obs(?:[\s_-]*virtual)?|snap\s*camera|manycam|xsplit|e2esoft|\bvcam\b|cyberlink|vb-?audio|vb-?cable|voicemeeter|krisp|virtual|steam streaming|iriun|droidcam|ndi|newtek)\b/i;
const PER_MS = 1500;
const BUDGET_MS = 8000;
const SILENT_MS = 25000;
const SILENT_RMS = 0.005;

export function classifyDevice(d) {
  const label = String((d && d.label) || '');
  const virtual = VIRTUAL_RE.test(label);
  return { virtual, tag: virtual ? 'Virtual' : '' };
}

export function isDefaultDevice(d) {
  const id = String((d && d.deviceId) || '');
  const label = String((d && d.label) || '');
  return id === 'default' || id === 'communications' || /^default(?:\s|-|$)/i.test(label);
}

export function sortDevices(list, preferredId) {
  return [...(list || [])].sort((a, b) => {
    const ra = rank(a, preferredId), rb = rank(b, preferredId);
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

function rank(d, preferredId) {
  if (preferredId && d.deviceId === preferredId) return 0;
  if (isDefaultDevice(d)) return 1;
  if (classifyDevice(d).virtual) return 3;
  return 2;
}

export function optionLabel(d, report) {
  const base = (d && d.label) || 'Device';
  const bits = [];
  if (classifyDevice(d).virtual) bits.push('Virtual');
  if (report && report.ok === false) bits.push('Not responding');
  return bits.length ? `${base} · ${bits.join(' · ')}` : base;
}

export function saveWorkingPair(pair) {
  if (!pair) return;
  if (pair.audioinput) saveDevicePref('audioinput', pair.audioinput);
  if (pair.videoinput) saveDevicePref('videoinput', pair.videoinput);
  if (pair.audiooutput) {
    saveDevicePref('audiooutput', pair.audiooutput);
    try { localStorage.setItem('venue.speaker', JSON.stringify(pair.audiooutput)); } catch { /* */ }
  }
}

export async function warmup(audio, video) {
  if ((!audio && !video) || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: !!audio, video: !!video });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    if (audio && video) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); s.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    }
  }
}

function withTimeout(p, ms) {
  return new Promise((res) => {
    const t = setTimeout(() => res(false), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); res(!!v); }, () => { clearTimeout(t); res(false); });
  });
}

export async function probeMic(deviceId, ms = PER_MS) {
  return withTimeout((async () => {
    let stream;
    try {
      const specific = deviceId && deviceId !== 'default';
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO_CONSTRAINTS, deviceId: specific ? { exact: deviceId } : undefined },
        video: false,
      });
      // A quiet input still works. The preview meter shows signal when the user speaks.
      return stream.getAudioTracks().some((track) => track.readyState === 'live');
    } catch { return false; }
    finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  })(), ms);
}

function lumaStats(a, b) {
  let sum = 0, sum2 = 0, n = 0, diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const y = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11;
    const y2 = b[i] * 0.3 + b[i + 1] * 0.59 + b[i + 2] * 0.11;
    sum += y; sum2 += y * y; diff += Math.abs(y - y2); n += 1;
  }
  const mean = sum / n, variance = sum2 / n - mean * mean;
  return { mean, variance, diff, n };
}

export function framesHaveContent(a, b) {
  if (!a || !b || a.length < 16) return false;
  const { mean, variance, diff, n } = lumaStats(a, b);
  if (mean < 6 && variance < 8) return false;
  if (variance < 8) return false;
  if (diff < n * 0.15 && variance < 40) return false;
  return true;
}

export async function probeCam(deviceId, ms = PER_MS) {
  return withTimeout((async () => {
    let stream, video;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 15 } } });
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') return false;
      let ended = false;
      track.addEventListener('ended', () => { ended = true; });
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play().catch(() => {});
      const t0 = performance.now();
      while (performance.now() - t0 < ms - 400 && !(video.readyState >= 2 && video.videoWidth)) await new Promise((r) => setTimeout(r, 50));
      if (ended || !video.videoWidth) return false;
      const c = document.createElement('canvas');
      c.width = 32; c.height = 18;
      const g = c.getContext('2d', { willReadFrequently: true });
      const snap = () => { g.drawImage(video, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height).data; };
      const a = snap();
      await new Promise((r) => setTimeout(r, 250));
      return framesHaveContent(a, snap());
    } catch { return false; }
    finally {
      if (video) { try { video.srcObject = null; } catch { /* */ } }
      stream && stream.getTracks().forEach((t) => t.stop());
    }
  })(), ms);
}

export async function pickWorking({ wantAudio = true, wantVideo = true, budgetMs = BUDGET_MS } = {}) {
  await warmup(wantAudio, wantVideo);
  const list = await listDevices();
  const prefs = devicePrefs();
  const start = Date.now();
  const reports = { audioinput: [], videoinput: [] };
  const run = async (kind, probe) => {
    const ordered = sortDevices(list[kind] || [], prefs[kind]);
    if (kind === 'audioinput' && !ordered.some((d) => d.deviceId === 'default')) {
      ordered.push({ deviceId: 'default', label: 'Default microphone' });
    }
    let picked = null;
    for (const d of ordered) {
      if (Date.now() - start > budgetMs) {
        reports[kind].push({ deviceId: d.deviceId, label: d.label, ok: null, ...classifyDevice(d) });
        continue;
      }
      const ok = await probe(d.deviceId, PER_MS);
      reports[kind].push({ deviceId: d.deviceId, label: d.label, ok, ...classifyDevice(d) });
      if (ok && !picked) picked = d.deviceId;
      if (picked) {
        // First working wins; mark the rest untested so join stays fast.
        for (const rest of ordered) {
          if (reports[kind].some((r) => r.deviceId === rest.deviceId)) continue;
          reports[kind].push({ deviceId: rest.deviceId, label: rest.label, ok: null, ...classifyDevice(rest) });
        }
        break;
      }
    }
    if (picked) saveDevicePref(kind, picked);
    return picked;
  };
  const audioinput = wantAudio ? await run('audioinput', probeMic) : prefs.audioinput || null;
  const videoinput = wantVideo ? await run('videoinput', probeCam) : prefs.videoinput || null;
  return { audioinput, videoinput, reports, list };
}

export async function tryNext(kind, currentId) {
  if (kind === 'audiooutput') {
    const list = sortDevices((await listDevices()).audiooutput || [], currentId);
    const idx = Math.max(0, list.findIndex((d) => d.deviceId === currentId));
    const next = list[(idx + 1) % Math.max(list.length, 1)];
    return next || null;
  }
  await warmup(kind === 'audioinput' || kind === 'audiooutput', kind === 'videoinput');
  const list = sortDevices((await listDevices())[kind] || [], devicePrefs()[kind] || currentId);
  const idx = Math.max(0, list.findIndex((d) => d.deviceId === currentId));
  const rotated = idx < 0 ? list : [...list.slice(idx + 1), ...list.slice(0, idx)];
  for (const d of rotated) {
    const ok = kind === 'audioinput' ? await probeMic(d.deviceId) : await probeCam(d.deviceId);
    if (ok) { saveDevicePref(kind, d.deviceId); return d; }
  }
  return null;
}

export async function playTestSound(sinkId) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  await ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
  osc.connect(gain);
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  if (!sinkId || !HTMLMediaElement.prototype.setSinkId) gain.connect(ctx.destination);
  const audio = new Audio();
  audio.srcObject = dest.stream;
  if (sinkId && audio.setSinkId) await audio.setSinkId(sinkId).catch(() => {});
  await audio.play().catch(() => {});
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
  await new Promise((r) => setTimeout(r, 550));
  audio.pause();
  audio.srcObject = null;
  await ctx.close().catch(() => {});
}

export function startWatchdog(room) {
  let silentMs = 0, offered = false, lastMic, lastCam, ac, src, unsub = [];
  const inputOn = (kind) => room.alive && (kind === 'audioinput' ? room.media?.mic : room.media?.cam);
  const hook = (track, kind) => {
    if (!track || track._venueEndedHook) return;
    track._venueEndedHook = true;
    const onEnd = () => { switchKind(kind); };
    track.addEventListener('ended', onEnd);
    unsub.push(() => { try { track.removeEventListener('ended', onEnd); } catch { /* */ } });
  };
  const switchKind = async (kind) => {
    if (!inputOn(kind) || (kind === 'videoinput' && room.media.cameraSwitch)) return false;
    const cur = devicePrefs()[kind];
    const next = await tryNext(kind, cur);
    if (!inputOn(kind)) return false;
    if (!next) { toast(kind === 'audioinput' ? 'Couldn’t find another working microphone' : 'Couldn’t find another working camera', { icon: 'alert', group: 'media' }); return false; }
    try {
      await room.media?.switchDevice(kind, next.deviceId);
      toast('Switched to ' + (next.label || 'another device'), { icon: 'check', group: 'media', ms: 2800 });
      return true;
    } catch (e) { toastErr(e); return false; }
  };
  const onChange = async () => {
    const list = await listDevices();
    const prefs = devicePrefs();
    for (const kind of ['audioinput', 'videoinput']) {
      if (prefs[kind] && !(list[kind] || []).some((d) => d.deviceId === prefs[kind])) await switchKind(kind);
    }
  };
  navigator.mediaDevices?.addEventListener('devicechange', onChange);
  const closeMeter = () => { try { src && src.disconnect(); } catch { /* */ } src = null; try { ac && ac.close(); } catch { /* */ } ac = null; };
  const tick = async () => {
    if (!room.alive || !room.media) return;
    const mic = room.media.micTrack && room.media.micTrack();
    const cam = room.media.camTrack && room.media.camTrack();
    if (mic && mic !== lastMic) { lastMic = mic; hook(mic, 'audioinput'); closeMeter(); }
    if (cam && cam !== lastCam) { lastCam = cam; hook(cam, 'videoinput'); }
    if (!(room.media.mic && mic && mic.readyState === 'live')) { silentMs = 0; offered = false; closeMeter(); return; }
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        await ac.resume().catch(() => {});
        const an = ac.createAnalyser();
        an.fftSize = 1024;
        src = ac.createMediaStreamSource(new MediaStream([mic]));
        src.connect(an);
        ac._an = an;
      }
      const data = new Uint8Array(ac._an.fftSize);
      ac._an.getByteTimeDomainData(data);
      let s = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; }
      const rms = Math.sqrt(s / data.length);
      if (rms > SILENT_RMS) { silentMs = 0; offered = false; }
      else {
        silentMs += 1000;
        if (silentMs >= SILENT_MS && !offered) {
          offered = true;
          toast('Your microphone seems silent. Try the next device?', { icon: 'micOff', group: 'media', ms: 9000, action: { label: 'Switch', run: () => switchKind('audioinput') } });
        }
      }
    } catch { closeMeter(); }
  };
  const timer = setInterval(tick, 1000);
  tick();
  return () => {
    clearInterval(timer);
    navigator.mediaDevices?.removeEventListener('devicechange', onChange);
    unsub.forEach((f) => f());
    closeMeter();
  };
}


const CARET = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" fill="currentColor"/></svg>';

export function deviceChoice(d, report) {
  const label = (d && d.label) || 'Device';
  const tags = [];
  if (classifyDevice(d).virtual) tags.push('Virtual');
  if (report && report.ok === false) tags.push('Not responding');
  return { id: d.deviceId, label, tags };
}

export function bindDevicePicker(select, { getItems, onPick } = {}) {
  const wrap = select.parentElement;
  wrap.classList.add('pj-picker');
  select.classList.add('pj-dev-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const val = h('span', { class: 'pj-dev-val' });
  const btn = h('button', { class: 'au-pill pj-field pj-dev-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, val, h('span', { class: 'pj-caret', html: CARET }));
  const menu = h('div', { class: 'pj-dev-menu', role: 'listbox', hidden: true });
  const lab = select.getAttribute('aria-label') || 'Device';
  btn.setAttribute('aria-label', lab);
  wrap.append(btn, menu);
  let items = [], iOpen = -1, open = false;

  const paintBtn = () => {
    const cur = items.find((x) => x.selected) || items[0];
    val.textContent = cur ? cur.label : 'Select a device';
    btn.setAttribute('aria-label', select.getAttribute('aria-label') || lab);
  };
  const paintMenu = () => {
    menu.replaceChildren(...items.map((it, i) => {
      const row = h('button', { class: 'pj-dev-opt' + (it.selected ? ' on' : ''), type: 'button', role: 'option', 'aria-selected': String(!!it.selected), 'data-id': it.id },
        h('span', { class: 'pj-dev-name' }, it.label),
        ...(it.tags || []).map((t) => h('span', { class: 'pj-pill' + (t === 'Not responding' ? ' dim' : '') }, t)));
      row.onmousedown = (e) => e.preventDefault();
      row.onclick = () => pick(it.id);
      if (i === iOpen) row.classList.add('focus');
      return row;
    }));
  };
  const close = () => {
    if (!open) return;
    open = false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    iOpen = -1;
    paintMenu();
  };
  const show = () => {
    refresh();
    if (!items.length) return;
    open = true;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    iOpen = Math.max(0, items.findIndex((x) => x.selected));
    paintMenu();
    const row = menu.children[iOpen];
    row && row.scrollIntoView({ block: 'nearest' });
  };
  const pick = (id) => {
    close();
    if (id && select.value !== id) {
      select.value = id;
      onPick ? onPick(id) : select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    btn.focus();
  };
  const move = (dir) => {
    if (!items.length) return;
    iOpen = (iOpen + dir + items.length) % items.length;
    paintMenu();
    const row = menu.children[iOpen];
    row && row.scrollIntoView({ block: 'nearest' });
  };
  const refresh = () => {
    items = (getItems && getItems()) || [...select.options].map((o) => ({ id: o.value, label: o.textContent, tags: [], selected: o.selected }));
    paintBtn();
    if (open) paintMenu();
  };
  btn.onclick = () => { open ? close() : show(); };
  btn.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) show(); else move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open && iOpen >= 0) pick(items[iOpen].id); else show(); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Home' && open) { e.preventDefault(); iOpen = 0; paintMenu(); }
    else if (e.key === 'End' && open) { e.preventDefault(); iOpen = items.length - 1; paintMenu(); }
  };
  const onDoc = (e) => { if (open && !wrap.contains(e.target)) close(); };
  document.addEventListener('pointerdown', onDoc);
  return {
    refresh,
    destroy() { close(); document.removeEventListener('pointerdown', onDoc); btn.remove(); menu.remove(); select.classList.remove('pj-dev-native'); },
  };
}
