'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadClassify(extra = {}) {
  const src = read('public/js/room/devices.js')
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const ctx = { console, ...extra };
  vm.runInNewContext(src + '\nthis.classifyDevice = classifyDevice;\nthis.sortDevices = sortDevices;\nthis.optionLabel = optionLabel;\nthis.isDefaultDevice = isDefaultDevice;\nthis.framesHaveContent = framesHaveContent;\nthis.VIRTUAL_RE = VIRTUAL_RE;\nthis.probeMic = probeMic;', ctx);
  return ctx;
}

describe('device auto-select', () => {
  it('accepts a live microphone without needing sound or a running AudioContext', async () => {
    let stopped = false;
    const track = { readyState: 'live', stop: () => { stopped = true; } };
    const { probeMic } = loadClassify({
      setTimeout, clearTimeout, AUDIO_CONSTRAINTS: {},
      navigator: { mediaDevices: { getUserMedia: async ({ audio }) => {
        assert.equal(audio.deviceId, undefined);
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      } } },
    });
    assert.equal(await probeMic('default'), true);
    assert.equal(stopped, true);
  });
  it('treats NDI like other virtual add-ons and tags them Virtual', () => {
    const { classifyDevice, VIRTUAL_RE } = loadClassify();
    for (const label of ['NDI Webcam Input', 'NewTek NDI', 'NDI Video', 'OBS Virtual Camera', 'Snap Camera', 'ManyCam Virtual Webcam', 'VB-Cable', 'Voicemeeter Input', 'Virtual Camera']) {
      const c = classifyDevice({ label, deviceId: 'x' });
      assert.equal(c.virtual, true, label);
      assert.equal(c.tag, 'Virtual', label);
    }
    assert.match(VIRTUAL_RE.source, /ndi/);
    assert.equal(classifyDevice({ label: 'FaceTime HD Camera', deviceId: '1' }).virtual, false);
    assert.equal(classifyDevice({ label: 'USB Microphone', deviceId: '2' }).virtual, false);
    assert.equal(classifyDevice({ label: 'Built-in Microphone', deviceId: '3' }).tag, '');
  });

  it('sorts last-known-good, then default, then physical, then virtual last', () => {
    const { sortDevices } = loadClassify();
    const list = [
      { deviceId: 'ndi', label: 'NDI Webcam Input' },
      { deviceId: 'obs', label: 'OBS Virtual Camera' },
      { deviceId: 'usb', label: 'USB Camera' },
      { deviceId: 'default', label: 'Default - USB Camera' },
      { deviceId: 'saved', label: 'FaceTime HD Camera' },
    ];
    assert.equal(sortDevices(list, 'saved').map((d) => d.deviceId).join(','), 'saved,default,usb,ndi,obs');
  });

  it('labels virtual devices and non-responding ones', () => {
    const { optionLabel } = loadClassify();
    assert.equal(optionLabel({ label: 'NDI Webcam Input', deviceId: 'n' }), 'NDI Webcam Input · Virtual');
    assert.equal(optionLabel({ label: 'USB Camera', deviceId: 'u' }, { ok: false }), 'USB Camera · Not responding');
    assert.equal(optionLabel({ label: 'OBS Virtual Camera', deviceId: 'o' }, { ok: false }), 'OBS Virtual Camera · Virtual · Not responding');
  });

  it('rejects black, uniform, and frozen-flat frames', () => {
    const { framesHaveContent } = loadClassify();
    const black = Uint8ClampedArray.from({ length: 32 * 18 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 0));
    const flat = Uint8ClampedArray.from({ length: 32 * 18 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 12));
    const texA = Uint8ClampedArray.from({ length: 32 * 18 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17) % 220));
    const texB = Uint8ClampedArray.from({ length: 32 * 18 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 17 + 40) % 220));
    assert.equal(framesHaveContent(black, black), false);
    assert.equal(framesHaveContent(flat, flat), false);
    assert.equal(framesHaveContent(texA, texB), true);
  });

  it('hooks prejoin, device sheet, watchdog, and a speaker test', () => {
    const room = read('public/js/room/room.js');
    assert.match(room, /pickWorking/);
    assert.match(room, /Try next/);
    assert.match(room, /icon\('refresh'/);
    assert.match(room, /Play test sound/);
    assert.match(room, /startWatchdog/);
    assert.match(room, /setSinkId/);
    assert.match(read('public/js/room/devices.js'), /playTestSound/);
    assert.match(read('public/js/room/media.js'), /camTrack\(\)/);
  });
});

