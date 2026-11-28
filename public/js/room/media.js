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
const cameraFacingFromLabel = (label = '') => {
  if (/\b(back|rear|environment)\b/i.test(label)) return 'environment';
  if (/\b(front|user|facetime)\b/i.test(label)) return 'user';
  return null;
};

function waitForCapture(track, signal) {
  const error = () => new Error(track.kind === 'audio' ? 'Your microphone did not start' : 'Your camera did not start');
  if (track.readyState !== 'live') throw error();
  if (!track.muted || signal.aborted) return;
  return new Promise((resolve, reject) => {
    const done = (failure) => {
      clearTimeout(timer);
      track.removeEventListener('unmute', check);
      track.removeEventListener('ended', check);
      signal.removeEventListener('abort', check);
      if (failure) reject(failure);
      else resolve();
    };
    const check = () => {
      if (signal.aborted) done();
      else if (track.readyState !== 'live') done(error());
      else if (!track.muted) done();
    };
    const timer = setTimeout(() => done(error()), 2500);
    track.addEventListener('unmute', check);
    track.addEventListener('ended', check);
    signal.addEventListener('abort', check);
    check();
  });
}

export class Media {
  constructor({ onTrack, onTrackGone, onSpeakers, onState, onQuality, onLocal } = {}) {
    Object.assign(this, { onTrack, onTrackGone, onSpeakers, onState, onQuality, onLocal });
    this.room = null; this.LK = null; this.mic = false; this.cam = false; this.sharing = false; this.state = 'idle';
    this.localStream = null; // fallback preview stream when LiveKit is off
    this.preparedInputs = new Map();
    this.pendingInputs = new Map();
    this.cameraFacings = new Map();
    this.grants = { canPublish: true };
    this.caps = null;
  }
  setState(s, detail) { this.state = s; this.onState && this.onState(s, detail); }
  isExpectedDisconnect(reason) {
    const reasons = this.LK?.DisconnectReason;
    return reason != null && !!reasons
      && [reasons.CLIENT_INITIATED, reasons.ROOM_DELETED, reasons.PARTICIPANT_REMOVED].includes(reason);
  }
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
        screenShareEncoding: { maxBitrate: Math.min(sc.maxBitrate || 1_200_000, 1_500_000), maxFramerate: Math.min(sc.maxFramerate || 12, 15) },
        screenShareSimulcastLayers: [],
        dtx: true, red: true, audioPreset: LK.AudioPresets ? (LK.AudioPresets[m.audioPreset || 'speech'] || LK.AudioPresets.speech) : undefined,
      },
    });
    this.room = room; this.screenCap = sc;
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
  prepareInputs(tracks) {
    for (const track of tracks) {
      track.enabled = false;
      this.preparedInputs.set(track.kind, track);
    }
  }
  activatePreparedInput(track, activate) {
    const { kind } = track;
    const controller = new AbortController();
    const pending = { track, controller };
    this.pendingInputs.set(kind, pending);
    pending.result = (async () => {
      let activated = false;
      try {
        track.enabled = true;
        await waitForCapture(track, controller.signal);
        if (controller.signal.aborted) return false;
        // Publish the working setup track itself. Keep a disabled copy for a
        // later local toggle or reconnect, when the active track is stopped.
        this.prepareInputs([track.clone()]);
        await activate(track);
        activated = !controller.signal.aborted;
        return activated;
      } catch (error) {
        if (controller.signal.aborted) return false;
        throw error;
      } finally {
        if (!activated) {
          if (this.preparedInputs.get(kind) === track) track.enabled = false;
          else track.stop();
        }
        if (this.pendingInputs.get(kind) === pending) this.pendingInputs.delete(kind);
      }
    })();
    return pending.result;
  }
  setMic(on) { return this.setInput('audio', on); }
  setCam(on) {
    if (!on && this.cameraSwitch) this.cameraSwitch.cancelled = true;
    return this.setInput('video', on);
  }
  async setInput(kind, on) {
    const isMic = kind === 'audio';
    const key = isMic ? 'mic' : 'cam';
    const room = this.room;
    const pending = this.pendingInputs.get(kind);
    if (pending) {
      if (on) {
        await pending.result;
        return this[key];
      }
      pending.controller.abort();
      pending.track.enabled = false;
      await pending.result.catch(() => {});
      if (this.room !== room) return this[key];
    }
    const prepared = this.preparedInputs.get(kind);
    if (room) {
      const participant = room.localParticipant;
      const source = isMic ? this.LK.Track.Source.Microphone : this.LK.Track.Source.Camera;
      let publication = participant.getTrackPublication(source);
      if (on && publication?.track?.mediaStreamTrack.readyState === 'ended'
        && (publication.track.isUserProvided || prepared?.readyState === 'live')) {
        await participant.unpublishTrack(publication.track);
        publication = null;
      }
      if (on && prepared?.readyState === 'live' && !publication) {
        const activated = await this.activatePreparedInput(prepared, (track) => participant.publishTrack(track, { source }));
        if (!activated) return this[key];
      } else if (isMic) {
        await participant.setMicrophoneEnabled(on, { ...AUDIO_CONSTRAINTS, deviceId: devicePrefs().audioinput });
      } else {
        const camera = await participant.setCameraEnabled(on, { deviceId: devicePrefs().videoinput });
        if (on && camera?.track && !camera.track.isUserProvided) {
          // The meeting manages camera swaps so an ended old feed cannot cause
          // LiveKit to open a second capture while a switch is in progress.
          await camera.track.replaceTrack(camera.track.mediaStreamTrack, { userProvidedTrack: true });
        }
      }
      this.syncLocal();
      return this[key];
    }
    if (on && !this[key] && prepared?.readyState === 'live') {
      const activated = await this.activatePreparedInput(prepared, (track) => {
        this.localStream ||= new MediaStream();
        this.localStream.addTrack(track);
      });
      if (!activated) return this[key];
    }
    const previous = this[key];
    this[key] = on;
    try { await this.fallback(); } catch (err) { this[key] = previous; throw err; }
    this.onLocal?.({ mic: this.mic, cam: this.cam, sharing: this.sharing });
    return this[key];
  }
  async setShare(on, quality = 'auto') {
    if (!this.room) throw new Error('Screen sharing needs the media server (LiveKit) to be configured');
    const LK = this.LK;
    // Lean screen share for a small VPS SFU: one encoding (no simulcast/extra layers), <=1280x720, 5-12 fps, <=1.2 Mbps.
    const cap = this.screenCap || {};
    const maxBitrate = Math.min(cap.maxBitrate || 1_200_000, 1_500_000);
    const fps = Math.min(cap.maxFramerate || 12, 15);
    const pick = { high: [1280, 720, fps], medium: [1280, 720, Math.min(fps, 10)], low: [960, 540, 5], auto: [1280, 720, fps] }[quality] || [1280, 720, fps];
    const [width, height, frameRate] = pick;
    await this.room.localParticipant.setScreenShareEnabled(on,
      { audio: true, resolution: { width, height, frameRate }, contentHint: 'detail', selfBrowserSurface: 'include', surfaceSwitching: 'include', systemAudio: 'include' },
      { videoCodec: 'vp8', simulcast: false, screenShareSimulcastLayers: [], screenShareEncoding: { maxBitrate: quality === 'low' ? Math.min(maxBitrate, 600_000) : maxBitrate, maxFramerate: frameRate }, scalabilityMode: 'L1T1', degradationPreference: 'maintain-resolution' });
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
    this.emitLocalCamera();
  }
  emitLocalCamera() {
    const v = this.localStream?.getVideoTracks()[0];
    if (v) this.onTrack && this.onTrack('__local', { kind: 'video', mediaStreamTrack: v, attach: (el) => { el.srcObject = new MediaStream([v]); el.play().catch(() => {}); return el; }, detach: () => [] }, 'camera', true);
    else this.onTrackGone && this.onTrackGone('__local', null, 'camera');
  }
  micTrack() {
    if (this.room) { const p = this.room.localParticipant.getTrackPublication(this.LK.Track.Source.Microphone); return p && p.track && p.track.mediaStreamTrack; }
    return this.localStream && this.localStream.getAudioTracks()[0];
  }
  camTrack() {
    if (this.room) return this.publishedCamera()?.mediaStreamTrack;
    return this.localStream && this.localStream.getVideoTracks()[0];
  }
  publishedCamera() {
    return this.room?.localParticipant.getTrackPublication(this.LK.Track.Source.Camera)?.track;
  }
  cameraSettings() {
    return this.publishedCamera()?.getSourceTrackSettings?.() || this.camTrack()?.getSettings() || {};
  }
  cameraFacing(settings = this.cameraSettings(), label = this.camTrack()?.label) {
    if (settings.facingMode === 'user' || settings.facingMode === 'environment') return settings.facingMode;
    return cameraFacingFromLabel(label) || this.cameraFacings.get(settings.deviceId);
  }
  nextCamera(devices) {
    if (!this.cam) return null;
    const settings = this.cameraSettings();
    const cameras = devices.filter((d) => d.deviceId && d.deviceId !== 'default');
    if (new Set(cameras.map((d) => d.deviceId)).size < 2) return null;
    const current = this.cameraFacing(settings) || cameraFacingFromLabel(cameras.find((d) => d.deviceId === settings.deviceId)?.label) || 'user';
    const facing = current === 'environment' ? 'user' : 'environment';
    const others = cameras.filter((d) => d.deviceId !== settings.deviceId);
    const named = others.find((d) => cameraFacingFromLabel(d.label) === facing);
    if (named) return { facing, deviceId: named.deviceId };
    if (others.some((d) => !cameraFacingFromLabel(d.label)) && navigator.mediaDevices.getSupportedConstraints?.().facingMode) return { facing };
    return null;
  }
  async switchCamera(target) {
    const previous = this.camTrack();
    if (!target || !this.cam || !previous || this.cameraSwitch) return false;
    const operation = this.cameraSwitch = { cancelled: false };
    const room = this.room;
    const published = this.publishedCamera();
    const stream = this.localStream;
    const isCurrent = () => this.cameraSwitch === operation && !operation.cancelled && this.cam
      && this.room === room && (room ? this.publishedCamera() === published : this.localStream === stream);
    const settings = this.cameraSettings();
    const prepared = this.preparedInputs.get('video');
    const replace = async (track) => {
      if (published) {
        await published.replaceTrack(track, { userProvidedTrack: true });
        // WebKit can end the old capture as soon as the other camera opens.
        if (isCurrent() && published.isMuted) await published.unmute();
      } else {
        for (const old of stream.getVideoTracks()) stream.removeTrack(old);
        stream.addTrack(track);
      }
    };

    let track;
    try {
      // Restarting a LiveKit track stops its capture before getUserMedia. Ask for
      // the other camera while the approved capture is still open.
      const video = target.deviceId ? { deviceId: { exact: target.deviceId } } : { facingMode: { exact: target.facing } };
      const captured = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...video, width: { ideal: settings.width || 1280 }, height: { ideal: settings.height || 720 },
        frameRate: { ideal: settings.frameRate || 24 },
      } });
      track = captured.getVideoTracks()[0];
      if (!track) throw new Error('Camera did not provide a video track');
      if (!isCurrent()) { track.stop(); return false; }
      const next = track.getSettings();
      const facing = this.cameraFacing(next, track.label);
      if ((facing && facing !== target.facing) || (!facing && next.deviceId && next.deviceId === settings.deviceId)) {
        throw new Error('The other camera could not be opened');
      }
      await replace(track);
      if (!isCurrent()) { track.stop(); return false; }
      previous.stop();
      prepared?.stop();
      if (next.deviceId) this.cameraFacings.set(next.deviceId, target.facing);
      this.prepareInputs([track.clone()]);
      if (published) this.syncLocal();
      else this.emitLocalCamera();
      return true;
    } catch (error) {
      track?.stop();
      if (isCurrent()) {
        if (previous.readyState === 'live' && !previous.muted) {
          try { if (this.camTrack() !== previous) await replace(previous); }
          catch { if (isCurrent()) await this.setCam(false).catch(() => {}); }
        } else await this.setCam(false).catch(() => {});
      }
      throw error;
    } finally {
      if (this.cameraSwitch === operation) this.cameraSwitch = null;
    }
  }
  remoteAudioTracks() {
    if (!this.room) return [];
    const out = [];
    this.room.remoteParticipants.forEach((p) => p.audioTrackPublications.forEach((pub) => pub.track && out.push(pub.track.mediaStreamTrack)));
    return out;
  }
  async switchDevice(kind, id) {
    if (kind === 'videoinput' && this.cameraSwitch) throw new Error('Camera is switching');
    const trackKind = kind === 'audioinput' ? 'audio' : 'video';
    const pending = this.pendingInputs.get(trackKind);
    if (kind !== 'audiooutput' && pending) await pending.result;
    saveDevicePref(kind, id);
    if (kind !== 'audiooutput') {
      this.preparedInputs.get(trackKind)?.stop();
      this.preparedInputs.delete(trackKind);
      if (!this.room) {
        for (const track of this.localStream?.getTracks() || []) {
          if (track.kind === trackKind) { track.stop(); this.localStream.removeTrack(track); }
        }
        await this.fallback();
      }
    }
    const room = this.room;
    if (room) {
      const { localParticipant } = room;
      const source = kind === 'audioinput' ? this.LK.Track.Source.Microphone : this.LK.Track.Source.Camera;
      const publication = kind !== 'audiooutput' && localParticipant.getTrackPublication(source);
      if (publication?.isMuted && publication.track?.isUserProvided) await localParticipant.unpublishTrack(publication.track);
      if (this.room === room) await room.switchActiveDevice(kind, id);
    }
  }
  async stats() {
    if (!this.room) return null;
    const out = { participants: this.room.numParticipants, state: this.room.state, region: this.room.serverInfo?.region || '', version: this.room.serverInfo?.version || '' };
    try {
      const pc = this.room.engine?.pcManager?.publisher?.pc || this.room.engine?.publisher?.pc;
      if (pc) { const r = await pc.getStats(); r.forEach((s) => { if (s.type === 'outbound-rtp' && s.kind === 'video' && s.frameHeight) { out.sendRes = `${s.frameWidth}×${s.frameHeight}@${Math.round(s.framesPerSecond || 0)}`; } if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null) out.rtt = Math.round(s.currentRoundTripTime * 1000) + ' ms'; if (s.type === 'candidate-pair' && s.availableOutgoingBitrate) out.uplink = Math.round(s.availableOutgoingBitrate / 1000) + ' kbps'; }); }
    } catch { /* ignore */ }
    return out;
  }
  async disconnect({ keepInputs = false } = {}) {
    if (this.cameraSwitch) this.cameraSwitch.cancelled = true;
    for (const { track, controller } of this.pendingInputs.values()) {
      controller.abort();
      if (keepInputs && this.preparedInputs.get(track.kind) === track) track.enabled = false;
      else track.stop();
    }
    this.pendingInputs.clear();
    if (!keepInputs) {
      for (const track of this.preparedInputs.values()) track.stop();
      this.preparedInputs.clear();
    }
    try { if (this.room) await this.room.disconnect(true); } catch { /* ignore */ }
    this.room = null;
    if (this.localStream) { this.localStream.getTracks().forEach((t) => t.stop()); this.localStream = null; }
    this.mic = this.cam = this.sharing = false;
  }
}
