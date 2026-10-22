/**
 * Stage mode: a limited number of speaker seats and a request-to-speak queue.
 * The host or cohost approves a request, which seats the speaker. LiveKit publish
 * permission is updated server-side so it takes effect without a reconnect.
 */
const config = require('../config');

let roomClient = null;
function lkRoomClient() {
  if (roomClient !== null) return roomClient;
  try {
    if (config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) {
      const { RoomServiceClient } = require('livekit-server-sdk');
      const httpUrl = config.LIVEKIT_URL.replace(/^ws/, 'http');
      roomClient = new RoomServiceClient(httpUrl, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
    } else {
      roomClient = false;
    }
  } catch (e) {
    console.warn('[stage] RoomServiceClient unavailable', e.message);
    roomClient = false;
  }
  return roomClient;
}

function init(meeting, { enabled = false, seats } = {}) {
  const n = parseInt(seats, 10);
  meeting.stage = {
    enabled: !!enabled,
    seats: Math.min(50, Math.max(1, Number.isFinite(n) ? n : config.DEFAULT_SPEAKER_SEATS)),
    speakers: new Set(),
    requests: [], // [{ id, name, at, note }]
    camerasForSpeakers: true,
  };
  return meeting.stage;
}

function ensure(meeting) {
  return meeting.stage || init(meeting, { enabled: false });
}

function capacity(meeting) {
  const st = meeting.stage;
  const cap = st && st.enabled ? config.MAX_AUDIENCE : config.MAX_PARTICIPANTS;
  const manual = meeting.settings && meeting.settings.maxParticipants;
  return manual ? Math.min(cap, manual) : cap;
}

function seatedCount(meeting) {
  const st = ensure(meeting);
  let n = 0;
  for (const pid of st.speakers) {
    const p = meeting.participants.get(pid);
    if (p && p.status === 'ACTIVE') n++;
  }
  return n;
}

function state(meeting) {
  const st = ensure(meeting);
  const speakers = [];
  for (const pid of st.speakers) {
    const p = meeting.participants.get(pid);
    if (p && p.status === 'ACTIVE') speakers.push({ id: pid, name: p.name, userId: p.userId || null });
  }
  return {
    enabled: st.enabled,
    seats: st.seats,
    speakers,
    requests: st.requests.slice(0, 100),
    open: Math.max(0, st.seats - speakers.length),
  };
}

async function syncLiveKit(meetingCode, participantId, perms) {
  const rc = lkRoomClient();
  if (!rc) return false;
  try {
    let TrackSource = null;
    try { TrackSource = require('livekit-server-sdk').TrackSource; } catch (_) {}
    const sources = [];
    if (TrackSource) {
      if (perms.microphone) sources.push(TrackSource.MICROPHONE);
      if (perms.camera) sources.push(TrackSource.CAMERA);
      if (perms.screenShare) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
    }
    await rc.updateParticipant(meetingCode, participantId, undefined, {
      canPublish: !!(perms.microphone || perms.camera || perms.screenShare),
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: sources,
    });
    return true;
  } catch (e) {
    console.warn('[stage] livekit update failed', e.message);
    return false;
  }
}

module.exports = { init, ensure, capacity, state, seatedCount, syncLiveKit, lkRoomClient };
