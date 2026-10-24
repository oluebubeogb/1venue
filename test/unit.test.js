'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const bible = require('../src/venue/bible');
const stt = require('../src/venue/stt');
const qr = require('../src/venue/qr');
const logo = require('../src/venue/logo');
const config = require('../src/config');

test('config exposes sane defaults', () => {
  assert.ok(config.BIBLE && config.BIBLE.defaultTranslation);
});

test('bible: references parse (single verse, ranges, lists, numbered books)', () => {
  assert.deepEqual(bible.parseReference('John 3:16'), { book: 'JHN', bookName: bible.parseReference('John 3:16').bookName, chapter: 3, verses: [16] });
  assert.deepEqual(bible.parseReference('psalm 23:1-3').verses, [1, 2, 3]);
  assert.deepEqual(bible.parseReference('Rom 8:28, 31-32').verses, [28, 31, 32]);
  const c = bible.parseReference('1 Cor 13');
  assert.equal(c.chapter, 13); assert.equal(c.verses, null);
  assert.equal(bible.parseReference('Genesis 99'), null, 'chapter out of range');
  assert.equal(bible.parseReference('hello world'), null);
});

test('bible: translations are open-licensed and resolvable', () => {
  assert.ok(bible.TRANSLATIONS.length >= 10);
  for (const t of bible.TRANSLATIONS) assert.ok(t.license || t.licence, `licence for ${t.id}`);
  assert.ok(!bible.TRANSLATIONS.some((t) => /good\s*news|\bgnt\b/i.test(`${t.id} ${t.name}`)), 'GNT is copyrighted and must not be bundled');
  assert.equal(bible.resolveTranslation('KJV').id.toLowerCase(), 'eng_kjv');
  assert.ok(bible.resolveTranslation('does-not-exist'), 'falls back to default');
});

test('stt: clean() trims and drops Whisper hallucinations', () => {
  assert.equal(stt.clean('  hello   there \n'), 'hello there');
  assert.equal(stt.clean('Thanks for watching!'), '');
  assert.ok(stt.LANG_MODELS);
});

test('transcript lines are formatted "Name: text" and merge consecutive speech', () => {
  const { transcriptToText } = require('../src/venue/data');
  const t0 = Date.parse('2026-10-22T10:00:00Z');
  const txt = transcriptToText([
    { speakerName: 'John', text: 'This is very important', at: new Date(t0) },
    { speakerName: 'John', text: 'to pay now', at: new Date(t0 + 3000) },
    { speakerName: 'Adaeze', text: 'Not likely', at: new Date(t0 + 6000) },
  ]);
  assert.match(txt, /John: This is very important to pay now/);
  assert.match(txt, /Adaeze: Not likely/);
});

test('qr + logo produce branded SVG', () => {
  const s = qr.svg('https://venue.example/e/abc');
  assert.match(s, /^<svg|<svg/); assert.ok(s.length > 1000);
  assert.match(logo.svg(), /<svg/);
});

test('command bar fuzzy + synonym matching', async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '../public/js/commands.js')).href);
  m.registerCommands('t', [
    { id: 'bible', label: 'Open Bible', group: 'nav', keywords: ['scripture', 'verse'] },
    { id: 'mic', label: 'Toggle microphone', group: 'media', keywords: 'mute unmute' },
    { id: 'wb', label: 'Whiteboard', group: 'tools', keywords: ['draw', 'sketch'] },
  ]);
  const top = (q) => (m.searchCommands(q)[0] || {}).id;
  assert.equal(top('bibel'), 'bible', 'typo tolerant');
  assert.equal(top('scripture'), 'bible', 'keyword');
  assert.equal(top('mute'), 'mic', 'string keywords work');
  assert.equal(top('audio'), 'mic', 'synonym');
  assert.equal(top('draw'), 'wb');
  assert.equal(m.searchCommands('zzqx').length, 0);
  m.unregisterCommands('t');
});

test('whiteboard core: v1 .mwb import, normalisation and v2 round-trip', async () => {
  const wb = await import(pathToFileURL(path.join(__dirname, '../public/js/wbcore.js')).href);
  const v1 = { format: 'mwb', version: 1, activeBoard: 1, boards: [
    { index: 0, strokes: [{ points: [{ x: 0, y: 0 }, { x: 1920, y: 1080 }], color: '#000000', width: 2, baseWidth: 2, tool: 'pencil' }], texts: [{ id: 't', x: 96, y: 54, text: 'Hi', fontSize: 40, color: '#2563eb' }] },
    { index: 1, strokes: [{ points: [{ x: 10, y: 10 }], color: '#16a34a', width: 4, tool: 'brush' }, { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], erase: true, width: 3 }], texts: [] },
  ] };
  const d = wb.normalizeBoard(v1);
  assert.equal(d.version, 2);
  assert.equal(d.pages.length, 2);
  assert.equal(d.activePage, 1);
  const s = d.pages[0].strokes[0];
  assert.equal(s.tool, 'pencil');
  assert.equal(s.color, 'ink', 'legacy black maps to theme ink');
  assert.ok(Math.abs(s.points[1][0] - 1600) < 1, 'scaled to the 1600-wide page');
  assert.equal(d.pages[0].texts[0].text, 'Hi');
  assert.equal(d.pages[1].strokes[1].tool, 'eraser');
  // junk is dropped, unsafe image URLs are rejected
  const n = wb.normalizeBoard({ pages: [{ strokes: [{ points: 'x' }, null], images: [{ url: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 }, { url: '/files/abc', x: 0, y: 0, w: 10, h: 10 }], texts: [] }] });
  assert.equal(n.pages[0].strokes.length, 0);
  assert.deepEqual(n.pages[0].images.map((i) => i.url), ['/files/abc']);
  assert.equal(wb.normalizeBoard(null).pages.length, 1);
  // gzip round trip
  const blob = await wb.toMwb(d, { title: 'Test board', inline: false });
  const u8 = new Uint8Array(await blob.arrayBuffer());
  assert.ok(wb.isGzip(u8));
  const back = await wb.fromMwbBytes(u8);
  assert.equal(back.title, 'Test board');
  assert.equal(back.doc.pages.length, 2);
  assert.deepEqual(back.doc.pages[0].strokes[0].points, d.pages[0].strokes[0].points);
  // plain (non-gzipped) v1 JSON also imports
  const plain = await wb.fromMwbBytes(new TextEncoder().encode(JSON.stringify(v1)));
  assert.equal(plain.doc.pages.length, 2);
  await assert.rejects(() => wb.fromMwbBytes(new TextEncoder().encode('{"hello":1}')));
});

test('content sharing: only youtube/slides/image with safe sources', () => {
  const { sanitizeContent } = require('../src/plugins/content.js');
  assert.equal(sanitizeContent({ contentType: 'url', url: 'https://example.com' }), null);
  assert.equal(sanitizeContent({ contentType: 'video', url: '/files/a/b.mp4' }), null);
  assert.equal(sanitizeContent({ contentType: 'youtube', videoId: 'bad id' }), null);
  assert.equal(sanitizeContent({ contentType: 'youtube', videoId: 'M7lc1UVf-VE' }).url, 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  const s = sanitizeContent({ contentType: 'slides', pages: ['/files/ab-1/p1.jpg', 'javascript:alert(1)', 'https://evil/x.jpg', '/files/../x'] });
  assert.deepEqual(s.pages, ['/files/ab-1/p1.jpg']);
  assert.equal(sanitizeContent({ contentType: 'image', url: 'https://evil/x.png' }), null);
});
