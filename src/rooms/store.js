/**
 * Active meetings (runtime). Extended for Phase 1:
 * roles, waiting room, raised hands, lock, invite tokens, permissions.
 */
const crypto = require('crypto');
const {
  DEFAULT_MEETING_SETTINGS,
  resolvePermissions,
  roleLabel,
  normalizeRole,
  clone,
} = require('../lib/permissions');

const meetings = new Map();
const clients = new Map();

function getMeeting(code) {
  return meetings.get(String(code || '').toUpperCase());
}

function setMeeting(code, meeting) {
  meetings.set(String(code).toUpperCase(), meeting);
  return meeting;
}

function deleteMeeting(code) {
  meetings.delete(String(code || '').toUpperCase());
}

function allMeetings() {
  return meetings;
}

function getClient(participantId) {
  return clients.get(participantId);
}

function setClient(participantId, ws) {
  clients.set(participantId, ws);
}

function deleteClient(participantId) {
  clients.delete(participantId);
}

function hasClient(participantId) {
  const ws = clients.get(participantId);
  return !!(ws && ws.readyState === 1);
}

function generateInviteToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function createMeetingSettings(overrides = {}) {
  const settings = clone(DEFAULT_MEETING_SETTINGS);
  Object.assign(settings, overrides || {});
  if (!settings.roleOverrides) settings.roleOverrides = {};
  return settings;
}

function createParticipant({
  id,
  name,
  role = 'participant',
  userId = null,
  device = 'desktop',
  status = 'ACTIVE',
  email = null,
}) {
  return {
    id,
    name,
    role: normalizeRole(role),
    isHost: normalizeRole(role) === 'host',
    sharing: false,
    userId,
    email,
    device,
    mutedByHost: false,
    handRaisedAt: null,
    status,
    permissionOverrides: null,
    joinedAt: Date.now(),
    approvedAt: null,
  };
}

function getParticipantsList(meeting, { includeWaiting = false } = {}) {
  if (!meeting) return [];
  const list = [];
  for (const p of meeting.participants.values()) {
    if (p.status === 'REMOVED' || p.status === 'BLOCKED') continue;
    if (p.status === 'WAITING' && !includeWaiting) continue;
    if (p.status === 'LEFT') continue;
    list.push(serializeParticipant(meeting, p));
  }
  return list;
}

function getWaitingList(meeting) {
  if (!meeting) return [];
  const list = [];
  for (const p of meeting.participants.values()) {
    if (p.status === 'WAITING') {
      list.push(serializeParticipant(meeting, p));
    }
  }
  list.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  return list;
}

function getRaisedHands(meeting) {
  if (!meeting) return [];
  const hands = [];
  for (const p of meeting.participants.values()) {
    if (p.status === 'ACTIVE' && p.handRaisedAt) {
      hands.push({
        id: p.id,
        name: p.name,
        role: p.role,
        raisedAt: p.handRaisedAt,
        elapsedMs: Date.now() - p.handRaisedAt,
      });
    }
  }
  hands.sort((a, b) => a.raisedAt - b.raisedAt);
  return hands;
}

function serializeParticipant(meeting, p) {
  const perms = resolvePermissions(meeting, p);
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    roleLabel: roleLabel(p.role),
    isHost: p.role === 'host' || !!p.isHost,
    isCohost: p.role === 'cohost',
    isGuest: p.role === 'guest',
    sharing: !!p.sharing,
    userId: p.userId || null,
    device: p.device || 'desktop',
    mutedByHost: !!p.mutedByHost,
    handRaised: !!p.handRaisedAt,
    handRaisedAt: p.handRaisedAt || null,
    status: p.status,
    online: hasClient(p.id),
    joinedAt: p.joinedAt || null,
    permissions: {
      microphone: !!perms.microphone,
      camera: !!perms.camera,
      screenShare: !!perms.screenShare,
      chat: !!perms.chat,
      reactions: !!perms.reactions,
      raiseHand: !!perms.raiseHand,
      invite: !!perms.invite,
      muteOthers: !!perms.muteOthers,
      removePeople: !!perms.removePeople,
      manageWaiting: !!perms.manageWaiting,
      manageRoles: !!perms.manageRoles,
      manageSecurity: !!perms.manageSecurity,
      lockMeeting: !!perms.lockMeeting,
      endMeeting: !!perms.endMeeting,
      lowerHands: !!perms.lowerHands,
      askUnmute: !!perms.askUnmute,
    },
  };
}

function getContentState(meeting) {
  if (!meeting || !meeting.content) return null;
  const c = meeting.content;
  return {
    type: c.type,
    title: c.title,
    url: c.url || null,
    ownerId: c.ownerId,
    remoteHolderId: c.remoteHolderId,
    scrollMode: c.scrollMode || 'uniform',
    scroll: c.scroll || null,
    page: c.page || null,
    media: c.media || null,
    fileMeta: c.fileMeta || null,
  };
}

