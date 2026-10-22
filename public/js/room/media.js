// LiveKit media layer: simulcast + bitrate caps for a small VPS, device switching, screen share,
// background blur, and a local-only fallback preview when no SFU is configured.
let lkPromise = null;
export function loadLiveKit() {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  lkPromise ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/livekit-client.umd.js'; s.onload = () => res(window.LivekitClient); s.onerror = () => rej(new Error('Could not load media engine')); document.head.append(s); });
  return lkPromise;
}

const PREF_KEY = 'venue.devices';
export const devicePrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } };
export const saveDevicePref = (kind, id) => localStorage.setItem(PREF_KEY, JSON.stringify({ ...devicePrefs(), [kind]: id }));
export async function listDevices() {
  try { const d = await navigator.mediaDevices.enumerateDevices(); return { audioinput: d.filter((x) => x.kind === 'audioinput'), videoinput: d.filter((x) => x.kind === 'videoinput'), audiooutput: d.filter((x) => x.kind === 'audiooutput') }; }
  catch { return { audioinput: [], videoinput: [], audiooutput: [] }; }
}
export const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export class Media {
  constructor({ onTrack, onTrackGone, onSpeakers, onState, onQuality, onLocal } = {}) {
    Object.assign(this, { onTrack, onTrackGone, onSpeakers, onState, onQuality, onLocal });
    this.room = null; this.LK = null; this.mic = false; this.cam = false; this.sharing = false; this.state = 'idle';
    this.localStream = null; // fallback preview stream when LiveKit is off
    this.grants = { canPublish: true };
    this.caps = null;
  }
  setState(s, detail) { this.state = s; this.onState && this.onState(s, detail); }
  async connect({ url, token, media }) {
    const LK = this.LK = await loadLiveKit();
    const m = media || {};
    const v = { maxBitrate: m.videoMaxBitrate, maxFramerate: m.videoMaxFps, maxHeight: m.videoResolution === '540p' ? 540 : m.videoResolution === '360p' ? 360 : 720 }, sc = { maxBitrate: m.screenMaxBitrate, maxFramerate: m.screenMaxFps };
    const room = new LK.Room({
      adaptiveStream: m.adaptiveStream !== false, dynacast: m.dynacast !== false,
      videoCaptureDefaults: { resolution: (v.maxHeight || 720) >= 720 ? LK.VideoPresets.h720.resolution : LK.VideoPresets.h540.resolution, deviceId: devicePrefs().videoinput },
      audioCaptureDefaults: { ...AUDIO_CONSTRAINTS, deviceId: devicePrefs().audioinput },
      publishDefaults: {
        simulcast: m.simulcast !== false,
        videoSimulcastLayers: [LK.VideoPresets.h180, LK.VideoPresets.h360],
        videoEncoding: { maxBitrate: v.maxBitrate || 1_200_000, maxFramerate: v.maxFramerate || 24 },
        screenShareEncoding: { maxBitrate: sc.maxBitrate || 2_500_000, maxFramerate: sc.maxFramerate || 15 },
        dtx: true, red: true, audioPreset: LK.AudioPresets ? (LK.AudioPresets[m.audioPreset || 'speech'] || LK.AudioPresets.speech) : undefined,
      },
    });
    this.room = room;
    const E = LK.RoomEvent;
    room.on(E.TrackSubscribed, (track, pub, p) => this.onTrack && this.onTrack(p.identity, track, pub.source))
      .on(E.TrackUnsubscribed, (track, pub, p) => this.onTrackGone && this.onTrackGone(p.identity, track, pub.source))
      .on(E.TrackMuted, (pub, p) => this.onTrackGone && pub.kind === 'video' && this.onTrackGone(p.identity, pub.track, pub.source, true))
      .on(E.TrackUnmuted, (pub, p) => pub.track && this.onTrack && this.onTrack(p.identity, pub.track, pub.source))
      .on(E.LocalTrackPublished, (pub) => { this.onTrack && pub.track && this.onTrack(room.localParticipant.identity, pub.track, pub.source, true); this.syncLocal(); })
      .on(E.LocalTrackUnpublished, (pub) => { this.onTrackGone && this.onTrackGone(room.localParticipant.identity, pub.track, pub.source); this.syncLocal(); })
      .on(E.ActiveSpeakersChanged, (sp) => this.onSpeakers && this.onSpeakers(sp.map((s) => s.identity)))
      .on(E.ConnectionQualityChanged, (q, p) => this.onQuality && this.onQuality(p.identity, q))
      .on(E.Reconnecting, () => this.setState('reconnecting'))
      .on(E.Reconnected, () => this.setState('connected'))
      .on(E.Disconnected, (reason) => this.setState('disconnected', reason))
      .on(E.ParticipantPermissionsChanged, () => this.syncLocal())
      .on(E.MediaDevicesError, (e) => this.setState('device-error', e));
    this.setState('connecting');
    await room.connect(url, token, { autoSubscribe: true });
    this.setState('connected');
    try { await room.startAudio(); } catch { /* needs gesture; handled by UI */ }
    return room;
  }
  syncLocal() {
    const lp = this.room && this.room.localParticipant; if (!lp) return;
    this.mic = lp.isMicrophoneEnabled; this.cam = lp.isCameraEnabled; this.sharing = lp.isScreenShareEnabled;
    this.onLocal && this.onLocal({ mic: this.mic, cam: this.cam, sharing: this.sharing });
  }
  async setMic(on) {
    if (this.room) { await this.room.localParticipant.setMicrophoneEnabled(on, { ...AUDIO_CONSTRAINTS, deviceId: devicePrefs().audioinput }); this.syncLocal(); return this.mic; }
    this.mic = on; await this.fallback(); this.onLocal && this.onLocal({ mic: this.mic, cam: this.cam, sharing: this.sharing }); return on;
  }
  async setCam(on) {
    if (this.room) { await this.room.localParticipant.setCameraEnabled(on, { deviceId: devicePrefs().videoinput }); this.syncLocal(); return this.cam; }
    this.cam = on; await this.fallback(); this.onLocal && this.onLocal({ mic: this.mic, cam: this.cam, sharing: this.sharing }); return on;
  }
  async setShare(on, quality = 'auto') {
    if (!this.room) throw new Error('Screen sharing needs the media server (LiveKit) to be configured');
    const LK = this.LK;
    const res = { high: LK.ScreenSharePresets.h1080fps15, medium: LK.ScreenSharePresets.h720fps15, low: LK.ScreenSharePresets.h720fps5, auto: LK.ScreenSharePresets.h720fps15 }[quality] || LK.ScreenSharePresets.h720fps15;
    await this.room.localParticipant.setScreenShareEnabled(on, { audio: true, resolution: res.resolution, contentHint: 'detail', selfBrowserSurface: 'include', surfaceSwitching: 'include', systemAudio: 'include' }, { screenShareEncoding: res.encoding, videoCodec: 'vp8' });
    this.syncLocal(); return this.sharing;
  }
  // Local preview stream when LiveKit is not configured (keeps the room usable for chat/stage/scripture etc.)
  async fallback() {
    const want = { audio: this.mic, video: this.cam };
    if (this.localStream) this.localStream.getTracks().forEach((t) => { if (!want[t.kind === 'audio' ? 'audio' : 'video']) { t.stop(); this.localStream.removeTrack(t); } });
    const need = [];
    if (want.audio && !(this.localStream && this.localStream.getAudioTracks().length)) need.push('audio');
    if (want.video && !(this.localStream && this.localStream.getVideoTracks().length)) need.push('video');
    if (need.length) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: need.includes('audio') ? { ...AUDIO_CONSTRAINTS, deviceId: devicePrefs().audioinput } : false, video: need.includes('video') ? { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: devicePrefs().videoinput } : false });
      this.localStream ||= new MediaStream();
      s.getTracks().forEach((t) => this.localStream.addTrack(t));
    }
    const v = this.localStream && this.localStream.getVideoTracks()[0];
    if (v) this.onTrack && this.onTrack('__local', { kind: 'video', mediaStreamTrack: v, attach: (el) => { el.srcObject = new MediaStream([v]); el.play().catch(() => {}); return el; }, detach: () => [] }, 'camera', true);
    else this.onTrackGone && this.onTrackGone('__local', null, 'camera');
  }
  micTrack() {
    if (this.room) { const p = this.room.localParticipant.getTrackPublication(this.LK.Track.Source.Microphone); return p && p.track && p.track.mediaStreamTrack; }
    return this.localStream && this.localStream.getAudioTracks()[0];
  }
  remoteAudioTracks() {
    if (!this.room) return [];
    const out = [];
    this.room.remoteParticipants.forEach((p) => p.audioTrackPublications.forEach((pub) => pub.track && out.push(pub.track.mediaStreamTrack)));
    return out;
  }
  async switchDevice(kind, id) { saveDevicePref(kind, id); if (this.room) await this.room.switchActiveDevice(kind, id); else if (kind !== 'audiooutput') { if (this.localStream) { this.localStream.getTracks().forEach((t) => t.stop()); this.localStream = null; } await this.fallback(); } }
  async stats() {
    if (!this.room) return null;
    const out = { participants: this.room.numParticipants, state: this.room.state, region: this.room.serverInfo?.region || '', version: this.room.serverInfo?.version || '' };
    try {
      const pc = this.room.engine?.pcManager?.publisher?.pc || this.room.engine?.publisher?.pc;
      if (pc) { const r = await pc.getStats(); r.forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'video' && s.frameHeight) { out.sendRes = `${s.frameWidth}×${s.frameHeight}@${Math.round(s.framesPerSecond || 0)}`; } if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) out.rtt = Math.round(s.currentRoundTripTime * 1000) + ' ms'; if (s.type === 'candidate-pair' && s.availableOutgoingBitrate) out.uplink = Math.round(s.availableOutgoingBitrate / 1000) + ' kbps'; }); }
    } catch { /* ignore */ }
    return out;
  }
  async disconnect() {
    try { if (this.room) await this.room.disconnect(true); } catch { /* ignore */ }
    this.room = null;
    if (this.localStream) { this.localStream.getTracks().forEach((t) => t.stop()); this.localStream = null; }
  }
}
