const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { getContentState } = require('../src/rooms/store');
const plugin = require('../src/plugins/content');

function harness() {
  const handlers = new Map(), events = [], registrations = [];
  const meeting = { participants: new Map([['host', { id: 'host', role: 'host' }], ['viewer', { id: 'viewer', role: 'guest' }]]) };
  plugin.register({ onWs: (type, cb) => handlers.set(type, cb), onRegister: (cb) => registrations.push(cb),
    broadcast: (code, data, exclude) => events.push({ data: JSON.parse(JSON.stringify(data)), exclude }),
    getContentState, clients: new Map(), getMeeting: () => meeting });
  const send = (type, msg = {}, participantId = 'host') => handlers.get(type)({ msg, participantId, meeting, meetingCode: 'ab12cd' });
  const start = () => send('content-start', { contentType: 'slides', pages: ['/files/deck/1.jpg', '/files/deck/2.jpg'] });
  return { meeting, events, registrations, send, start };
}

test('slides: sender echo, audience cannot navigate or toggle, remote holder can drive, late join state', () => {
  const H = harness(); H.start();
  H.send('content-update', { page: 2 });
  assert.equal(H.meeting.content.page, 2);
  assert.equal(H.events.at(-1).exclude, undefined, 'presenter receives authoritative page too');
  H.send('content-update', { page: 1, slideshow: true }, 'viewer');
  assert.equal(H.meeting.content.page, 2); assert.equal(H.meeting.content.slideshow, false);
  H.send('remote-handoff', { targetId: 'viewer' });
  H.send('content-update', { page: 1 }, 'viewer');
  assert.equal(H.meeting.content.page, 1);
  const messages = [];
  H.registrations[0]({ send: (s) => messages.push(JSON.parse(s)) }, H.meeting);
  assert.equal(messages[0].content.page, 1); assert.equal(messages[0].content.remoteHolderId, 'viewer');
  H.send('content-update', { page: 999 }); assert.equal(H.meeting.content.page, 2);
});

test('slideshow: server advances and wraps, state serializes, stopping / replacement clears timers', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const H = harness(); H.start();
  H.send('content-update', { slideshow: true });
  assert.equal(getContentState(H.meeting).slideshow, true);
  assert.doesNotThrow(() => JSON.stringify(getContentState(H.meeting)));
  t.mock.timers.tick(4000); assert.equal(H.meeting.content.page, 2);
  t.mock.timers.tick(4000); assert.equal(H.meeting.content.page, 1);
  H.send('content-update', { slideshow: false });
  t.mock.timers.tick(8000); assert.equal(H.meeting.content.page, 1);
  H.send('content-update', { slideshow: true }); H.start();
  t.mock.timers.tick(8000); assert.equal(H.meeting.content.page, 1); assert.equal(H.meeting.content.slideshow, false);
  H.send('content-update', { slideshow: true }); H.send('content-stop');
  const count = H.events.length; t.mock.timers.tick(8000);
  assert.equal(H.meeting.content, null); assert.equal(H.events.length, count);
});

test('content batches permit a deck above 12 images while ordinary upload policy remains limited', () => {
  const uploads = require('../src/venue/uploads');
  for (let i = 0; i < 200; i++) assert.ok(uploads.precheck({ mime: 'image/jpeg', declaredSize: 100, rateKey: 'deck-test', contentBatch: true }));
  for (let i = 0; i < 12; i++) uploads.precheck({ mime: 'image/jpeg', rateKey: 'ordinary-test' });
  assert.throws(() => uploads.precheck({ mime: 'image/jpeg', rateKey: 'ordinary-test' }), (e) => e.status === 429);
});