function getSecurityState(meeting) {
  if (!meeting) return null;
  const s = meeting.settings || createMeetingSettings();
  return {
    waitingRoom: !!s.waitingRoom,
    guestAccess: !!s.guestAccess,
    locked: !!s.locked,
    participantScreenShare: s.participantScreenShare !== false,
    participantMicrophone: s.participantMicrophone !== false,
    participantCamera: s.participantCamera !== false,
    chat: s.chat !== false,
    reactions: s.reactions !== false,
    raiseHand: s.raiseHand !== false,
    participantsCanInvite: !!s.participantsCanInvite,
    guestsCanInvite: !!s.guestsCanInvite,
  };
}

function getPublicMeetingState(meeting, viewerId = null) {
  if (!meeting) return null;
  const viewer = viewerId ? meeting.participants.get(viewerId) : null;
  return {
    name: meeting.name,
    locked: !!(meeting.settings && meeting.settings.locked),
    waitingRoom: !!(meeting.settings && meeting.settings.waitingRoom),
    guestAccess: meeting.settings ? meeting.settings.guestAccess !== false : true,
    participants: getParticipantsList(meeting),
    waiting: getWaitingList(meeting),
    raisedHands: getRaisedHands(meeting),
    security: getSecurityState(meeting),
    content: getContentState(meeting),
    inviteTokenMasked: meeting.inviteToken
      ? String(meeting.inviteToken).slice(0, 4) + '••••••'
      : null,
    viewerRole: viewer ? viewer.role : null,
    viewerPermissions: viewer ? resolvePermissions(meeting, viewer) : null,
  };
}

function broadcast(code, message, excludeId = null) {
  const meeting = getMeeting(code);
  if (!meeting) return;
  const payload = JSON.stringify(message);
  for (const [pid, p] of meeting.participants) {
    if (pid === excludeId) continue;
    if (p.status === 'WAITING' || p.status === 'REMOVED' || p.status === 'BLOCKED') continue;
    const ws = clients.get(pid);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch (_) {}
    }
  }
}

function broadcastToModerators(code, message) {
  const meeting = getMeeting(code);
  if (!meeting) return;
  const payload = JSON.stringify(message);
  for (const [pid, p] of meeting.participants) {
    if (p.role !== 'host' && p.role !== 'cohost') continue;
    if (p.status !== 'ACTIVE') continue;
    const ws = clients.get(pid);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch (_) {}
    }
  }
}

function sendToParticipant(participantId, message) {
  const ws = clients.get(participantId);
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (_) {}
  }
  return false;
}

function generateCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let code;
  do {
    let L = '';
    let N = '';
    for (let i = 0; i < 3; i++) L += letters[Math.floor(Math.random() * letters.length)];
    for (let i = 0; i < 3; i++) N += digits[Math.floor(Math.random() * digits.length)];
    code = L + N;
  } while (meetings.has(code));
  return code;
}

function normalizeParticipantName(raw) {
  const name = String(raw || '').trim().slice(0, 40);
  if (name.length < 2) return null;
  if (/^(guest|host)$/i.test(name)) return null;
  return name;
}

function touchMeeting(code) {
  const meeting = getMeeting(code);
  if (meeting) meeting.lastActivity = Date.now();
}

function findParticipantByUserId(meeting, userId) {
  if (!meeting || !userId) return null;
  for (const p of meeting.participants.values()) {
    if (p.userId === userId) return p;
  }
  return null;
}

function isBlocked(meeting, { userId, participantId, name }) {
  if (!meeting || !meeting.blocked) return false;
  if (participantId && meeting.blocked.participantIds.has(participantId)) return true;
  if (userId && meeting.blocked.userIds.has(userId)) return true;
  if (name && meeting.blocked.names.has(String(name).toLowerCase())) return true;
  return false;
}

function blockParticipant(meeting, p, { preventRejoin = false } = {}) {
  if (!meeting.blocked) {
    meeting.blocked = {
      participantIds: new Set(),
      userIds: new Set(),
      names: new Set(),
    };
  }
  if (preventRejoin) {
    meeting.blocked.participantIds.add(p.id);
    if (p.userId) meeting.blocked.userIds.add(p.userId);
    if (p.name) meeting.blocked.names.add(String(p.name).toLowerCase());
  }
  p.status = preventRejoin ? 'BLOCKED' : 'REMOVED';
  p.handRaisedAt = null;
  p.sharing = false;
}

module.exports = {
  meetings,
  clients,
  getMeeting,
  setMeeting,
  deleteMeeting,
  allMeetings,
  getClient,
  setClient,
  deleteClient,
  hasClient,
  getParticipantsList,
  getWaitingList,
  getRaisedHands,
  serializeParticipant,
  getContentState,
  getSecurityState,
  getPublicMeetingState,
  broadcast,
  broadcastToModerators,
  sendToParticipant,
  generateCode,
  generateInviteToken,
  createMeetingSettings,
  createParticipant,
  normalizeParticipantName,
  touchMeeting,
  findParticipantByUserId,
  isBlocked,
  blockParticipant,
};
