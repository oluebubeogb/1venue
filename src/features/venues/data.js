/**
 * venues queries (PostgreSQL, parameterised). Split out of src/venue/data.js;
 * src/venue/data.js still re-exports everything for older call sites.
 */
const crypto = require('crypto');
const { q, one, many } = require('../../core/db');

// ---------------------------------------------------------------- venues (permanent /v/{slug} rooms)
const SLUG_CH = 'abcdefghjkmnpqrstuvwxyz23456789';
const randSlug = () => Array.from(crypto.randomBytes(7), (b) => SLUG_CH[b % SLUG_CH.length]).join('');
const codes = require('../../lib/codes');
const randCode = () => codes.randCode(6); // same 6-char lowercase format as meeting codes
const venueOut = (r) => r && ({ id: r.id, slug: r.slug, code: r.code, name: r.name, ownerUserId: r.owner_user_id, createdAt: r.created_at, meetings: r.meetings != null ? Number(r.meetings) : undefined, lastHeld: r.last_held || null, openedAt: r.opened_at || null, activeHistoryId: r.active_history_id || null, isCustom: !!r.is_custom });
async function getUserPlan(userId) {
  const r = await one('SELECT plan FROM users WHERE id=$1', [userId]).catch(() => null);
  return codes.PLANS.includes(r && r.plan) ? r.plan : 'free';
}
async function slugTaken(slug, exceptId) {
  return !!(await one('SELECT 1 FROM venues WHERE lower(slug)=lower($1) AND id IS DISTINCT FROM $2 LIMIT 1', [slug, exceptId || null]));
}
/** Validate a requested custom slug for this user's plan; throws 400/409 with a clear message. */
async function resolveCustomSlug(userId, input, opts = {}, exceptId) {
  const { slug } = codes.customSlug(input, await getUserPlan(userId), opts);
  if (await slugTaken(slug, exceptId)) { const e = new Error(`/v/${slug} is taken — try another`); e.status = 409; throw e; }
  return slug;
}
async function createVenue(userId, name, customInput, opts) {
  const custom = customInput ? await resolveCustomSlug(userId, customInput, opts) : null;
  for (let i = 0; i < 8; i++) {
    const slug = custom || randSlug(), code = randCode();
    const clash = await one(`SELECT 1 FROM venues WHERE lower(slug)=$1 OR lower(code)=$2 UNION ALL SELECT 1 FROM events WHERE lower(code)=$2 LIMIT 1`, [slug, code]).catch(() => null);
    if (clash) continue;
    return venueOut(await one('INSERT INTO venues (slug, code, name, owner_user_id, is_custom) VALUES ($1,$2,$3,$4,$5) RETURNING *', [slug, code, name, userId, !!custom]));
  }
  throw new Error('Could not allocate a venue link');
}
async function myVenues(userId) {
  return (await many(`SELECT v.*, (SELECT COUNT(*) FROM meeting_history h WHERE h.code=v.code) AS meetings,
      (SELECT MAX(h.created_at) FROM meeting_history h WHERE h.code=v.code) AS last_held
    FROM venues v WHERE owner_user_id=$1 ORDER BY created_at DESC`, [userId])).map(venueOut);
}
async function getVenueBySlug(slug) { return venueOut(await one('SELECT * FROM venues WHERE slug=lower($1)', [String(slug || '')])); }
async function getVenueByCode(code) { return venueOut(await one('SELECT * FROM venues WHERE lower(code)=lower($1)', [String(code || '')])); }
async function setVenueSlug(id, userId, input, opts) {
  const slug = await resolveCustomSlug(userId, input, opts, id);
  return venueOut(await one('UPDATE venues SET slug=$3, is_custom=true WHERE id=$1 AND owner_user_id=$2 RETURNING *', [id, userId, slug]));
}
async function renameVenue(id, userId, name) { return venueOut(await one('UPDATE venues SET name=$3 WHERE id=$1 AND owner_user_id=$2 RETURNING *', [id, userId, name])); }
async function deleteVenue(id, userId) { return (await q('DELETE FROM venues WHERE id=$1 AND owner_user_id=$2', [id, userId])).rowCount > 0; }
async function markVenueOpen(code, historyId) { await q('UPDATE venues SET opened_at=now(), active_history_id=$2 WHERE lower(code)=lower($1)', [String(code || ''), historyId || null]); }
async function markVenueClosed(code) { await q('UPDATE venues SET opened_at=NULL, active_history_id=NULL WHERE lower(code)=lower($1)', [String(code || '')]); }
async function venueMeetings(code, limit = 100) {
  return many(`SELECT id, name, host_display_name, created_at AS started_at, ended_at, max_participants FROM meeting_history WHERE code=$1 ORDER BY created_at DESC LIMIT $2`, [code, limit]);
}


