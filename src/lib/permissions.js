/**
 * Role → default permissions → meeting overrides → server authorization
 * Roles: host | cohost | participant | guest
 */

const ROLES = ['host', 'cohost', 'participant', 'guest'];

const DEFAULT_PERMISSIONS = {
  host: {
    microphone: true,
    camera: true,
    screenShare: true,
    chat: true,
    reactions: true,
    raiseHand: true,
    invite: true,
    muteOthers: true,
    removePeople: true,
    manageWaiting: true,
    manageRoles: true,
    manageSecurity: true,
    lockMeeting: true,
    endMeeting: true,
    transferHost: true,
    lowerHands: true,
    askUnmute: true,
  },
  cohost: {
    microphone: true,
    camera: true,
    screenShare: true,
    chat: true,
    reactions: true,
    raiseHand: true,
    invite: true,
    muteOthers: true,
    removePeople: true,
    manageWaiting: true,
    manageRoles: false,
    manageSecurity: false,
    lockMeeting: false,
    endMeeting: false,
    transferHost: false,
    lowerHands: true,
    askUnmute: true,
  },
  participant: {
    microphone: true,
    camera: true,
    screenShare: true,
    chat: true,
    reactions: true,
    raiseHand: true,
    invite: false,
    muteOthers: false,
    removePeople: false,
    manageWaiting: false,
    manageRoles: false,
    manageSecurity: false,
    lockMeeting: false,
    endMeeting: false,
    transferHost: false,
    lowerHands: false,
    askUnmute: false,
  },
  guest: {
    microphone: true,
    camera: true,
    screenShare: false,
    chat: true,
    reactions: true,
    raiseHand: true,
    invite: false,
    muteOthers: false,
    removePeople: false,
    manageWaiting: false,
    manageRoles: false,
    manageSecurity: false,
    lockMeeting: false,
    endMeeting: false,
    transferHost: false,
    lowerHands: false,
    askUnmute: false,
  },
};

/** Default meeting-level settings (can be overridden at create / security panel) */
const DEFAULT_MEETING_SETTINGS = {
  waitingRoom: false,
  guestAccess: true,
  locked: false,
  participantScreenShare: true,
  participantMicrophone: true,
  participantCamera: true,
  chat: true,
  reactions: true,
  raiseHand: true,
  participantsCanInvite: false,
  guestsCanInvite: false,
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getDefaultPermissions(role) {
  return clone(DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.participant);
}

/**
 * Resolve effective permissions for a participant in a meeting.
 * meeting.settings.roleOverrides[role] can override defaults.
 * participant.permissionOverrides can further override per-user.
 */
function resolvePermissions(meeting, participant) {
  const role = (participant && participant.role) || 'participant';
  const base = getDefaultPermissions(role);

  const settings = (meeting && meeting.settings) || {};
  const roleOverrides = (settings.roleOverrides && settings.roleOverrides[role]) || {};
  Object.assign(base, roleOverrides);

  // Meeting-level capability gates for non-moderators (participants + guests)
  if (role === 'participant' || role === 'guest') {
    // Explicit meeting toggle drives screen share for both participants and guests
    if (typeof settings.participantScreenShare === 'boolean') {
      base.screenShare = !!settings.participantScreenShare;
    }
    if (settings.participantMicrophone === false) base.microphone = false;
    if (settings.participantCamera === false) base.camera = false;
    if (settings.chat === false) base.chat = false;
    if (settings.reactions === false) base.reactions = false;
    if (settings.raiseHand === false) base.raiseHand = false;
    if (role === 'participant' && settings.participantsCanInvite === false) base.invite = false;
    if (role === 'guest' && settings.guestsCanInvite === false) base.invite = false;
    if (role === 'guest' && settings.guestAccess === false) {
      // guest blocked at join; keep permissions minimal if somehow present
      base.screenShare = false;
      base.invite = false;
    }
  }

  if (participant && participant.permissionOverrides) {
    Object.assign(base, participant.permissionOverrides);
  }

  // 1venue stage mode: only seated speakers (and moderators) may publish media
  const stage = meeting && meeting.stage;
  if (stage && stage.enabled && (role === 'participant' || role === 'guest')) {
    const seated = stage.speakers && stage.speakers.has(participant && participant.id);
    if (!seated) {
      base.microphone = false;
      base.camera = false;
      base.screenShare = false;
    } else {
      base.microphone = true;
      base.camera = settings.participantCamera !== false || !!stage.camerasForSpeakers;
      if (stage.camerasForSpeakers !== false) base.camera = true;
    }
    base.onStage = !!seated;
  }

  // Host always has full control
  if (role === 'host') {
    return getDefaultPermissions('host');
  }

  return base;
}

function can(meeting, participant, action) {
  if (!participant) return false;
  const perms = resolvePermissions(meeting, participant);
  return !!perms[action];
}

function isModerator(participant) {
  if (!participant) return false;
  return participant.role === 'host' || participant.role === 'cohost' || !!participant.isHost;
}

function roleLabel(role) {
  if (role === 'host') return 'Host';
  if (role === 'cohost') return 'Co-host';
  if (role === 'guest') return 'Guest';
  return 'Participant';
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'host' || r === 'cohost' || r === 'guest' || r === 'participant') return r;
  return 'participant';
}

module.exports = {
  ROLES,
  DEFAULT_PERMISSIONS,
  DEFAULT_MEETING_SETTINGS,
  getDefaultPermissions,
  resolvePermissions,
  can,
  isModerator,
  roleLabel,
  normalizeRole,
  clone,
};