it('keeps setup devices off until the user enables them and reuses them across LiveKit connections', async () => {
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const track = (kind) => Object.assign(new EventTarget(), {
    kind, readyState: 'live', enabled: true, muted: false,
    clone: () => Object.assign(track(kind), { enabled: false }),
    stop() { this.readyState = 'ended'; },
  });
  const media = new Media();
  const mic = track('audio');
  const cam = track('video');
  const published = new Map();
  const transitions = [];
  const setEnabled = (source, on) => {
    if (!on && !published.has(source)) return;
    assert.ok(published.has(source), 'enabling a prepared device should never ask LiveKit to capture it');
    const pub = published.get(source);
    pub.isMuted = !on;
    pub.track.mediaStreamTrack.enabled = on;
  };
  const localParticipant = {
    get isMicrophoneEnabled() { return !!published.get('microphone') && !published.get('microphone').isMuted; },
    get isCameraEnabled() { return !!published.get('camera') && !published.get('camera').isMuted; },
    getTrackPublication: (source) => published.get(source),
    async publishTrack(input, { source }) {
      assert.equal(published.has(source), false);
      assert.equal(input.enabled, true);
      assert.equal(input.muted, false, 'the approved device has resumed before publication');
      const publication = {
        isMuted: false, track: { isUserProvided: true, mediaStreamTrack: input },
        async mute() { transitions.push([source, 'mute']); setEnabled(source, false); },
        async unmute() {
          assert.equal(this.isMuted, true);
          assert.equal(source === 'microphone' ? media.mic : media.cam, false, 'do not mark the input on until startup completes');
          transitions.push([source, 'unmute']);
          setEnabled(source, true);
        },
      };
      published.set(source, publication);
      media.syncLocal(); // LiveKit emits LocalTrackPublished before publishTrack returns.
      assert.equal(source === 'microphone' ? media.mic : media.cam, false, 'do not mark the input on until startup completes');
      return publication;
    },
    async setMicrophoneEnabled(on) { setEnabled('microphone', on); },
    async setCameraEnabled(on) { setEnabled('camera', on); },
  };
  const room = { localParticipant, async disconnect() {
    for (const pub of published.values()) pub.track.mediaStreamTrack.stop();
    published.clear();
  } };
  media.LK = { Track: { Source: { Microphone: 'microphone', Camera: 'camera' } } };
  media.room = room;
  media.prepareInputs([mic, cam]);
  assert.deepEqual([media.mic, media.cam, mic.enabled, cam.enabled, published.size], [false, false, false, false, 0]);
  cam.muted = true;
  const cancelled = media.setCam(true);
  assert.equal(await media.setCam(false), false);
  assert.equal(await cancelled, false);
  assert.equal(cam.enabled, false);
  assert.equal(published.size, 0);
  for (const [input, enable, source] of [[mic, () => media.setMic(true), 'microphone'], [cam, () => media.setCam(true), 'camera']]) {
    input.muted = true;
    const enabling = enable();
    const repeat = enable();
    assert.equal(input.enabled, true, 'wake the approved input on the first tap');
    assert.equal(published.has(source), false, 'wait for the native capture to wake before publishing');
    input.muted = false;
    input.dispatchEvent(new Event('unmute'));
    assert.equal(await enabling, true);
    assert.equal(await repeat, true);
    assert.equal(published.get(source).track.mediaStreamTrack, input);
  }
  assert.deepEqual(transitions, [['microphone', 'mute'], ['microphone', 'unmute']]);
  for (const on of [false, true]) {
    assert.equal(await media.setMic(on), on);
    assert.equal(await media.setCam(on), on);
  }
  const retained = [...media.preparedInputs.values()];
  await media.disconnect({ keepInputs: true });
  assert.deepEqual([media.mic, media.cam, mic.readyState, cam.readyState], [false, false, 'ended', 'ended']);
  assert.ok(retained.every((input) => input.readyState === 'live' && !input.enabled));
  media.room = room;
  assert.equal(await media.setMic(true), true);
  assert.equal(await media.setCam(true), true);
  await media.disconnect();
  assert.ok(retained.every((input) => input.readyState === 'ended'));
});

