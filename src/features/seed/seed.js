/**
 * Demo ("seed") data: load and remove.
 *
 *   load()    removes any previous seed, then creates 10 accounts (password "@1venued") with
 *             activity across every feature: events, RSVPs, speakers, posts, likes, comments,
 *             follows, venues, materials, whiteboards, DMs, scheduled meetings and past sessions
 *             (chat, polls, Q&A, transcripts, AI summaries, attendance lists).
 *   remove()  deletes exactly what load() created. Seed users carry users.is_seed = true and
 *             everything they own cascades with them; rows that would otherwise survive
 *             (meeting history, comments, DMs, chat) are tracked in seed_rows or removed
 *             through their seed owner. Real accounts are never touched.
 *   status()  counts.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { tx, one, many } = require('../../core/db');
const { randCode } = require('../../lib/codes');
const F = require('./fixtures');

const DAY = 86_400_000;
const hex = (n) => crypto.randomBytes(n).toString('hex');
const slug = (s) => `${String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}-${hex(3)}`;
// Deterministic pseudo-random choice, so every load looks the same.
const pick = (arr, seed, n) => { const out = []; let x = seed * 9301 + 49297; for (let i = 0; i < arr.length && out.length < n; i++) { x = (x * 9301 + 49297) % 233280; const v = arr[(x + i) % arr.length]; if (!out.includes(v)) out.push(v); } return out; };

async function uniqueCode(c) {
  for (let i = 0; i < 30; i++) {
    const code = randCode(6);
    const hit = await c.query(`SELECT 1 FROM events WHERE code=$1 UNION ALL SELECT 1 FROM venues WHERE lower(code)=$1 UNION ALL SELECT 1 FROM meeting_history WHERE code=$1 LIMIT 1`, [code]);
    if (!hit.rows.length) return code;
  }
  throw new Error('Could not allocate a code');
}

async function removeIn(c) {
  const ids = (await c.query('SELECT id FROM users WHERE is_seed')).rows.map((r) => r.id);
  const tracked = async (tbl) => (await c.query('SELECT row_id FROM seed_rows WHERE tbl=$1', [tbl])).rows.map((r) => r.row_id);
  const histIds = [...new Set([...(await tracked('meeting_history')).map(Number),
    ...(await c.query('SELECT id FROM meeting_history WHERE host_user_id = ANY($1::int[])', [ids])).rows.map((r) => r.id)])];
  const eventIds = (await c.query('SELECT id::text FROM events WHERE host_user_id = ANY($1::int[])', [ids])).rows.map((r) => r.id);
  const postIds = (await c.query('SELECT id::text FROM posts WHERE user_id = ANY($1::int[])', [ids])).rows.map((r) => r.id);
  const keys = ids.map((i) => `u:${i}`);
  const counts = { users: ids.length };
  const del = async (name, sql, p) => { counts[name] = (counts[name] || 0) + (await c.query(sql, p)).rowCount; };

  await del('comments', `DELETE FROM comments WHERE id = ANY($1::bigint[]) OR user_id = ANY($2::int[])
    OR (target_type='event' AND target_key = ANY($3::text[])) OR (target_type='post' AND target_key = ANY($4::text[]))`,
  [(await tracked('comments')).map(Number), ids, eventIds, postIds]);
  await del('commentLikes', 'DELETE FROM comment_likes WHERE liker_key = ANY($1::text[])', [keys]);
  await del('chatMessages', 'DELETE FROM chat_messages WHERE meeting_history_id = ANY($1::int[]) OR sender_user_id = ANY($2::int[])', [histIds, ids]);
  await del('chatGroups', 'DELETE FROM chat_groups WHERE meeting_history_id = ANY($1::int[]) OR created_by_user_id = ANY($2::int[])', [histIds, ids]);
  await del('pollVotes', 'DELETE FROM poll_votes WHERE voter_key = ANY($1::text[])', [keys]);
  await del('questionVotes', 'DELETE FROM question_votes WHERE voter_key = ANY($1::text[])', [keys]);
  await del('recordings', 'DELETE FROM meeting_recordings WHERE meeting_history_id = ANY($1::int[])', [histIds]);
  await c.query('UPDATE venues SET active_history_id=NULL WHERE active_history_id = ANY($1::int[])', [histIds]);
  await c.query('UPDATE events SET meeting_history_id=NULL WHERE meeting_history_id = ANY($1::int[])', [histIds]);
  await del('sessions', 'DELETE FROM meeting_history WHERE id = ANY($1::int[])', [histIds]);
  await del('participantLogs', 'DELETE FROM meeting_participants_log WHERE user_id = ANY($1::int[])', [ids]);
  await del('memberships', 'DELETE FROM meeting_membership WHERE user_id = ANY($1::int[])', [ids]);
  await del('dmThreads', 'DELETE FROM dm_threads WHERE user_a_id = ANY($1::int[]) OR user_b_id = ANY($1::int[]) OR id = ANY($2::int[])', [ids, (await tracked('dm_threads')).map(Number)]);
  await del('files', 'DELETE FROM files WHERE owner_user_id = ANY($1::int[])', [ids]);
  // Everything else (events, RSVPs, speakers, posts, likes, follows, venues, materials,
  // whiteboards, prefs, scheduled meetings, sessions) cascades from the user rows.
  await c.query('DELETE FROM users WHERE is_seed');
  await c.query('DELETE FROM seed_rows');
  return counts;
}

async function remove() { return tx(removeIn); }

async function load({ now = Date.now() } = {}) {
  const hash = await bcrypt.hash(F.PASSWORD, 10);
  return tx(async (c) => {
    await removeIn(c);
    const track = (tbl, id) => c.query('INSERT INTO seed_rows (tbl, row_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tbl, String(id)]);
    const ins = async (sql, p) => (await c.query(sql, p)).rows[0];
    const U = {};

    // ---- users (all profile fields filled, email verified, phone set)
    for (const [i, u] of F.USERS.entries()) {
      let username = u.username;
      for (let n = 2; (await c.query('SELECT 1 FROM users WHERE lower(username)=$1 OR lower(handle)=$1', [username])).rows.length; n++) username = `${u.username}${n}`.slice(0, 30);
      const row = await ins(`INSERT INTO users (username, email, password_hash, display_name, avatar_url, bio, handle, phone, phone_verified,
          email_verified_at, password_changed_at, plan, is_seed, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$1,$7,true,NOW(),NOW(),'free',true,$8)
        ON CONFLICT DO NOTHING RETURNING *`,
      [username, u.email, hash, u.name, u.avatar, u.bio, u.phone, new Date(now - (60 - i * 3) * DAY)]);
      if (!row) throw Object.assign(new Error(`Seed email ${u.email} already belongs to a real account`), { status: 409 });
      U[u.key] = { ...row, name: u.name, avatar: u.avatar };
      await c.query(`INSERT INTO user_prefs (user_id, theme, accent, accent2, font_scale, reduce_motion, bible_translation, extra)
        VALUES ($1,$2,$3,$4,1,false,$5,'{}') ON CONFLICT (user_id) DO NOTHING`, [row.id, u.prefs.theme, u.prefs.accent, u.prefs.accent2, u.prefs.bible]);
    }
    const keys = Object.keys(U);
    const uid = (k) => U[k].id;

    // ---- follows: everyone follows 4–6 others
    let follows = 0;
    for (const [i, k] of keys.entries()) {
      for (const other of pick(keys.filter((x) => x !== k), i + 1, 4 + (i % 3))) {
        await c.query('INSERT INTO follows (follower_id, followee_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid(k), uid(other), new Date(now - (20 - i) * DAY)]);
        follows++;
      }
    }

    // ---- events (+ speakers, RSVPs, scheduled posts, comments)
    const E = [];
    const day0 = new Date(now); day0.setUTCHours(17, 0, 0, 0); // 6 pm Lagos
    for (const [i, [host, title, category, cover, language, tags, days, hours, speakers, description]] of F.EVENTS.entries()) {
      const starts = new Date(day0.getTime() + days * DAY);
      const ends = new Date(starts.getTime() + hours * 3600_000);
      const past = days < 0;
      const ev = await ins(`INSERT INTO events (slug, code, host_user_id, host_name, title, description, category, tags, language, visibility,
          status, starts_at, ends_at, started_at, ended_at, cover_url, theme, speaker_seats, settings, peak_viewers, total_joins, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'public',$10,$11,$12,$13,$14,$15,$16,$17,'{}',$18,$19,$20) RETURNING *`,
      [slug(title), await uniqueCode(c), uid(host), U[host].name, title, description, category, tags, language,
        past ? 'ended' : 'scheduled', starts, ends, past ? starts : null, past ? ends : null, F.COVERS[cover],
        JSON.stringify({}), Math.max(4, speakers.length + 1), past ? 8 + i * 3 : 0, past ? 14 + i * 5 : 0, new Date(now - (14 - (i % 7)) * DAY)]);
      E.push({ ...ev, hostKey: host, past });
      for (const [j, sp] of [host, ...speakers].entries()) {
        await c.query('INSERT INTO event_speakers (event_id, user_id, display_name, headline, avatar_url, sort_order, email) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [ev.id, uid(sp), U[sp].name, j === 0 ? 'Host' : F.USERS.find((u) => u.key === sp).bio.split('.')[0].slice(0, 80), U[sp].avatar, j, U[sp].email]);
      }
      for (const r of pick(keys.filter((x) => x !== host), i + 3, 3 + (i % 5))) {
        await c.query('INSERT INTO event_rsvps (event_id, user_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ev.id, uid(r), new Date(now - (i % 4) * DAY)]);
      }
      if (!past) await c.query(`INSERT INTO posts (user_id, event_id, kind, body, media, created_at) VALUES ($1,$2,'event_scheduled',$3,'[]',$4)`, [uid(host), ev.id, title, ev.created_at]);
    }

    // ---- comments (+ replies, likes) on events and posts
    let comments = 0;
    const comment = async (type, key, k, body, parentId = null, at = new Date(now - DAY)) => {
      const r = await ins(`INSERT INTO comments (target_type, target_key, parent_id, user_id, author_key, author_name, body, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [type, String(key), parentId, uid(k), `u:${uid(k)}`, U[k].name, body, at]);
      await track('comments', r.id);
      if (parentId) await c.query('UPDATE comments SET reply_count = reply_count + 1 WHERE id=$1', [parentId]);
      comments++;
      return r.id;
    };
    for (const [i, ev] of E.entries()) {
      for (const [j, k] of pick(keys.filter((x) => x !== ev.hostKey), i + 7, 2).entries()) {
        const id = await comment('event', ev.id, k, F.COMMENTS[(i + j) % F.COMMENTS.length]);
        if (j === 0) await comment('event', ev.id, ev.hostKey, 'Thank you! See you there.', id);
        for (const l of pick(keys, i + j, 3)) await c.query('INSERT INTO comment_likes (comment_id, liker_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, `u:${uid(l)}`]);
        await c.query('UPDATE comments SET like_count = (SELECT COUNT(*) FROM comment_likes WHERE comment_id=$1) WHERE id=$1', [id]);
      }
    }

    // ---- posts (text, photos, scripture cards, recaps) with likes and comments
    const P = [];
    for (const [i, [author, body, cover, daysAgo, passage]] of F.POSTS.entries()) {
      const media = [];
      if (cover) media.push({ url: F.img(F.COVERS[cover].match(/photo-([\w-]+)/)[1], 1200), mime: 'image/jpeg' });
      if (passage) media.push({ ...passage, url: `/books?ref=${encodeURIComponent(passage.reference)}&t=${passage.translation}${/^quran_/.test(passage.translation) ? '&corpus=quran' : ''}` });
      P.push(await ins(`INSERT INTO posts (user_id, kind, body, media, created_at) VALUES ($1,'post',$2,$3,$4) RETURNING id`,
        [uid(author), body, JSON.stringify(media), new Date(now - daysAgo * DAY - i * 3600_000)]));
    }
    for (const ev of E.filter((e) => e.past)) {
      P.push(await ins(`INSERT INTO posts (user_id, event_id, kind, body, media, created_at) VALUES ($1,$2,'event_recap',$3,'[]',$4) RETURNING id`,
        [ev.host_user_id, ev.id, `Thanks for joining “${ev.title}”. The summary and transcript are on the session page.`, ev.ended_at]));
    }
    for (const [i, p] of P.entries()) {
      const likers = pick(keys, i + 11, 2 + (i % 6));
      for (const l of likers) await c.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, uid(l)]);
      const commenters = pick(keys, i + 5, i % 3);
      for (const [j, k] of commenters.entries()) await comment('post', p.id, k, F.COMMENTS[(i * 3 + j) % F.COMMENTS.length], null, new Date(now - (i % 5) * 3600_000));
      await c.query(`UPDATE posts SET like_count=(SELECT COUNT(*) FROM post_likes WHERE post_id=$1),
        comment_count=(SELECT COUNT(*) FROM comments WHERE target_type='post' AND target_key=$1::text) WHERE id=$1`, [p.id]);
    }

    // ---- materials (YouTube talks) attached to events
    for (const [owner, title, videoId, eventPrefix] of F.MATERIALS) {
      const m = await ins(`INSERT INTO materials (owner_user_id, title, kind, payload) VALUES ($1,$2,'youtube',$3) RETURNING id`,
        [uid(owner), title, JSON.stringify({ videoId, url: `https://www.youtube.com/watch?v=${videoId}` })]);
      const ev = E.find((e) => e.title.startsWith(eventPrefix) && e.hostKey === owner);
      if (ev) await c.query('INSERT INTO event_materials (event_id, material_id, sort_order) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [ev.id, m.id]);
    }

    // ---- venues (permanent rooms) with co-admins and an audit line
    const V = [];
    for (const [owner, name, admins] of F.VENUES) {
      const code = await uniqueCode(c);
      let s; do s = Array.from(crypto.randomBytes(7), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); while ((await c.query('SELECT 1 FROM venues WHERE slug=$1', [s])).rows.length);
      const v = await ins('INSERT INTO venues (slug, code, name, owner_user_id) VALUES ($1,$2,$3,$4) RETURNING *', [s, code, name, uid(owner)]);
      for (const a of admins) await c.query('INSERT INTO venue_admins (venue_id, user_id, added_by) VALUES ($1,$2,$3)', [v.id, uid(a), uid(owner)]);
      await c.query('INSERT INTO venue_audit (venue_id, actor_user_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)', [v.id, uid(owner), U[owner].name, 'admin-add', admins.map((a) => U[a].name).join(', ')]);
      V.push({ ...v, ownerKey: owner });
    }

    // ---- whiteboards (a text label and a hand-drawn underline)
    for (const [owner, title, text] of F.WHITEBOARDS) {
      const pts = Array.from({ length: 24 }, (_, i) => [300 + i * 40, 520 + Math.round(Math.sin(i / 3) * 12), 1]);
      const data = { version: 2, bg: 'dots', activePage: 0, pages: [{ strokes: [{ id: hex(4), tool: 'pen', color: '#2563eb', width: 4, points: pts }], images: [], texts: [{ id: hex(4), x: 300, y: 420, text, size: 56, color: 'ink', bold: true }] }] };
      await c.query('INSERT INTO whiteboards (user_id, title, data, updated_at) VALUES ($1,$2,$3,NOW())', [uid(owner), title, JSON.stringify(data)]);
    }

    // ---- private messages
    for (const [a, b, msgs] of F.DMS) {
      const [lo, hi] = [uid(a), uid(b)].sort((x, y) => x - y);
      const t = await ins('INSERT INTO dm_threads (user_a_id, user_b_id, peer_is_guest, last_message_at) VALUES ($1,$2,false,NOW()) RETURNING id', [lo, hi]);
      await track('dm_threads', t.id);
      for (const [j, [from, body]] of msgs.entries()) {
        await c.query('INSERT INTO dm_messages (thread_id, sender_user_id, sender_name, body, created_at) VALUES ($1,$2,$3,$4,$5)', [t.id, uid(from), U[from].name, body, new Date(now - (msgs.length - j) * 600_000)]);
      }
    }

    // ---- scheduled meetings (dashboard "upcoming")
    for (const [k, name, days] of [['sarah', 'Product office hours', 2], ['chinedu', 'Design critique: portfolio reviews', 4]]) {
      const start = new Date(day0.getTime() + days * DAY + 2 * 3600_000);
      await c.query(`INSERT INTO scheduled_meetings (code, name, host_user_id, host_display_name, scheduled_start, scheduled_end, status) VALUES ($1,$2,$3,$4,$5,$6,'scheduled')`,
        [await uniqueCode(c), name, uid(k), U[k].name, start, new Date(start.getTime() + 3600_000)]);
    }

    // ---- past sessions: history, attendance, chat, polls, Q&A, transcript, AI summary
    let sessions = 0;
    const session = async ({ code, name, hostKey, start, end, eventId, script }) => {
      const attendees = pick(keys.filter((x) => x !== hostKey), name.length, 6);
      const h = await ins(`INSERT INTO meeting_history (code, name, host_user_id, host_display_name, created_at, ended_at, max_participants, event_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [code, name, uid(hostKey), U[hostKey].name, start, end, attendees.length + 1, eventId || null]);
      await track('meeting_history', h.id);
      sessions++;
      if (eventId) await c.query('UPDATE events SET meeting_history_id=$2 WHERE id=$1', [eventId, h.id]);
      for (const [j, k] of [hostKey, ...attendees].entries()) {
        await c.query('INSERT INTO meeting_participants_log (meeting_history_id, user_id, display_name, participant_id, joined_at, left_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [h.id, uid(k), U[k].name, `seed-${hex(4)}`, new Date(start.getTime() + j * 60_000), new Date(end.getTime() - (j % 3) * 300_000)]);
      }
      await c.query(`INSERT INTO meeting_activity (meeting_history_id, code, at, actor_name, event_type, detail) VALUES ($1,$2,$3,$4,'meeting-start',$5), ($1,$2,$6,$4,'meeting-end',$5)`,
        [h.id, code, start, U[hostKey].name, name, end]);
      if (!script) return h;
      for (const [j, [k, body]] of script.chat.entries()) {
        await c.query('INSERT INTO chat_messages (meeting_history_id, sender_id, sender_name, sender_user_id, body, attachments, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [h.id, `seed-${uid(k)}`, U[k].name, uid(k), body, '[]', new Date(start.getTime() + (j + 2) * 120_000)]);
      }
      const [question, options] = script.poll;
      const poll = await ins(`INSERT INTO polls (code, meeting_history_id, question, options, multi, anonymous, status, created_by, created_at, closed_at)
        VALUES ($1,$2,$3,$4,false,true,'closed',$5,$6,$7) RETURNING id`, [code, h.id, question, JSON.stringify(options), U[hostKey].name, new Date(start.getTime() + 900_000), new Date(start.getTime() + 1500_000)]);
      for (const [j, k] of attendees.entries()) await c.query('INSERT INTO poll_votes (poll_id, voter_key, option_idx) VALUES ($1,$2,$3)', [poll.id, `u:${uid(k)}`, (j * 7 + 1) % options.length]);
      for (const [k, body, answer] of script.questions) {
        const qn = await ins(`INSERT INTO questions (code, meeting_history_id, author_key, author_name, body, upvotes, status, host_answers, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,'answered',$7,$8) RETURNING id`,
        [code, h.id, `u:${uid(k)}`, U[k].name, body, 3, JSON.stringify([{ id: `ha-${hex(4)}`, text: answer, by: U[hostKey].name, at: end.toISOString() }]), new Date(start.getTime() + 1800_000)]);
        for (const v of attendees.slice(0, 3)) await c.query('INSERT INTO question_votes (question_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [qn.id, `u:${uid(v)}`]);
      }
      for (const [j, [k, text]] of script.transcript.entries()) {
        await c.query(`INSERT INTO transcript_segments (meeting_history_id, code, speaker_key, speaker_name, text, lang, source, spoken_at) VALUES ($1,$2,$3,$4,$5,'en','import',$6)`,
          [h.id, code, `u:${uid(k)}`, U[k].name, text, new Date(start.getTime() + (j + 1) * 90_000)]);
      }
      await c.query(`INSERT INTO ai_summaries (meeting_history_id, kind, content, provider, model, created_by) VALUES ($1,'summary',$2,'seed','demo',$3)`, [h.id, script.summary, uid(hostKey)]);
      await c.query('INSERT INTO attendance_shares (meeting_history_id, token, is_public, created_by) VALUES ($1,$2,true,$3)', [h.id, hex(16), uid(hostKey)]);
      return h;
    };
    for (const ev of E.filter((e) => e.past)) {
      const key = Object.keys(F.SESSIONS).find((p) => ev.title.startsWith(p));
      await session({ code: ev.code, name: ev.title, hostKey: ev.hostKey, start: ev.started_at, end: ev.ended_at, eventId: ev.id, script: F.SESSIONS[key] });
    }
    for (const [i, v] of V.entries()) { // an earlier meeting in each venue
      const start = new Date(day0.getTime() - (12 + i) * DAY);
      await session({ code: v.code, name: v.name, hostKey: v.ownerKey, start, end: new Date(start.getTime() + 3600_000) });
    }

    return { users: keys.length, events: E.length, posts: P.length, comments, follows, venues: V.length, materials: F.MATERIALS.length, whiteboards: F.WHITEBOARDS.length, dms: F.DMS.length, sessions, password: F.PASSWORD };
  });
}

async function status() {
  const r = await one(`SELECT (SELECT COUNT(*) FROM users WHERE is_seed)::int AS users,
      (SELECT COUNT(*) FROM events e JOIN users u ON u.id=e.host_user_id WHERE u.is_seed)::int AS events,
      (SELECT COUNT(*) FROM posts p JOIN users u ON u.id=p.user_id WHERE u.is_seed)::int AS posts,
      (SELECT COUNT(*) FROM seed_rows WHERE tbl='meeting_history')::int AS sessions`);
  const users = await many('SELECT username, display_name, email, avatar_url FROM users WHERE is_seed ORDER BY id');
  return { loaded: r.users > 0, ...r, accounts: users.map((u) => ({ username: u.username, name: u.display_name, email: u.email, avatarUrl: u.avatar_url })), password: r.users ? F.PASSWORD : null };
}

module.exports = { load, remove, status };
