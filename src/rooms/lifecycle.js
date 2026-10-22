const db = require('../../db');
const config = require('../config');
const {
  getMeeting,
  deleteMeeting,
  allMeetings,
  getClient,
  deleteClient,
  touchMeeting,
} = require('./store');

async function endMeeting(code, reason = 'ended') {
  const meeting = getMeeting(code);
  if (!meeting) return;
  if (meeting.historyId) {
    try {
      await db.endMeetingHistory(meeting.historyId);
    } catch (_) {}
    try {
      // Phase 1: permanent Artifact for ended meetings
      await db.ensureArtifactForHistory(meeting.historyId, code);
    } catch (e) {
      console.warn('[artifact] create on end', e.message);
    }
  }
  if (meeting.scheduledId) {
    try {
      await db.updateScheduledStatus(meeting.scheduledId, 'ended', {
        endedAt: new Date().toISOString(),
      });
    } catch (_) {}
  }
  if (meeting.eventId) {
    try { await require('../venue/data').markEventEnded(meeting.eventId); } catch (e) { console.warn('[event end]', e.message); }
  }
  for (const [pid] of meeting.participants) {
    const ws = getClient(pid);
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'meeting-ended', reason, historyId: meeting.historyId || null, eventSlug: meeting.eventSlug || null }));
        ws.close();
      } catch (_) {}
      deleteClient(pid);
    }
  }
  deleteMeeting(code);
  console.log(`[meeting] ended ${code} (${reason})`);
}

/** Live viewer counts for event cards; one cheap UPDATE per live event every 15s. */
function syncViewerCounts() {
  for (const [, meeting] of allMeetings()) {
    if (!meeting.eventId) continue;
    let live = 0;
    for (const [pid, p] of meeting.participants) if (p.status === 'ACTIVE' && getClient(pid)) live++;
    const joined = Math.max(0, meeting.participants.size - (meeting._joinsCounted || 0));
    meeting._joinsCounted = meeting.participants.size;
    if (live === meeting._lastViewers && !joined) continue;
    meeting._lastViewers = live;
    require('../venue/data').updateViewers(meeting.eventId, live, joined).catch(() => {});
  }
}

function cleanupInactiveMeetings() {
  const now = Date.now();
  for (const [code, meeting] of allMeetings()) {
    const last = meeting.lastActivity || meeting.createdAt || 0;
    if (now - last >= config.MEETING_INACTIVITY_MS) {
      Promise.resolve(endMeeting(code, 'inactivity')).catch(() => {});
    }
  }
}

module.exports = {
  syncViewerCounts,
  endMeeting,
  cleanupInactiveMeetings,
  touchMeeting,
};