test('PPTX: bounded validation, async conversion contract, cleanup, binary response, guest room authorization', async (t) => {
  const converter = require('../src/venue/pptx');
  await assert.rejects(converter.convertPptx(Buffer.from('not a deck')), (e) => e.status === 415);
  await assert.rejects(converter.convertPptx(Buffer.alloc(0)), (e) => e.status === 400);
  await assert.rejects(converter.convertPptx(Buffer.alloc(converter.MAX_BYTES + 1)), (e) => e.status === 413);
  const zip = fs.readFileSync(path.join(__dirname, 'fixtures/conversion.pptx'));
  const pdf = Buffer.from('%PDF-1.7\n\x00\xff\n', 'latin1');
  t.mock.method(converter, 'convertPptx', async (buf) => { assert.deepEqual(buf, zip); return pdf; });
  const store = require('../src/rooms/store');
  const { signWsCredential } = require('../src/lib/wsCredential');
  const { handleVenueRoutes } = require('../src/http/venue');
  const code = 'p9t2xs', pid = 'guest-presenter';
  store.setMeeting(code, { code, settings: { participantScreenShare: true }, participants: new Map([[pid, { id: pid, role: 'guest', status: 'ACTIVE' }]]) });
  t.after(() => store.deleteMeeting(code));
  async function request(headers = {}) {
    const req = Readable.from([zip]); req.method = 'POST';
    req.headers = { host: 'localhost', 'content-type': 'application/octet-stream', 'x-room-code': code, 'x-participant-id': pid,
      'x-room-credential': signWsCredential({ participantId: pid, code }), ...headers };
    const res = { req, headersSent: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }, end(body) { this.body = body; } };
    await handleVenueRoutes(req, res, new URL('http://localhost/api/convert/pptx'));
    return res;
  }
  const res = await request(); assert.equal(res.status, 200); assert.deepEqual(res.body, pdf); assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal((await request({ 'content-type': 'text/html' })).status, 415);
  assert.equal((await request({ 'content-length': String(converter.MAX_BYTES + 1) })).status, 413);
  store.getMeeting(code).settings.participantScreenShare = false;
  assert.equal((await request()).status, 403);
});

test('PPTX: real LibreOffice conversion produces two PDF pages', async (t) => {
  const { spawnSync } = require('node:child_process');
  if (spawnSync('libreoffice', ['--version']).error) return t.skip('LibreOffice not installed');
  const converter = require('../src/venue/pptx');
  const pdf = await converter.convertPptx(fs.readFileSync(path.join(__dirname, 'fixtures/conversion.pptx')));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const output = path.join(__dirname, 'fixtures/conversion-check.pdf');
  try {
    fs.writeFileSync(output, pdf);
    const info = spawnSync('pdfinfo', [output], { encoding: 'utf8' });
    if (!info.error) assert.match(info.stdout, /Pages:\s+2/);
    const text = spawnSync('pdftotext', [output, '-'], { encoding: 'utf8' });
    if (!text.error) { assert.match(text.stdout, /1venue slide 1/); assert.match(text.stdout, /1venue slide 2/); }
  } finally { fs.rmSync(output, { force: true }); }
});

// Minimal DOM adapter exercises actual stage / picker functions without a browser or media server.
class Element {
  constructor(tag, props = {}) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false;
    this.style = { setProperty() {} }; this.className = props.class || '';
    this.classList = { toggle: (c, on) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); if (on === undefined) on = !set.has(c); on ? set.add(c) : set.delete(c); this.className = [...set].join(' '); }, add: (...cs) => cs.forEach((c) => this.classList.toggle(c, true)), remove: (...cs) => cs.forEach((c) => this.classList.toggle(c, false)) };
    for (const [k, v] of Object.entries(props)) if (k !== 'class') this[k] = v;
  }
  append(...items) { for (const x of items.flat(Infinity)) if (x != null && x !== false) { this.children.push(x); if (typeof x === 'object') x.parent = this; } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener() {} removeEventListener() {} click() {}
  setAttribute(k, v) { this.attributes[k] = v; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  querySelectorAll(selector) {
    const cls = selector.replace(':scope > ', '').slice(1);
    return this.children.flatMap((x) => x instanceof Element ? [...(x.className.split(/\s+/).includes(cls) ? [x] : []), ...x.querySelectorAll(selector)] : []);
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}
const h = (tag, props, ...children) => { const el = new Element(tag, props || {}); el.append(...children); return el; };
function browserModule(file, bindings, exports) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;\s*$/mg, '').replace(/^export \{.*\};?\s*$/mg, '').replace(/export (?=(?:async )?function)/g, '');
  return new Function(...Object.keys(bindings), source + '\nreturn {' + exports + '};')(...Object.values(bindings));
}

