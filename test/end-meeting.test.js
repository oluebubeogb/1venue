'use strict';
// Host end (including orphans), non-host denial, admin end-in-2-min, and
// rejoin not creating a new meeting. Needs DATABASE_URL or DB_DRIVER=sqlite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { boot, client, signupPayload, fundTestWallet } = require('./helpers/server');

const skip = !process.env.DATABASE_URL && process.env.DB_DRIVER !== 'sqlite' ? 'set DATABASE_URL or DB_DRIVER=sqlite' : false;
const root = path.join(__dirname, '..');
const tokenOf = (link) => new URL(link).searchParams.get('token');

function isolatedEnv(extra = {}) {
  const env = {
    RESTART_ADOPT_GRACE_MS: '0',
    SNAPSHOT_INTERVAL_MS: '0',
    SHUTDOWN_GRACE_MS: '200',
    ...extra,
  };
  if (process.env.DB_DRIVER === 'sqlite' || !process.env.DATABASE_URL) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-end-'));
    env.DB_DRIVER = 'sqlite';
    env.SQLITE_PATH = path.join(dir, 't.sqlite');
    env.STORAGE_DIR = path.join(dir, 'up');
  }
  return env;
}

async function sql(env, query, params = []) {
  const script = "const db=require('./db'); db.ensureReady().then(()=>db.q(process.argv[1], JSON.parse(process.argv[2]||'[]'))).then(r=>{process.stdout.write(JSON.stringify(r.rows||[]));return db.close();}).catch(e=>{console.error(e.stack||e.message);process.exit(1);});";
  const { stdout } = await execFile(process.execPath, ['-e', script, query, JSON.stringify(params)], {
    cwd: root,
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  return JSON.parse(stdout || '[]');
}

async function nodeEval(env, source, args = []) {
  const { stdout, stderr } = await execFile(process.execPath, ['-e', source, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  if (stderr && /error/i.test(stderr) && !stdout) throw new Error(stderr);
  return stdout;
}

async function signupHost(s, env) {
  const host = client(s.base);
  const body = signupPayload();
  const r = await host.post('/api/signup', body);
  assert.ok(r.status < 300, JSON.stringify(r.body) + ' ' + s.output());
  await fundTestWallet(s.base, host.jar.header(), 120, env);
  const me = await host.get('/api/session');
  return { host, body, userId: me.body.user.id };
}

async function createMeeting(host, name = 'End control') {
  const created = await host.post('/api/create', { name, participantName: 'Host Person' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  return created.body;
}

async function verifyAdmin(s, adminClient, email) {
  const link = await s.mailLink(email, /Confirm your email/);
  assert.ok(link, 'expected a confirmation email');
  const v = await adminClient.post('/api/auth/verify-email', { token: tokenOf(link) });
  assert.ok(v.status < 300, JSON.stringify(v.body));
}

test('wantsCreate: leftover create intent does not open a new meeting for an existing code', async () => {
  const mod = await import(pathToFileURL(path.join(root, 'public/js/room/intent.js')).href);
  const { wantsCreate } = mod;
  assert.equal(wantsCreate({ create: true }, 'a6thfq'), false);
  assert.equal(wantsCreate({ create: true }, 'a6thfq', { rejoin: '1' }), false);
  assert.equal(wantsCreate({ create: true, code: 'a6thfq' }, 'a6thfq'), true);
  assert.equal(wantsCreate({ create: true, code: 'a6-thf-q' }, 'a6thfq'), true);
  assert.equal(wantsCreate({ create: true, code: 'other1' }, 'a6thfq'), false);
  assert.equal(wantsCreate(null, 'a6thfq'), false);
  assert.equal(wantsCreate({ create: true, name: 'Instant meeting' }, null), true);
  assert.equal(wantsCreate({ create: true, code: 'a6thfq' }, 'a6thfq', { rejoin: '1' }), false);
});

test('an ended paid-entry session does not block a new meeting or debit unconfirmed usage', { skip }, async () => {
  const env = isolatedEnv();
  const s = await boot(env);
  try {
    const { host, userId } = await signupHost(s, env);
    const now = Date.now();
    const endedAt = new Date(now - 60_000);
    const startedAt = new Date(now - 120_000);
    const code = 'old123';
    const [history] = await sql(env, `INSERT INTO meeting_history
      (code,name,host_user_id,host_display_name,created_at,ended_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [code, 'Ended paid meeting', userId, 'Host', startedAt.toISOString(), endedAt.toISOString()]);
    await sql(env, `INSERT INTO paid_meeting_sessions
      (code,history_id,host_user_id,entry_units,duration_min,started_ms,advertised_end_ms,runtime_end_ms,billing_model)
      VALUES($1,$2,$3,1,1,$4,$5,$5,'usage')`, [code, history.id, userId, startedAt.getTime(), now + 600_000]);
    const [entry] = await sql(env, `INSERT INTO paid_meeting_entries
      (code,user_id,participant_id,entry_units,accepted_at_ms) VALUES($1,$2,'old-host',0,$3) RETURNING id`,
    [code, userId, startedAt.getTime()]);
    await sql(env, `INSERT INTO paid_usage_meters
      (code,user_id,participant_id,is_host,state,connected_since_ms,accounted_ms,entry_id)
      VALUES($1,$2,'old-host',true,'active',$3,$3,$4)`, [code, userId, startedAt.getTime(), entry.id]);
    const balance = (await host.get('/api/wallet')).body.balanceCredits;
    const sessions = (await host.get('/api/history')).body.history;
    assert.ok(sessions.find((h) => h.code === code)?.endedAt);

    const next = await createMeeting(host, 'New room');
    const [old] = await sql(env, 'SELECT state,ended_ms FROM paid_meeting_sessions WHERE code=$1', [code]);
    assert.equal(old.state, 'settled');
    assert.equal(Number(old.ended_ms), endedAt.getTime());
    const [meter] = await sql(env, 'SELECT state,billed_units FROM paid_usage_meters WHERE code=$1', [code]);
    assert.equal(meter.state, 'closed');
    assert.equal(Number(meter.billed_units), 0);
    assert.equal((await host.get('/api/wallet')).body.balanceCredits, balance);

    const blocked = await host.post('/api/create', { name: 'Blocked room', participantName: 'Host Person', meetingAccessMode: 'paid_entry' });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.body.activeMeeting.code, next.code);
    const current = (await host.get('/api/history')).body.history;
    assert.equal(Number(blocked.body.activeMeeting.historyId), Number(current.find((h) => h.code === next.code).id));
    assert.equal(current.length, 2, 'a blocked paid-entry attempt must not leave a phantom session');
  } finally {
    await s.stop();
  }
});

test('host can end an orphaned meeting without an extra charge; a non-host cannot end', { skip }, async () => {
  const env = isolatedEnv();
  let s = await boot(env);
  try {
    const { host, userId } = await signupHost(s, env);
    const guest = client(s.base);
    assert.ok((await guest.post('/api/signup', signupPayload())).status < 300);
    const room = await createMeeting(host);
    const code = room.code;
    const history = await sql(env, 'SELECT id, ended_at FROM meeting_history WHERE lower(replace(replace(code,\'-\',\'\'),\' \',\'\'))=$1', [String(code).toLowerCase().replace(/[^a-z0-9]/g, '')]);
    assert.equal(history.length, 1);
    const historyId = history[0].id;
    const billingBefore = (await sql(env, 'SELECT id, state, charged_units, accounted_ms FROM credit_billing_sessions WHERE history_id=$1', [historyId]))[0];
    assert.ok(billingBefore, 'expected a billing session');
    const chargedBefore = Number(billingBefore.charged_units || 0);

    const forbidden = await guest.post(`/api/meeting/${code}/end`);
    assert.equal(forbidden.status, 403, JSON.stringify(forbidden.body));
    const stillOpen = await sql(env, 'SELECT ended_at FROM meeting_history WHERE id=$1', [historyId]);
    assert.equal(stillOpen[0].ended_at, null);

    await s.stop();
    s = null;

    const out = await nodeEval(env, `
      const db=require('./db');
      const end=require('./src/rooms/end-control');
      (async()=>{
        await db.ensureReady();
        const r=await end.endByHost(process.argv[1],{id:Number(process.argv[2])});
        process.stdout.write(JSON.stringify(r));
        await db.close();
      })().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
    `, [code, String(userId)]);
    const ended = JSON.parse(out);
    assert.equal(ended.ok, true);
    assert.equal(ended.onServer, false);
    assert.equal(ended.alreadyEnded, undefined);

    const after = (await sql(env, 'SELECT ended_at FROM meeting_history WHERE id=$1', [historyId]))[0];
    assert.ok(after.ended_at, 'orphaned meeting should have ended_at');
    const billingAfter = (await sql(env, 'SELECT state, charged_units, end_reason FROM credit_billing_sessions WHERE history_id=$1', [historyId]))[0];
    assert.ok(billingAfter);
    assert.notEqual(billingAfter.state, 'active');
    assert.equal(Number(billingAfter.charged_units || 0), chargedBefore, 'orphan end must not charge past accounted_ms');

    const again = JSON.parse(await nodeEval(env, `
      const db=require('./db');
      const end=require('./src/rooms/end-control');
      (async()=>{
        await db.ensureReady();
        const r=await end.endByHost(process.argv[1],{id:Number(process.argv[2])});
        process.stdout.write(JSON.stringify(r));
        await db.close();
      })().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
    `, [code, String(userId)]));
    assert.equal(again.ok, true);
    assert.equal(again.alreadyEnded, true);
  } finally {
    if (s) await s.stop();
  }
});

test('admin end-in-2-min expires with no participants and can be cancelled by keep-alive', { skip }, async () => {
  const adminBody = signupPayload();
  const env = isolatedEnv({ ADMIN_EMAILS: adminBody.email });
  let s = await boot(env);
  try {
    const { host } = await signupHost(s, env);
    const room = await createMeeting(host, 'Countdown room');
    const code = room.code;
    const hist = (await sql(env, 'SELECT id FROM meeting_history WHERE lower(replace(replace(code,\'-\',\'\'),\' \',\'\'))=$1', [String(code).toLowerCase().replace(/[^a-z0-9]/g, '')]))[0];
    const chargedBefore = Number((await sql(env, 'SELECT charged_units FROM credit_billing_sessions WHERE history_id=$1', [hist.id]))[0].charged_units || 0);

    await s.stop();
    s = null;
    await sql(env, 'UPDATE meeting_history SET end_warning_deadline_ms=$1 WHERE id=$2', [Date.now() - 1, hist.id]);
    const tickOut = await nodeEval(env, `
      const db=require('./db');
      const end=require('./src/rooms/end-control');
      db.ensureReady().then(()=>end.tick(Date.now())).then(()=>db.close()).then(()=>process.stdout.write('ok'));
    `);
    assert.equal(tickOut.trim(), 'ok');
    const expired = (await sql(env, 'SELECT ended_at FROM meeting_history WHERE id=$1', [hist.id]))[0];
    assert.ok(expired.ended_at, 'countdown should end an orphaned / empty meeting');
    const billingAfter = (await sql(env, 'SELECT state, charged_units FROM credit_billing_sessions WHERE history_id=$1', [hist.id]))[0];
    assert.notEqual(billingAfter.state, 'active');
    assert.equal(Number(billingAfter.charged_units || 0), chargedBefore);

    s = await boot(env);
    const { host: host2 } = await signupHost(s, env);
    const live = await createMeeting(host2, 'Keep-alive room');
    const liveCode = live.code;
    const admin = client(s.base);
    assert.ok((await admin.post('/api/signup', adminBody)).status < 300);
    await verifyAdmin(s, admin, adminBody.email);

    const list = await admin.get('/api/admin/meetings');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = (list.body.meetings || []).find((m) => String(m.code).toLowerCase().replace(/[^a-z0-9]/g, '') === String(liveCode).toLowerCase().replace(/[^a-z0-9]/g, ''));
    assert.ok(row, 'open meetings should include the live room');
    assert.equal(row.onServer, true);
    assert.ok(row.participantCount >= 1);

    const forbidden = await host2.post(`/api/admin/meetings/${liveCode}/end-in`, { ms: 4000 });
    assert.equal(forbidden.status, 403);

    const scheduled = await admin.post(`/api/admin/meetings/${liveCode}/end-in`, { ms: 4000 });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.warning.status, 'pending');

    const kept = await host2.post(`/api/meeting/${liveCode}/keep`);
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    assert.equal(kept.body.kept, true);

    await new Promise((r) => setTimeout(r, 4500));
    const still = (await sql(env, 'SELECT ended_at, end_warning_kept_at FROM meeting_history WHERE lower(replace(replace(code,\'-\',\'\'),\' \',\'\'))=$1 ORDER BY created_at DESC LIMIT 1', [String(liveCode).toLowerCase().replace(/[^a-z0-9]/g, '')]))[0];
    assert.equal(still.ended_at, null, 'keep-alive should cancel the countdown');
    assert.ok(still.end_warning_kept_at, 'admin list should show the meeting was kept');
    const listed = await admin.get('/api/admin/meetings');
    const keptRow = (listed.body.meetings || []).find((m) => String(m.code).toLowerCase().replace(/[^a-z0-9]/g, '') === String(liveCode).toLowerCase().replace(/[^a-z0-9]/g, ''));
    assert.ok(keptRow);
    assert.equal(keptRow.warning && keptRow.warning.status, 'kept');

    const again = await admin.post(`/api/admin/meetings/${liveCode}/end-in`, { ms: 8000 });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const cancelled = await admin.post(`/api/admin/meetings/${liveCode}/cancel-end`);
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.cancelled, true);
    const afterCancel = (await sql(env, 'SELECT ended_at, end_warning_deadline_ms FROM meeting_history WHERE lower(replace(replace(code,\'-\',\'\'),\' \',\'\'))=$1 ORDER BY created_at DESC LIMIT 1', [String(liveCode).toLowerCase().replace(/[^a-z0-9]/g, '')]))[0];
    assert.equal(afterCancel.ended_at, null);
    assert.equal(afterCancel.end_warning_deadline_ms, null);
  } finally {
    if (s) await s.stop();
  }
});

test('rejoin / join of an existing code does not create a new meeting', { skip }, async () => {
  const env = isolatedEnv();
  const s = await boot(env);
  try {
    const { host } = await signupHost(s, env);
    const room = await createMeeting(host, 'Rejoin existing');
    const code = room.code;
    const before = await sql(env, 'SELECT id, code FROM meeting_history');
    assert.equal(before.length, 1);

    const session = await host.get('/api/history?limit=10');
    assert.equal(session.status, 200);
    const id = (session.body.history || [])[0].id;
    const detail = await host.get(`/api/sessions/${id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.live, true);
    assert.equal(detail.body.isHost, true);
    assert.equal(String(detail.body.code).toLowerCase().replace(/[^a-z0-9]/g, ''), String(code).toLowerCase().replace(/[^a-z0-9]/g, ''));

    const joined = await host.post('/api/join', { code, participantName: 'Host Person' });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(String(joined.body.code).toLowerCase().replace(/[^a-z0-9]/g, ''), String(code).toLowerCase().replace(/[^a-z0-9]/g, ''));

    const createAgain = await host.post('/api/create', { name: 'Should not replace', participantName: 'Host Person' });
    assert.equal(createAgain.status, 409, JSON.stringify(createAgain.body));

    const after = await sql(env, 'SELECT id, code FROM meeting_history');
    assert.equal(after.length, 1, 'join must not insert a second meeting_history row');
    assert.equal(after[0].id, before[0].id);
  } finally {
    await s.stop();
  }
});
