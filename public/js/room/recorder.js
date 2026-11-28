// Local recording: everything stays on the user's device (download when done).
// Captures this tab (video + system audio) and mixes in your mic + every remote audio track.
import { download, toast } from '../ui.js';

const sessionRecordings = new Map();
export const pendingSessionRecording = (id) => sessionRecordings.get(String(id));
export function clearSessionRecording(id, recording) {
  if (pendingSessionRecording(id) === recording) sessionRecordings.delete(String(id));
}

export class LocalRecorder {
  constructor(media) { this.media = media; this.rec = null; this.state = 'idle'; this.started = 0; this.paused = 0; }
  async start({ video = true, name = 'recording' } = {}) {
    if (this.rec) return;
    this.name = name;
    const ac = this.ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    const add = (t) => { try { ac.createMediaStreamSource(new MediaStream([t])).connect(dest); } catch { /* */ } };
    let display = null;
    if (video && navigator.mediaDevices.getDisplayMedia) {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 24, displaySurface: 'browser' }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' });
      display.getAudioTracks().forEach(add);
    }
    const mic = this.media.micTrack(); if (mic) add(mic);
    this.media.remoteAudioTracks().forEach(add);
    const tracks = [...(display ? display.getVideoTracks() : []), ...dest.stream.getAudioTracks()];
    this.display = display;
    const stream = new MediaStream(tracks);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m) && (display || m.startsWith('audio')));
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.finish();
    if (display) display.getVideoTracks()[0].addEventListener('ended', () => this.stop());
    this.rec.start(1000); this.state = 'recording'; this.started = Date.now();
    this.onChange && this.onChange(this.state);
  }
  /** Auto-record without a screen-share prompt: composite stage videos onto a canvas and mix LiveKit audio. */
  async startLocal({ name = 'recording', getVideos } = {}) {
    if (this.rec) return;
    this.name = name;
    this.mode = 'local';
    this.getVideos = getVideos;
    const canvas = this.canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const c = canvas.getContext('2d', { alpha: false });
    const ac = this.ac = new AudioContext();
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const dest = this.dest = ac.createMediaStreamDestination();
    this.audioAdded = new Set();
    this.syncAudio = () => {
      if (!this.dest || !this.ac) return;
      const tracks = [];
      try { const mic = this.media.micTrack(); if (mic) tracks.push(mic); } catch { /* */ }
      try { this.media.remoteAudioTracks().forEach((t) => tracks.push(t)); } catch { /* */ }
      for (const t of tracks) {
        const id = t.id || t.label;
        if (!id || this.audioAdded.has(id)) continue;
        try { this.ac.createMediaStreamSource(new MediaStream([t])).connect(this.dest); this.audioAdded.add(id); } catch { /* */ }
      }
    };
    this.syncAudio();
    const draw = () => {
      const w = canvas.width, h = canvas.height;
      c.fillStyle = '#0b1020'; c.fillRect(0, 0, w, h);
      const vids = ((this.getVideos && this.getVideos()) || []).filter((v) => v.readyState >= 2 && v.videoWidth);
      if (vids.length) {
        const n = vids.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const tw = w / cols, th = h / rows;
        vids.forEach((v, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          const scale = Math.min(tw / v.videoWidth, th / v.videoHeight);
          const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
          try { c.drawImage(v, col * tw + (tw - dw) / 2, row * th + (th - dh) / 2, dw, dh); } catch { /* */ }
        });
      } else {
        c.fillStyle = '#fff'; c.font = '600 28px Inter, system-ui, sans-serif';
        c.fillText('1venue', 48, h / 2);
      }
      if (Date.now() - (this._audAt || 0) > 2000) { this._audAt = Date.now(); this.syncAudio(); }
      this.raf = requestAnimationFrame(draw);
    };
    draw();
    let vstream = null;
    try { vstream = canvas.captureStream(15); } catch { vstream = null; }
    const tracks = [...(vstream ? vstream.getVideoTracks() : []), ...dest.stream.getAudioTracks()];
    if (!tracks.length) { this.teardownLocal(); throw new Error('Recording is not available in this browser'); }
    const stream = new MediaStream(tracks);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m) && (vstream || m.startsWith('audio')));
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96000 });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => this.finish();
    this.rec.start(1000); this.state = 'recording'; this.started = Date.now();
    this.onChange && this.onChange(this.state);
  }
  teardownLocal() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.canvas && this.canvas.captureStream) {
      try { this.canvas.getContext('2d'); } catch { /* */ }
    }
    this.canvas = null; this.dest = null; this.getVideos = null; this.audioAdded = null;
  }
  pause() { if (this.rec && this.state === 'recording') { this.rec.pause(); this.state = 'paused'; this.onChange && this.onChange(this.state); } }
  resume() { if (this.rec && this.state === 'paused') { this.rec.resume(); this.state = 'recording'; this.onChange && this.onChange(this.state); } }
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); }
  stopForSession(id) {
    if (!this.rec || this.completeSessionRecording) return;
    const key = String(id);
    const pending = new Promise((resolve) => { this.completeSessionRecording = resolve; });
    sessionRecordings.set(key, pending);
    try {
      this.stop();
    } catch {
      // Preserve the chunks we have if the browser won't finish the recorder.
      this.finish();
    }
  }
  fileName() { return `${this.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`; }
  trySave() {
    if (!this.chunks || !this.chunks.length) return false;
    const type = (this.rec && this.rec.mimeType) || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    if (!blob.size) return false;
    try { download(this.fileName(), blob, type); return true; } catch { return false; }
  }
  finish() {
    if (!this.rec) return;
    const type = this.rec?.mimeType || 'video/webm';
    const blob = new Blob(this.chunks || [], { type });
    const name = this.fileName();
    const complete = this.completeSessionRecording;
    this.completeSessionRecording = null;
    if (this.display) this.display.getTracks().forEach((t) => t.stop());
    this.teardownLocal();
    this.ac && this.ac.close().catch(() => {});
    this.ac = null; this.rec = null; this.state = 'idle'; this.mode = null;
    this.chunks = [];
    if (complete) complete(blob.size ? { name, blob, type } : null);
    this.onChange && this.onChange(this.state);
    if (!complete && blob.size) { download(name, blob, type); toast('Recording saved to your device', { icon: 'download', group: 'media' }); }
  }
}