it('recovers a stalled setup camera on the first tap without reopening the microphone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const camera = (muted) => Object.assign(new EventTarget(), {
    kind: 'video', readyState: 'live', enabled: true, muted,
    getSettings: () => ({ deviceId: 'front' }),
    clone: () => camera(muted),
    stop() { this.readyState = 'ended'; },
  });
  const setup = camera(true);
  const replacement = camera(false);
  const requests = [];
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    async getUserMedia(constraints) {
      assert.equal(setup.readyState, 'live');
      requests.push(constraints);
      return { getVideoTracks: () => [replacement] };
    },
  } }));
  const attached = [];
  const media = new Media({ onTrack: (...args) => attached.push(args) });
  let publication;
  media.room = { localParticipant: {
    identity: 'host',
    get isCameraEnabled() { return !!publication; },
    getTrackPublication: () => publication,
    async publishTrack(input) {
      assert.equal(input, replacement);
      assert.equal(input.enabled, true);
      publication = { track: { mediaStreamTrack: input } };
      return publication;
    },
  } };
  media.LK = { Track: { Source: { Camera: 'camera' } } };
  media.prepareInputs([setup]);

  const enabling = media.setCam(true);
  const repeated = media.setCam(true);
  assert.equal(media.cam, false);
  t.mock.timers.tick(2500);
  assert.deepEqual(await Promise.all([enabling, repeated]), [true, true]);
  assert.deepEqual(requests, [{ audio: false, video: { deviceId: { ideal: 'front' } } }]);
  assert.equal(setup.readyState, 'ended');
  assert.deepEqual(attached, [['host', publication.track, 'camera', true]]);
});

it('keeps the approved microphone live when camera activation needs a replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const track = (kind, muted = false) => Object.assign(new EventTarget(), {
    kind, readyState: 'live', enabled: true, muted,
    getSettings: () => ({ deviceId: kind === 'video' ? 'front' : 'mic' }),
    clone: () => track(kind, muted),
    stop() { this.readyState = 'ended'; },
  });
  const mic = track('audio');
  const camera = track('video', true);
  const replacement = track('video');
  const media = new Media();
  const published = new Map();
  let micError;
  const localParticipant = {
    identity: 'host',
    get isMicrophoneEnabled() { return !!published.get('microphone')?.enabled; },
    get isCameraEnabled() { return !!published.get('camera')?.enabled; },
    getTrackPublication: (source) => published.get(source),
    async publishTrack(input, { source }) {
      if (input.kind === 'audio' && input.muted) micError = new Error('Your microphone did not start');
      const trackWrapper = { mediaStreamTrack: input, isUserProvided: true };
      const publication = {
        track: trackWrapper, enabled: true, isMuted: false,
        async mute() {
          if (source === 'microphone') {
            this.isMuted = true;
            this.enabled = false;
            input.enabled = false;
          }
        },
        async unmute() {
          if (source === 'microphone') {
            this.isMuted = false;
            this.enabled = true;
            input.enabled = true;
          }
        },
      };
      published.set(source, publication);
      return publication;
    },
    async unpublishTrack(input) {
      for (const [source, publication] of published) if (publication.track === input) published.delete(source);
    },
  };
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    async getUserMedia({ audio }) {
      assert.equal(audio, false, 'camera recovery must not stop or reacquire the mic');
      assert.equal(mic.readyState, 'live');
      return { getVideoTracks: () => [replacement] };
    },
  } }));
  media.LK = { Track: { Source: { Microphone: 'microphone', Camera: 'camera' } } };
  media.room = { localParticipant };
  media.prepareInputs([mic, camera]);

  const micActivation = media.setMic(true);
  const cameraActivation = media.setCam(true);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(2500);
  await Promise.all([micActivation, cameraActivation]);

  assert.equal(micError, undefined);
  assert.equal(media.mic, true);
  assert.equal(media.cam, true);
  assert.equal(mic.readyState, 'live');
  assert.equal(mic.enabled, true);
});