test('stage: content-only hides audience, restores it off toggle; host gallery drives synchronized pages, audience has no controls', () => {
  const { createStage } = browserModule('public/js/room/stage.js', { h, esc: (s) => s, icon: () => '', avatar: () => h('i'), Image: class {}, document: { addEventListener() {}, removeEventListener() {} }, setInterval: () => 0 }, 'createStage');
  const R = { me: { id: 'host' }, stage: { enabled: true }, isSpeaker: () => false, people: () => [{ id: 'viewer', name: 'Audience' }], p: () => null,
    layout: 'screenshare', timeline: {}, content: { type: 'slides', ownerId: 'host', remoteHolderId: 'host', pages: ['/files/a/1.jpg', '/files/a/2.jpg'], page: 1 },
    isMod: () => true, canControlContent: () => R.me.id === 'host', panel: { open() {} }, setContentPage: (p) => { R.sentPage = p; }, toggleSlideshow: (on) => { R.sentSlideshow = on; } };
  const stage = createStage(R); stage.render();
  assert.match(stage.el.className, /content-only/); assert.equal(stage.el.querySelector('.audience'), null);
  const controls = stage.el.querySelector('.slide-controls');
  controls.children[2].onclick(); assert.equal(R.sentPage, 2);
  controls.children[3].onclick(); assert.equal(stage.el.querySelector('.stage-thumbs').hidden, false);
  stage.el.querySelector('.stage-thumbs').children[1].onclick(); assert.equal(R.sentPage, 2);
  controls.children[4].children[0].onchange({ target: { checked: true } }); assert.equal(R.sentSlideshow, true);
  R.applyPage(2); assert.equal(stage.el.querySelector('.slide-count').textContent, '2 / 2');
  R.applySlideshow(true); assert.equal(controls.children[4].children[0].checked, true);
  R.layout = 'grid'; stage.render(); assert.ok(stage.el.querySelector('.audience')); assert.doesNotMatch(stage.el.className, /content-only/);
  R.me.id = 'viewer'; stage.render(true);
  assert.equal(stage.el.querySelector('.stage-thumbs'), null); assert.equal(stage.el.querySelector('.slide-controls').children.length, 1);
  R.applyPage(2); assert.equal(stage.el.querySelector('.slide-count').textContent, '2 / 2');
  R.layout = 'screenshare'; R.content = null; stage.render(); assert.equal(stage.el.querySelector('.audience'), null);
});

test('multi-image picker uploads every selected image in order, mixed selections are rejected', async () => {
  const document = { body: h('body') }, uploads = [], sent = [], notices = [];
  const { pickContentFile } = browserModule('public/js/room/tools.js', { h, document, setTimeout: () => 0, toast: (s) => notices.push(s), toastErr: (e) => { throw e; }, uploadFile: async (f) => { uploads.push(f.name); return { url: '/files/gallery/' + f.name }; } }, 'pickContentFile');
  const R = { headers: () => ({}), panel: { refresh() {} }, send: (type, payload) => sent.push({ type, payload }) };
  pickContentFile(R);
  const input = document.body.children[0];
  input.files = [{ name: '1.png', type: 'image/png' }, { name: '2.png', type: 'image/png' }];
  await input.onchange();
  assert.deepEqual(uploads, ['1.png', '2.png']); assert.equal(sent[0].payload.contentType, 'slides');
  assert.deepEqual(sent[0].payload.pages, ['/files/gallery/1.png', '/files/gallery/2.png']);
  input.files = [{ name: '1.png', type: 'image/png' }, { name: 'deck.pptx', type: 'application/octet-stream' }];
  await input.onchange(); assert.equal(sent.length, 1); assert.match(notices.at(-1), /one PDF\/PPTX/);
});
