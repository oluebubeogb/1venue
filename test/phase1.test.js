'use strict';
// Phase 1 scalability guards: S3 streaming, restart snapshots, LEFT pruning, memory caps.
process.env.STORAGE_DRIVER = 's3';
process.env.S3_BUCKET = 'test-bucket';
process.env.S3_ACCESS_KEY_ID = 'AKIATEST';
process.env.S3_SECRET_ACCESS_KEY = 'secret';
process.env.S3_REGION = 'auto';
process.env.WB_MAX_STROKES = '8';
process.env.WB_MAX_POINTS = '5';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

test('S3 open() streams the object instead of buffering it', async () => {
  const body = Buffer.alloc(256 * 1024, 7);
  const srv = http.createServer((req, res) => {
    assert.match(req.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/);
    assert.equal(req.url, '/test-bucket/2026/11/abc-file.bin');
    res.writeHead(200, { 'content-length': body.length }); res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.S3_ENDPOINT = `http://127.0.0.1:${srv.address().port}`;
  const config = require('../src/config');
  config.STORAGE.s3.endpoint = process.env.S3_ENDPOINT;
  const storage = require('../src/venue/storage');
  const f = await storage.open({ driver: 's3', object_key: '2026/11/abc-file.bin' });
  assert.ok(f.stream && typeof f.stream.pipe === 'function', 'returns a stream');
  assert.equal(f.size, body.length);
  const chunks = []; for await (const c of f.stream) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), body);
  srv.close();
});

test('snapshot serialize/deserialize keeps Maps and Sets and drops timers', () => {
  const { serialize, deserialize } = require('../src/rooms/snapshot');
  const timer = setInterval(() => {}, 1000);
  const m = { code: 'abc123', participants: new Map([['p1', { id: 'p1', role: 'host', status: 'ACTIVE' }]]), blocked: { names: new Set(['x']) }, content: { slideshowTimer: timer, page: 2 } };
  const back = deserialize(serialize(m));
  clearInterval(timer);
  assert.ok(back.participants instanceof Map);
  assert.equal(back.participants.get('p1').role, 'host');
  assert.ok(back.blocked.names instanceof Set && back.blocked.names.has('x'));
  assert.equal(back.content.slideshowTimer, undefined);
  assert.equal(back.content.page, 2);
});

test('participants who LEFT are pruned after the grace period; hosts are kept', () => {
  const store = require('../src/rooms/store');
  const { pruneLeftParticipants } = require('../src/rooms/lifecycle');
  const old = Date.now() - 11 * 60 * 1000;
  store.setMeeting('prun01', { code: 'prun01', participants: new Map([
    ['a', { id: 'a', role: 'participant', status: 'LEFT', leftAt: old }],
    ['b', { id: 'b', role: 'participant', status: 'LEFT', leftAt: Date.now() }],
    ['c', { id: 'c', role: 'cohost', status: 'LEFT', leftAt: old }],
    ['d', { id: 'd', role: 'participant', status: 'ACTIVE' }],
  ]) });
  assert.equal(pruneLeftParticipants(), 1);
  assert.deepEqual([...store.getMeeting('prun01').participants.keys()], ['b', 'c', 'd']);
  store.deleteMeeting('prun01');
});

test('inline data-URL chat attachments are off by default; uploaded URLs still work', () => {
  const { normalizeAttachment } = require('../src/lib/attachment');
  assert.equal(normalizeAttachment({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }), null);
  assert.equal(normalizeAttachment({ kind: 'image', url: '/files/abcdefghijkl/a.png' }).url, '/files/abcdefghijkl/a.png');
});

test('shared whiteboard caps come from config', () => {
  const plugin = require('../src/features/whiteboard/ws');
  const handlers = {};
  plugin.register({ broadcast() {}, sendToParticipant() {}, onWs: (t, fn) => { handlers[t] = fn; } });
  const meeting = { participants: new Map([['p', { id: 'p', name: 'P', status: 'ACTIVE' }]]) };
  for (let i = 0; i < 20; i++) handlers['wb-stroke']({ msg: { points: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]] }, participantId: 'p', meeting, meetingCode: 'x' });
  assert.ok(meeting.wbStrokes.length <= 8);
  assert.equal(meeting.wbStrokes[0].points.length, 5);
});