it('recovers a stalled setup microphone on the first tap without reopening camera', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const makeTrack = (kind, muted = false) => Object.assign(new EventTarget(), {
    kind, readyState: 'live', enabled: true, muted,
    getSettings: () => ({ deviceId: 'approved-' + kind }),
    clone: () => makeTrack(kind, muted),
    stop() { this.readyState = 'ended'; },
  });
  const mic = makeTrack('audio', true);
  const cam = makeTrack('video');
  const recoveredMic = makeTrack('audio');
  let cameraRequests = 0;
  const media = new Media();
  const publications = new Map();
  const participant = {
    identity: 'host',
    get isMicrophoneEnabled() { return !!publications.get('microphone') && !publications.get('microphone').isMuted; },
    get isCameraEnabled() { return !!publications.get('camera') && !publications.get('camera').isMuted; },
    getTrackPublication: (source) => publications.get(source),
    async publishTrack(input, { source }) {
      const publication = {
        track: { isUserProvided: true, mediaStreamTrack: input },
        isMuted: false,
        async mute() { this.isMuted = true; input.enabled = false; },
        async unmute() { this.isMuted = false; input.enabled = true; },
      };
      publications.set(source, publication);
      return publication;
    },
  };
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    async getUserMedia({ audio, video }) {
      assert.ok(audio);
      assert.equal(video, false);
      assert.equal(cam.readyState, 'live');
      cameraRequests++;
      return { getAudioTracks: () => [recoveredMic] };
    },
  } }));
  media.LK = { Track: { Source: { Microphone: 'microphone', Camera: 'camera' } } };
  media.room = { localParticipant: participant };
  media.prepareInputs([mic, cam]);

  const enabling = media.setMic(true);
  t.mock.timers.tick(2500);
  assert.equal(await enabling, true);
  assert.equal(media.mic, true);
  assert.equal(recoveredMic.readyState, 'live');
  assert.equal(recoveredMic.enabled, true);
  assert.equal(cam.readyState, 'live');
  assert.equal(cameraRequests, 1);
});

it('switches camera without requesting or disturbing microphone capture', async (t) => {
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const makeTrack = (kind, deviceId, facingMode) => ({
    kind, label: facingMode === 'environment' ? 'Back Camera' : 'Front Camera',
    readyState: 'live', enabled: true, muted: false,
    getSettings: () => ({ deviceId, facingMode, width: 1280, height: 720, frameRate: 24 }),
    clone() { return makeTrack(kind, deviceId, facingMode); },
    stop() { this.readyState = 'ended'; },
  });
  const mic = makeTrack('audio', 'mic', undefined);
  const firstCamera = makeTrack('video', 'front', 'user');
  const nextCamera = makeTrack('video', 'rear', 'environment');
  const requests = [];
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    async getUserMedia(options) {
      requests.push(options);
      return { getVideoTracks: () => [nextCamera] };
    },
  } }));
  let replaced;
  const publication = {
    track: { isUserProvided: true, mediaStreamTrack: firstCamera },
  };
  publication.track.replaceTrack = async (track) => { replaced = track; publication.track.mediaStreamTrack = track; };
  const media = new Media();
  media.LK = { Track: { Source: { Camera: 'camera' } } };
  media.room = { localParticipant: {
    isMicrophoneEnabled: true,
    getTrackPublication: () => publication,
  } };
  media.cam = true;
  media.mic = true;
  media.prepareInputs([mic, firstCamera.clone()]);
  assert.equal(await media.switchCamera({ facing: 'environment', deviceId: 'rear' }), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].audio, false);
  assert.equal(replaced, nextCamera);
  assert.equal(mic.readyState, 'live');
  assert.equal(media.mic, true);
});

