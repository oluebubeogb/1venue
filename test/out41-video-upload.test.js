'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { describe, it, test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const skip = process.env.DB_DRIVER !== 'sqlite' && !process.env.DATABASE_URL ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
if (process.env.DB_DRIVER === 'sqlite') require('./helpers/server');

describe('out41 video upload path', () => {
  it('defaults video to 200 MB / 900 s when unset; compose and example no longer force 0', () => {
    const cfg = read('src/config.js');
    assert.match(cfg, /maxVideoBytes:\s*mb\('UPLOAD_MAX_VIDEO_MB',\s*200\)/);
    assert.match(cfg, /maxVideoSeconds:\s*int\('UPLOAD_MAX_VIDEO_SEC',\s*900\)/);
    const ex = read('.env.example');
    assert.match(ex, /UPLOAD_MAX_VIDEO_MB=200/);
    assert.match(ex, /UPLOAD_MAX_VIDEO_SEC=900/);
    assert.doesNotMatch(ex, /UPLOAD_MAX_VIDEO_MB=0/);
    const compose = read('docker-compose.yml');
    assert.match(compose, /UPLOAD_MAX_VIDEO_MB:-\s*200/);
    assert.match(compose, /UPLOAD_MAX_VIDEO_SEC:-\s*900/);
    assert.doesNotMatch(compose, /UPLOAD_MAX_VIDEO_MB:-\s*0}/);
  });

  it('does not cap direct-to-R2 video by the 25 MB through-Node MAX_UPLOAD_MB', () => {
    const up = read('src/venue/uploads.js');
    assert.match(up, /throughNode/);
    assert.match(up, /normalizeDurationSec/);
    const routes = read('src/features/files/routes.js');
    assert.match(routes, /throughNode:\s*false/);
    assert.match(routes, /presign ok/);
    assert.match(routes, /presign rejected/);
  });

  it('probes webm duration with the 1e101 seek and does not treat Infinity as over the cap', () => {
    const up = read('public/js/video-upload.js');
    assert.match(up, /parseDurationSec/);
    assert.match(up, /1e101/);
    assert.match(up, /dur && dur > maxSec/);
    assert.match(up, /durationSec: dur \|\| undefined/);
  });

  it('sends chat (all composers) and the material editor through the same presign path', () => {
    assert.match(read('public/js/ui.js'), /export function isVideoFile/);
    assert.match(read('public/js/ui.js'), /isVideoFile\(file\)/);
    assert.match(read('public/js/ui.js'), /uploadVideo/);
    assert.match(read('public/js/composer.js'), /isVideoFile/);
    assert.match(read('public/js/materials-lib.js'), /uploadVideo/);
    assert.match(read('public/js/app-pip.js'), /uploadFile/);
    assert.match(read('public/js/room/panels.js'), /uploadFile/);
  });

  it('bumps the cache versions', () => {
    assert.match(read('public/sw.js'), /VERSION = 'v97-2026-11-26'/);
    assert.match(read('public/index.html'), /app\.css\?v=83/);
    assert.match(read('public/index.html'), /app\.js\?v=83/);
  });

  it('normalizes missing, infinite, and millisecond durations', () => {
    const { normalizeDurationSec } = require('../src/venue/uploads');
    assert.equal(normalizeDurationSec(undefined), 0);
    assert.equal(normalizeDurationSec(null), 0);
    assert.equal(normalizeDurationSec(NaN), 0);
    assert.equal(normalizeDurationSec(Infinity), 0);
    assert.equal(normalizeDurationSec(-1), 0);
    assert.equal(normalizeDurationSec(12.5), 12.5);
    assert.equal(normalizeDurationSec(60), 60);
    assert.equal(normalizeDurationSec(60000), 60); // milliseconds
    assert.equal(normalizeDurationSec(900000), 900);
  });
});

test('presign accepts video/mp4 and video/webm under the caps', { skip, timeout: 60000 }, async () => {
  const { boot, client, signupPayload } = require('./helpers/server');
  const s = await boot({
    BILLING_WORKER: 'false', REMINDER_WORKER: 'false', REPLAY_WORKER: 'false',
    UPLOAD_MAX_VIDEO_MB: '200', UPLOAD_MAX_VIDEO_SEC: '900', MAX_UPLOAD_MB: '25',
  });
  const accepted = (r, label) => {
    const err = String((r.body && r.body.error) || '');
    assert.ok(r.status === 200 || r.status === 201 || r.status === 503, `${label} ${r.status} ${err}`);
    assert.doesNotMatch(err, /YouTube|turned off|length is missing/i);
    if (r.status >= 400) assert.match(err, /object storage|S3|R2|not available|need/i);
  };
  try {
    const user = client(s.base);
    await user.post('/api/signup', signupPayload());
    const cfg = await user.get('/api/config');
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    assert.equal(cfg.body.storage.limits.video, 200 * 1024 * 1024, JSON.stringify(cfg.body.storage.limits));
    assert.equal(cfg.body.storage.limits.videoSeconds, 900);

    accepted(await user.post('/api/files/presign', {
      filename: 'talk.mp4', mime: 'video/mp4', size: 5 * 1024 * 1024, durationSec: 60, purpose: 'content',
    }), 'mp4');
    accepted(await user.post('/api/files/presign', {
      filename: 'clip.webm', mime: 'video/webm', size: 3 * 1024 * 1024, durationSec: 45, purpose: 'chat',
    }), 'webm');
    // Unknown duration must not be rejected; size still caps.
    accepted(await user.post('/api/files/presign', {
      filename: 'unknown.webm', mime: 'video/webm', size: 1000, purpose: 'chat',
    }), 'missing duration');
    accepted(await user.post('/api/files/presign', {
      filename: 'inf.webm', mime: 'video/webm', size: 1000, durationSec: null, purpose: 'chat',
    }), 'null duration');
    // 60_000 looks like milliseconds for a 60s clip, not 16+ hours.
    accepted(await user.post('/api/files/presign', {
      filename: 'ms.webm', mime: 'video/webm', size: 1000, durationSec: 60_000, purpose: 'chat',
    }), 'duration in ms');

    const tooLong = await user.post('/api/files/presign', {
      filename: 'long.mp4', mime: 'video/mp4', size: 1000, durationSec: 2000, purpose: 'chat',
    });
    assert.equal(tooLong.status, 413, JSON.stringify(tooLong.body));
    assert.match(String(tooLong.body && tooLong.body.error || ''), /15 minutes/);

    const tooBig = await user.post('/api/files/presign', {
      filename: 'huge.webm', mime: 'video/webm', size: 300 * 1024 * 1024, durationSec: 60, purpose: 'chat',
    });
    assert.equal(tooBig.status, 413, JSON.stringify(tooBig.body));

    // Logging: a rejected presign leaves a reason in the runtime log.
    assert.match(s.output(), /\[upload\] presign rejected/);
    assert.match(s.output(), /15 minutes|too big|up to/i);
  } finally { await s.stop(); }
});
