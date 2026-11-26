'use strict';
const { describe, it, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('certificate layout and create-page funding', () => {
  it('uses typable signatories only and retries unique cert codes', () => {
    const { normalizeCerts } = require('../src/features/certificates/service');
    const src = read('src/features/certificates/service.js');
    assert.match(src, /isUniqueViolation/);
    assert.match(src, /attempt < 4/);
    const c = normalizeCerts({
      signatories: [
        { name: 'Ada', role: 'Director', source: 'account', username: 'ada', signatureUrl: 'https://x' },
        { name: '', role: 'Ignore' },
      ],
    });
    assert.deepEqual(c.signatories, [{ name: 'Ada', role: 'Director' }]);
    assert.doesNotMatch(read('src/features/certificates/pdf.js'), /drawSeal|Verify/);
    assert.doesNotMatch(read('public/js/cert-ui.js'), /signature\/clean|1venue account/);
    assert.match(read('public/js/cert-ui.js'), /cert-mini/);
    assert.match(read('public/js/pages/create.js'), /certsEl\.preview/);
    assert.match(read('public/js/pages/create.js'), /Free entry/);
    assert.match(read('public/js/pages/create.js'), /Paid entry/);
    assert.doesNotMatch(read('public/js/pages/create.js'), /Advertised duration/);
    assert.doesNotMatch(read('public/js/pages/create.js'), /Entry price \(credits\)/);
    assert.doesNotMatch(read('src/features/events/data.js'), /Paid entry requires an advertised duration/);
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
  });

  it('renders the four designs with the shared centred layout', async () => {
    const { certificatePdf } = require('../src/features/certificates/pdf');
    for (const design of ['classic', 'modern', 'minimal', 'elegant']) {
      const buf = await certificatePdf({
        name: 'Ada Lovelace', certTitle: 'Certificate of Attendance',
        opener: 'This is to certify that', bodyId: 'attended',
        programme: 'Music as Inner Peace', issuerName: 'Harmon House',
        date: '25 November 2026', signatories: [{ name: 'Chinedu Okoye', role: 'Director' }],
        code: 'ABCDE12345', url: 'https://1venue.live/cert/ABCDE12345', accent: '#7c3aed', design,
      });
      assert.ok(buf.length > 2000);
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    }
  });
});

test('a meeting event can be paid entry without a duration or price tag', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const s = await boot();
  try {
    const host = client(s.base);
    await host.post('/api/signup', signupPayload());
    const ev = await host.post('/api/events', {
      title: 'Usage Meeting', category: 'meeting', visibility: 'public',
      meetingAccessMode: 'paid_entry',
    });
    assert.equal(ev.status, 200, JSON.stringify(ev.body));
    assert.equal(ev.body.meetingAccessMode, 'paid_entry');
    assert.equal(ev.body.meetingDurationMin, null);
    assert.equal(ev.body.meetingEntryPriceCredits, null);
  } finally { await s.stop(); }
});