it('only starts browser speech capture when captioning is explicitly enabled with the mic on', async () => {
  let starts = 0;
  const src = read('public/js/room/captions.js').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const ctx = {
    clearTimeout,
    window: { SpeechRecognition: class {
      start() { starts++; }
      stop() {}
    } },
    toast() {},
  };
  vm.runInNewContext(src + '\nthis.Captioner = Captioner;', ctx);
  const media = { mic: false };
  const captions = new ctx.Captioner({ config: {}, me: { id: 'a' }, media, isSpeaker: () => true, captionLang: () => 'en' });
  captions.autoSync();
  await captions.setMine(true);
  media.mic = true;
  captions.autoSync();
  assert.equal(starts, 0);
  await captions.setMine(true);
  assert.equal(starts, 1);
  media.mic = false;
  captions.onMic(false);
  assert.equal(captions.on, false);
});

it('keeps the approved capture live while switching cameras and leaves the feed in place if access is declined', async (t) => {
  const { Media } = await import(pathToFileURL(path.join(root, 'public/js/room/media.js')));
  const cameras = [
    { deviceId: 'front', label: 'Front Camera', facingMode: 'user' },
    { deviceId: 'rear', label: 'Back Camera', facingMode: 'environment' },
  ];
  const track = (camera) => ({
    kind: 'video', label: camera.label, readyState: 'live', enabled: true,
    getSettings: () => camera, clone: () => track(camera),
    stop() { this.readyState = 'ended'; },
  });
  const requested = [];
  let failingDevice;
  let endPreviousOnCapture = false;
  const video = {
    mediaStreamTrack: track(cameras[0]),
    async restartTrack() { assert.fail('LiveKit must not stop the approved camera to acquire another'); },
    async replaceTrack(input) { this.mediaStreamTrack = input; },
    async unmute() { this.isMuted = false; },
  };
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    async getUserMedia({ audio, video: { deviceId } }) {
      assert.equal(audio, false);
      assert.equal(video.mediaStreamTrack.readyState, 'live', 'keep the current capture open while requesting the replacement');
      requested.push(deviceId.exact);
      if (deviceId.exact === failingDevice) throw Object.assign(new Error('Camera unavailable'), { name: 'NotAllowedError' });
      if (endPreviousOnCapture) {
        video.mediaStreamTrack.stop();
        video.isMuted = true;
      }
      return { getVideoTracks: () => [track(cameras.find((camera) => camera.deviceId === deviceId.exact))] };
    },
  } }));
  const publication = { track: video };
  const media = new Media();
  media.LK = { Track: { Source: { Camera: 'camera' } } };
  media.room = { localParticipant: { isCameraEnabled: true, getTrackPublication: () => publication } };
  const setup = track(cameras[0]);
  media.prepareInputs([setup]);
  assert.equal(media.nextCamera(cameras), null);
  media.cam = true;
  assert.equal(media.nextCamera(cameras.slice(0, 1)), null);
  assert.deepEqual(media.nextCamera(cameras), { facing: 'environment', deviceId: 'rear' });
  const original = media.camTrack();
  assert.equal(await media.switchCamera(media.nextCamera(cameras)), true);
  assert.equal(original.readyState, 'ended');
  assert.equal(setup.readyState, 'ended');
  assert.equal(media.cameraFacing(), 'environment');
  assert.equal(media.preparedInputs.get('video').enabled, false);

  failingDevice = 'front';
  await assert.rejects(media.switchCamera(media.nextCamera(cameras)), /Camera unavailable/);
  assert.deepEqual(requested, ['rear', 'front']);
  assert.equal(media.cameraFacing(), 'environment');
  assert.equal(media.cam, true);
  assert.equal(media.publishedCamera(), video);

  failingDevice = null;
  endPreviousOnCapture = true;
  assert.equal(await media.switchCamera(media.nextCamera(cameras)), true);
  assert.equal(video.isMuted, false, 'resume publishing if WebKit ended the original hardware capture');
  assert.equal(media.cameraFacing(), 'user');
});