// ---------------------------------------------------------------- venue admins & audit
async function addVenueAdmins(venueId, ownerId, usernames) {
  const { publicUsername } = require('../../lib/auth');
  const names = [...new Set(String(usernames || '').split(/[,\s]+/).map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
  const added = [];
  const skipped = [];
  for (const uname of names) {
    // Match clean username, handle, or internal u{hex8}_{name} form
    const u = await one(
      `SELECT id, username, display_name, handle FROM users
       WHERE lower(username)=lower($1)
          OR lower(COALESCE(handle,''))=lower($1)
          OR username ~* ('^[uU][0-9a-fA-F]{8}_' || $1 || '$')
       LIMIT 1`,
      [uname]
    );
    if (!u) { skipped.push(uname); continue; }
    if (u.id === ownerId) { skipped.push(uname + ' (owner)'); continue; }
    await q('INSERT INTO venue_admins (venue_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [venueId, u.id, ownerId]);
    const pub = publicUsername(u.username) || u.handle || u.username;
    added.push({ id: u.id, username: pub, name: u.display_name || pub });
    await logVenueAudit(venueId, ownerId, null, 'admin-add', pub);
  }
  return { added, skipped };
}
async function removeVenueAdmin(venueId, ownerId, userId) {
  const r = await q('DELETE FROM venue_admins WHERE venue_id=$1 AND user_id=$2', [venueId, userId]);
  if (r.rowCount) await logVenueAudit(venueId, ownerId, null, 'admin-remove', String(userId));
  return r.rowCount > 0;
}
async function listVenueAdmins(venueId) {
  const { publicUsername } = require('../../lib/auth');
  return (await many(`SELECT u.id, u.username, u.display_name, u.handle, va.added_at
    FROM venue_admins va JOIN users u ON u.id=va.user_id WHERE va.venue_id=$1 ORDER BY va.added_at`, [venueId]))
    .map(r => {
      const pub = publicUsername(r.username) || r.handle || r.username;
      return { id: r.id, username: pub, name: r.display_name || pub, addedAt: r.added_at };
    });
}
async function isVenueAdmin(venueId, userId) {
  const r = await one('SELECT 1 FROM venue_admins WHERE venue_id=$1 AND user_id=$2', [venueId, userId]);
  return !!r;
}
async function logVenueAudit(venueId, actorId, actorName, action, detail) {
  await q('INSERT INTO venue_audit (venue_id, actor_user_id, actor_name, action, detail) VALUES ($1,$2,$3,$4,$5)',
    [venueId, actorId || null, actorName || null, action, detail || null]);
}
async function getVenueAudit(venueId, limit = 100) {
  return (await many(`SELECT a.*, u.username, u.display_name FROM venue_audit a
    LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.venue_id=$1 ORDER BY a.created_at DESC LIMIT $2`, [venueId, limit]))
    .map(r => ({ id: r.id, actorId: r.actor_user_id, actorName: r.display_name || r.actor_name || r.username || 'Unknown', action: r.action, detail: r.detail, at: r.created_at }));
}

module.exports = { SLUG_CH, randSlug, codes, randCode, venueOut, getUserPlan, slugTaken, resolveCustomSlug, createVenue, myVenues, getVenueBySlug, getVenueByCode, setVenueSlug, renameVenue, deleteVenue, markVenueOpen, markVenueClosed, venueMeetings, addVenueAdmins, removeVenueAdmin, listVenueAdmins, isVenueAdmin, logVenueAudit, getVenueAudit };
