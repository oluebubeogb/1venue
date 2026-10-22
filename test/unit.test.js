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
