// Room sound effects (applause, drum roll…). The sound itself is synthesized on each
// client, so only a tiny id goes over the wire. Rate-limited per person and per room;
// the host can switch sounds off for non-moderators (security.sounds).
const SOUND_IDS = new Set(['applause', 'drumroll', 'suspense', 'laugh', 'cheers', 'ding', 'boo', 'crickets', 'tada']);
const last = new Map();
const PER_PERSON_MS = Math.max(0, Number(process.env.SOUND_COOLDOWN_SEC || 8)) * 1000;
const PER_ROOM_MS = 2500;
function tooSoon(key, ms) {
  const now = Date.now();
  if ((last.get(key) || 0) > now - ms) return true;
  last.set(key, now);
  if (last.size > 5000) last.clear();
  return false;
}

module.exports = {
  id: 'sounds',
  register(ctx) {
    const { isModerator } = require('../lib/permissions');
    ctx.onWs('sound', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p || p.status !== 'ACTIVE') return;
      const id = String(msg.id || '');
      if (!SOUND_IDS.has(id)) return;
      const mod = isModerator(p);
      const err = (error) => ctx.sendToParticipant(participantId, { type: 'sound-denied', error });
      if (!mod && meeting.settings && meeting.settings.sounds === false) return err('The host has turned off sounds');
      if (!mod && tooSoon('p' + participantId, PER_PERSON_MS)) return err('Easy — one sound every few seconds');
      if (tooSoon('r' + meetingCode, mod ? 800 : PER_ROOM_MS)) return err('Another sound just played');
      ctx.broadcast(meetingCode, { type: 'sound', id, participantId, name: p.name, at: Date.now() });
    });
  },
};
