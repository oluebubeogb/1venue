'use strict';
// Folder conventions for feature work (no database needed). If one of these fails, the message
// says which file breaks the convention.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const features = require('../src/core/features');

test('features are discovered from src/features, _template is skipped, ids are unique', () => {
  const list = features.list();
  const ids = list.map((f) => f.id);
  assert.ok(ids.length >= 30, 'expected the built-in features');
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature id');
  assert.ok(!ids.includes('myFeature') && !list.some((f) => f.name.startsWith('_')), '_template must not load');
  for (const f of list) assert.equal(f.id, f.name, `src/features/${f.name}/index.js id must match its folder name`);
});

test('WebSocket plugins load in the same order as before the restructure', () => {
  const order = features.list().filter((f) => f.ws).map((f) => require(f.ws).id);
  assert.deepEqual(order, ['chat', 'reactions', 'mute', 'deviceIcons', 'content', 'moderation', 'activity', 'recording', 'screenTimeline', 'privateChat', 'groupChat', 'breakout', 'whiteboard', 'sounds', 'stage', 'polls', 'qa', 'comments', 'scripture', 'captions', 'wbShare']);
});

test('FEATURE_<NAME> env names', () => {
  assert.equal(features.envName('groupChat'), 'FEATURE_GROUP_CHAT');
  assert.equal(features.envName('wbShare'), 'FEATURE_WB_SHARE');
});

test('every routes.js / http.js exports a function; API routes are unique', () => {
  for (const f of features.list()) {
    if (f.routes) assert.equal(typeof require(f.routes), 'function', `${f.name}/routes.js`);
    if (f.http) assert.equal(typeof require(f.http), 'function', `${f.name}/http.js`);
  }
  const seen = new Set();
  for (const r of require('../src/core/router').list()) {
    const k = r.method + ' ' + r.pattern;
    assert.ok(!seen.has(k), `route registered twice: ${k} (${r.feature})`);
    seen.add(k);
  }
});

test('the old venue/data.js facade still exposes every query', () => {
  const data = require('../src/venue/data');
  assert.ok(Object.keys(data).length >= 90);
  for (const [k, v] of Object.entries(data)) assert.notEqual(v, undefined, k);
});

test('migrations: valid names, no duplicates, new ones use a 14-digit UTC timestamp', () => {
  const files = require('../db').migrationFiles(); // throws on duplicate names
  const names = files.map((f) => f.name);
  assert.deepEqual(names, [...names].sort());
  for (const n of names) {
    assert.match(n, /^\d+_[a-z0-9_]+\.sql$/, n);
    const num = n.split('_')[0];
    if (num.length !== 3) assert.match(num, /^20\d{12}$/, `${n}: use npm run migration:new`);
  }
});

test('browser message handlers: each room message type has exactly one owner', () => {
  const core = fs.readFileSync(path.join(ROOT, 'public/js/room/wsHandlers.js'), 'utf8');
  const owner = new Map();
  for (const m of core.matchAll(/case '([\w-]+)'/g)) owner.set(m[1], 'core');
  for (const f of features.list()) {
    if (!f.clientWs) continue;
    const src = fs.readFileSync(path.join(f.dir, 'client/ws.js'), 'utf8');
    assert.match(src, /from '\/js\/room\/registry\.js'/, `${f.name}/client/ws.js must import the registry by absolute path`);
    for (const m of src.matchAll(/onMessage\((\[[^\]]+\]|'[\w-]+')/g)) {
      for (const t of m[1].match(/[\w-]+/g)) {
        assert.ok(!owner.has(t), `"${t}" handled by both ${owner.get(t)} and ${f.name}`);
        owner.set(t, f.name);
      }
    }
  }
  assert.ok(owner.size >= 85);
});
