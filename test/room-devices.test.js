'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
