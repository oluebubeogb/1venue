/**
 * Small helpers shared by the room plugins (stage, polls, Q&A, comments, scripture, captions, wbShare).
 */
const { isModerator } = require('../lib/permissions');

const mod = (meeting, pid) => isModerator(meeting.participants.get(pid));
const active = (meeting, pid) => { const p = meeting.participants.get(pid); return p && p.status === 'ACTIVE' ? p : null; };
const voterKey = (p) => (p.userId ? `u:${p.userId}` : `p:${p.id}`);
const err = (ctx, pid, error) => ctx.sendToParticipant(pid, { type: 'error', error });
const throttle = new Map();
function limited(pid, kind, ms) {
  const k = pid + kind, now = Date.now();
  if ((throttle.get(k) || 0) > now - ms) return true;
  throttle.set(k, now);
  if (throttle.size > 5000) throttle.clear();
  return false;
}

module.exports = { mod, active, voterKey, err, limited };
