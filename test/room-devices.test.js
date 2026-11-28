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
  const track = (kind) => ({
    kind, readyState: 'live', enabled: true,
    clone: () => ({ ...track(kind), enabled: false }),
    stop() { this.readyState = 'ended'; },
  });
  const media = new Media();
  const mic = track('audio');
  const cam = track('video');
  const published = new Map();
  const setEnabled = (source, on) => {
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
      assert.equal(input.enabled, true);
      published.set(source, { isMuted: false, track: { isUserProvided: true, mediaStreamTrack: input } });
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
  for (const on of [true, false, true]) {
    assert.equal(await media.setMic(on), on);
    assert.equal(await media.setCam(on), on);
  }
  assert.notEqual(media.micTrack(), mic);
  assert.notEqual(media.camTrack(), cam);
  await media.disconnect({ keepInputs: true });
  assert.deepEqual([media.mic, media.cam, mic.readyState, cam.readyState], [false, false, 'live', 'live']);
  media.room = room;
  assert.equal(await media.setMic(true), true);
  assert.equal(await media.setCam(true), true);
  await media.disconnect();
  assert.deepEqual([mic.readyState, cam.readyState], ['ended', 'ended']);
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

it('switches the LiveKit camera publication and restores the previous camera if switching fails', async () => {
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
  let failingDevice;
  const requested = [];
  const video = {
    mediaStreamTrack: track(cameras[0]),
    async restartTrack({ deviceId }) {
      this.mediaStreamTrack.stop();
      requested.push(deviceId.exact);
      if (deviceId.exact === failingDevice) throw new Error('Camera unavailable');
      this.mediaStreamTrack = track(cameras.find((d) => d.deviceId === deviceId.exact));
    },
  };
  const publication = { track: video };
  const media = new Media();
  media.LK = { Track: { Source: { Camera: 'camera' } } };
  media.room = { localParticipant: { getTrackPublication: () => publication } };
  const setup = track(cameras[0]);
  media.prepareInputs([setup]);
  assert.equal(media.nextCamera(cameras), null);
  media.cam = true;
  assert.equal(media.nextCamera(cameras.slice(0, 1)), null);
  assert.deepEqual(media.nextCamera(cameras), { facing: 'environment', deviceId: 'rear' });
  assert.equal(await media.switchCamera(media.nextCamera(cameras)), true);
  assert.equal(setup.readyState, 'ended');
  assert.equal(media.cameraFacing(), 'environment');
  assert.equal(media.preparedInputs.get('video').enabled, false);

  failingDevice = 'front';
  await assert.rejects(media.switchCamera(media.nextCamera(cameras)), /Camera unavailable/);
  assert.deepEqual(requested, ['rear', 'front', 'rear']);
  assert.equal(media.cameraFacing(), 'environment');
  assert.equal(media.cam, true);
  assert.equal(media.publishedCamera(), video);
});
