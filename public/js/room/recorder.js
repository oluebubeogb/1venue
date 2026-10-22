// Local recording: everything stays on the user's device (download when done).
// Captures this tab (video + system audio) and mixes in your mic + every remote audio track.
import { download, toast } from '../ui.js';

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
  pause() { if (this.rec && this.state === 'recording') { this.rec.pause(); this.state = 'paused'; this.onChange && this.onChange(this.state); } }
  resume() { if (this.rec && this.state === 'paused') { this.rec.resume(); this.state = 'recording'; this.onChange && this.onChange(this.state); } }
  stop() { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); }
  finish() {
    const type = this.rec?.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    if (this.display) this.display.getTracks().forEach((t) => t.stop());
    this.ac && this.ac.close().catch(() => {});
    this.rec = null; this.state = 'idle'; this.onChange && this.onChange(this.state);
    if (blob.size) { download(`${this.name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`, blob, type); toast('Recording saved to your device', { icon: 'download', group: 'media' }); }
  }
}
