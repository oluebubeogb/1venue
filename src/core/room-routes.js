/**
 * Core rooms: LiveKit token, create, join, meeting state, invite regenerate, leave.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, config, normCode, isCode, parseBody, sendJSON, getAuthUser, meetings, clients, getParticipantsList, getWaitingList, getRaisedHands, getContentState, getSecurityState, broadcast, broadcastToModerators, generateCode, generateInviteToken, createMeetingSettings, createParticipant, normalizeParticipantName, findParticipantByUserId, isBlocked, can, resolvePermissions, endMeeting, getOrRestoreMeeting, discardSnapshot, createLiveKitToken, grantsFromPermissions, signWsCredential, stage, publicErr, LIVEKIT_URL,
} = require('./http-kit');
const { isVerified } = require('../lib/auth');
const { verifyWsCredential } = require('../lib/wsCredential');
const crypto = require('crypto');
const { clientIp } = require('../lib/http');

const JOIN_CONFLICT = 'This account is already in this meeting or venue on another device.';
const JOIN_CONNECT_GRACE_MS = 60_000;

function accountOccupiesRoom(participant) {
  if (!participant || !['ACTIVE', 'WAITING', 'APPROVED'].includes(participant.status)) return false;
  const socket = clients.get(participant.id);
  return socket?.readyState === 1 || Date.now() < (participant.joinReservedUntil || 0);
}

function duplicateAccount(meeting, userId, participant) {
  return [...meeting.participants.values()].some((p) => p !== participant && (
    String(p.pendingAccountId) === String(userId)
    || (p.userId != null && String(p.userId) === String(userId) && accountOccupiesRoom(p))
  ));
}

async function withAccountReservation(participant, userId, action) {
  participant.pendingAccountId = userId;
  try {
    return await action();
  } finally {
    delete participant.pendingAccountId;
  }
}

const guestHourHits = new Map();
function guestDeviceId(req, res) {
  const raw = String(req.headers.cookie || '');
  const m = /(?:^|;\s*)venue_did=([A-Za-z0-9_-]+)/.exec(raw);
  if (m) return m[1];
  const id = crypto.randomBytes(16).toString('hex');
  const prev = res.getHeader('Set-Cookie');
  const cookie = `venue_did=${id}; Path=/; Max-Age=31536000; SameSite=Lax`;
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
  return id;
}
function guestHourlyOk(key, cap) {
  const win = Math.floor(Date.now() / 3600000);
  const k = key + ':' + win;
  const n = (guestHourHits.get(k) || 0) + 1;
  guestHourHits.set(k, n);
  if (guestHourHits.size > 20000) {
    for (const kk of guestHourHits.keys()) if (!kk.endsWith(':' + win)) guestHourHits.delete(kk);
  }
  return n <= cap;
}
function limitGuestAction(req, res, kind, cap) {
  const ip = clientIp(req) || 'unknown';
  const did = guestDeviceId(req, res);
  return guestHourlyOk(`guest-${kind}-ip:${ip}`, cap) && guestHourlyOk(`guest-${kind}-did:${did}`, cap);
}

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  // LiveKit token
  if (urlPath === '/api/livekit-token' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const participantId = body.participantId;

      if (!code || !participantId) {
        return sendJSON(res, 400, { error: 'code and participantId are required' });
      }

      const meeting = meetings.get(code) || await getOrRestoreMeeting(code);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
      await require('../features/wallet/billing').check(meeting);
      const participant = meeting.participants.get(participantId);
      if (!participant) {
        return sendJSON(res, 403, { error: 'Not a participant of this meeting' });
      }

      const participantName = normalizeParticipantName(body.participantName)
        || participant.name
        || 'Participant';

      if ((meeting.billingId || participant.joinKey) && !body.wsCredential) return sendJSON(res, 403, {error: 'A room credential is required'});
      if (body.wsCredential && !verifyWsCredential(body.wsCredential, { participantId, code, joinKey: participant.joinKey }).ok) {
        return sendJSON(res, 403, { error: 'Invalid credential' });
      }
      if (participant.status !== 'ACTIVE') {
        return sendJSON(res, 403, { error: 'Not admitted yet' });
      }
      const perms = resolvePermissions(meeting, participant);
      const grants = grantsFromPermissions(perms);
      if (meeting.paidEntry && meeting.paidEntry.enabled && meeting.paidEntry.model === 'usage') {
        const gate = await require('../features/wallet/usage').mediaGate(meeting.code, participant);
        if (!gate.ok) return sendJSON(res, gate.status || 403, { error: gate.error, topUp: !!gate.topUp, graceUntilMs: gate.graceUntilMs || null });
        grants.ttl = gate.ttl || 60;
      }
      // Breakout rooms live in their own LiveKit rooms (CODE-bo-N)
      let roomName = meeting.mediaRoom || code;
      if (body.room && body.room !== code) {
        const br = meeting.breakouts && meeting.breakouts.open
          ? (meeting.breakouts.rooms || []).find((r) => r.livekitRoom === body.room)
          : null;
        const mod = participant.role === 'host' || participant.role === 'cohost';
        if (!br || !(mod || (br.participantIds || []).includes(participantId))) {
          return sendJSON(res, 403, { error: 'Not assigned to that breakout room' });
        }
        roomName = br.livekitRoom;
      }
      if (meeting.billingId) grants.ttl = await require('../features/wallet/billing-data').mediaToken(meeting.billingId, roomName);
      const token = await createLiveKitToken(participantId, participantName, roomName, grants);
      return sendJSON(res, 200, {
        token,
        url: LIVEKIT_URL,
        room: roomName,
        media: config.MEDIA,
        grants: {
          canPublish: grants.canPublish,
          canPublishData: grants.canPublishData,
          canSubscribe: grants.canSubscribe,
        },
      });
    } catch (e) {
      console.error('[livekit-token]', e.message);
      return sendJSON(res, e.status || 500, { error: publicErr(e, 'Failed to create token') });
    }
  }

  if (urlPath === '/api/create' && req.method === 'POST') {
    let openedBilling = null;
    let openedPaidEntry = null;
    let newPaidHistoryId = null;
    let publishedCode = null;
    try {
      const body = await parseBody(req);
      // Align with event titles (2–120). Create → go-live passes the event title as the meeting name.
      const name = String(body.name || '').trim().slice(0, 120);
      if (!name || name.length < 2) return sendJSON(res, 400, { error: 'Meeting name must be at least 2 characters' });

      const authUser = await getAuthUser(req, res);
      let code = generateCode();
      let event = null;
      if (body.eventId && authUser) {
        event = await require('../venue/data').getEventById(body.eventId).catch(() => null);
        if (event && event.host.id !== authUser.id) event = null;
        if (event && meetings.has(normCode(event.code))) {
          return sendJSON(res, 409, { error: 'This event is already live', code: event.code });
        }
        if (event) code = normCode(event.code);
      }
      const requestedAccess = event
        ? (event.category === 'meeting' ? event.meetingAccessMode : 'host_funded')
        : String(body.meetingAccessMode || 'host_funded');
      if (!['host_funded', 'paid_entry'].includes(requestedAccess)) return sendJSON(res, 400, { error: 'Choose host-funded or paid entry' });
      if (requestedAccess === 'paid_entry' && (!event && body.venue || event && event.category !== 'meeting')) return sendJSON(res, 400, { error: 'Paid entry is available for meetings, not venues or other event types' });
      if (requestedAccess === 'paid_entry' && !authUser) return sendJSON(res, 401, { error: 'Sign in to host a paid-entry meeting' });
      const paidDuration = event ? event.meetingDurationMin : Number(body.meetingDurationMin);
      const paidPrice = event ? event.meetingEntryPriceCredits : Number(body.meetingEntryPriceCredits);
      const legacyPaid = requestedAccess === 'paid_entry' && Number.isInteger(paidDuration) && paidDuration >= 1 && paidDuration <= 720 && Number.isSafeInteger(paidPrice) && paidPrice >= 1;
      const usagePaid = requestedAccess === 'paid_entry' && !legacyPaid;
      if (requestedAccess === 'paid_entry' && !legacyPaid && (body.meetingDurationMin != null || body.meetingEntryPriceCredits != null) && (event && (event.meetingDurationMin || event.meetingEntryPriceCredits))) {
        return sendJSON(res, 400, { error: 'Paid entry requires an advertised duration from 1 to 720 minutes and a positive whole-credit entry price' });
      }
      if (!authUser && requestedAccess === 'host_funded' && !body.venue && !event) {
        const cap = (require('../config').WALLET_USAGE || {}).guestInstantPerIpHour || 3;
        if (!limitGuestAction(req, res, 'create', cap)) return sendJSON(res, 429, { error: 'Too many guest meetings from this network. Sign in to continue.', signInRequired: true });
      }
      // Permanent venue: fixed code, owner only, waiting room always on.
      let venue = null;
      const vdata = require('../venue/data');
      if (body.venue) {
        venue = await vdata.getVenueBySlug(String(body.venue).toLowerCase()).catch(() => null);
        if (!venue) return sendJSON(res, 404, { error: 'Venue not found' });
      } else if (body.code && !event) {
        // A create aimed at a venue-bound code must open that venue, never fork a new code.
        venue = await vdata.getVenueByCode(normCode(body.code)).catch(() => null);
      }
      if (venue && requestedAccess === 'paid_entry') return sendJSON(res, 400, { error: 'Permanent venues use host-funded billing; paid entry is available for standalone meetings and Meeting events' });
      if (venue && venue.archived) return sendJSON(res, 403, { error: 'This venue is archived because its plan changed. The owner can upgrade to open it again.', code: venue.code });
      if (venue) {
        if (!authUser) return sendJSON(res, 401, { error: 'Sign in to open your venue', code: venue.code });
        const isOwner = venue.ownerUserId === authUser.id;
        const isAdmin = !isOwner && await vdata.isVenueAdmin(venue.id, authUser.id);
        if (!isOwner && !isAdmin) return sendJSON(res, 403, { error: 'Only the venue owner or an admin can open it', code: venue.code });
        if (meetings.has(normCode(venue.code))) return sendJSON(res, 409, { error: 'This venue is already open', code: venue.code });
        code = normCode(venue.code); // forced: client-sent code is ignored for venues
        const activity = String(body.name || '').trim().slice(0, 80);
        await vdata.logVenueAudit(
          venue.id,
          authUser.id,
          authUser.displayName || authUser.username,
          'open',
          (activity && activity !== venue.name ? activity : null) || (isAdmin ? 'opened by admin' : 'opened by owner')
        );
      }
      const codeSource = venue ? 'venue' : event ? 'event' : 'generated';
      res.setHeader('X-1venue-Code-Source', codeSource);
      if (process.env.DEBUG_CREATE === '1') console.log('[create]', JSON.stringify({ codeSource, code, bodyVenue: body.venue || null, bodyCode: body.code || null, eventId: body.eventId || null, user: authUser ? authUser.id : null }));
      const hostId = body.participantId || 'host-' + Date.now();
      const hostName = normalizeParticipantName(
        body.participantName
        || authUser?.displayName
        || authUser?.username
        || (authUser?.email && authUser.email.split('@')[0])
      );
      if (!hostName) {
        return sendJSON(res, 400, { error: 'Please enter your display name' });
      }

      if (authUser) await require('../rooms/end-control').reconcileEndedHostMeetings(authUser.id);
      if (requestedAccess !== 'paid_entry') {
        // Venues are metered the same as other host-funded meetings (host pays for everyone).
        openedBilling = await require('../features/wallet/billing').start({ user: authUser, code, name, hostName });
      }
      const historyId = openedBilling ? openedBilling.historyId : (newPaidHistoryId = await db.startMeetingHistory({
        code,
        name,
        hostUserId: authUser ? authUser.id : null,
        hostDisplayName: hostName,
      }));
      if (requestedAccess === 'paid_entry' && legacyPaid) {
        openedPaidEntry = await require('../features/wallet/paid-entry').open({ code, historyId, hostUserId: authUser.id, entryCredits: paidPrice, durationMin: paidDuration, startedMs: Date.now() });
      } else if (usagePaid) {
        openedPaidEntry = await require('../features/wallet/usage').openUsage({
          code, historyId, hostUserId: authUser.id, startedMs: Date.now(), ownerId: require('../features/wallet/billing').ownerId,
        });
        await require('../features/wallet/usage').acceptUsage({ code, userId: authUser.id, participantId: hostId, isHost: true, startNow: false });
      }
      if (openedPaidEntry) await discardSnapshot(code);

      await db.logParticipantJoin({
        meetingHistoryId: historyId,
        userId: authUser ? authUser.id : null,
        displayName: hostName,
        participantId: hostId,
      });

      const settings = createMeetingSettings({
        waitingRoom: !!body.waitingRoom || !!venue || legacyPaid,
        guestAccess: body.guestAccess !== false,
        participantScreenShare: body.participantScreenShare !== false,
        participantMicrophone: body.participantMicrophone !== false,
        participantCamera: body.participantCamera !== false,
        chat: body.chat !== false,
        reactions: body.reactions !== false,
        raiseHand: body.raiseHand !== false,
        participantsCanInvite: !!body.participantsCanInvite,
        guestsCanInvite: !!body.guestsCanInvite,
      });
      const requireInviteKey = body.requireInviteKey === true || body.inviteAccess === 'approval';

      const host = createParticipant({
        id: hostId,
        name: hostName,
        role: 'host',
        userId: authUser ? authUser.id : null,
        username: authUser ? authUser.username : null,
        verified: !!(authUser && isVerified(authUser)),
        device: body.device || 'desktop',
        status: 'ACTIVE',
      });

      const participants = new Map();
      if (authUser) {
        host.joinKey = crypto.randomUUID();
        host.joinSessionId = req._sid;
        host.joinReservedUntil = Date.now() + JOIN_CONNECT_GRACE_MS;
      }
      participants.set(hostId, host);

      const now = Date.now();
      const inviteToken = generateInviteToken();
      publishedCode = code;
      meetings.set(code, {
        code,
        paidEntry: openedPaidEntry ? { enabled: true, model: usagePaid ? 'usage' : 'entry', entryCredits: openedPaidEntry.entryCredits, durationMin: openedPaidEntry.durationMin, startedMs: openedPaidEntry.startedMs, advertisedEndMs: openedPaidEntry.advertisedEndMs, runtimeEndMs: openedPaidEntry.runtimeEndMs, rateCreditsPerMin: 1, switchDeadlineMs: openedPaidEntry.switchDeadlineMs || null } : null,
        billingId: openedBilling?.historyId || null,
        mediaRoom: openedBilling?.session.media_room || null,
        name,
        hostId,
        hostUserId: authUser ? authUser.id : null,
        historyId,
        createdAt: now,
        lastActivity: now,
        participants,
        content: null,
        chatHistory: [],
        scheduledId: body.scheduledId || null,
        venue: venue ? { slug: venue.slug, name: venue.name } : null,
        settings,
        inviteToken,
        inviteAccess: body.inviteAccess || 'anyone', // anyone | approval
        requireInviteKey: !!requireInviteKey,
        blocked: {
          participantIds: new Set(),
          userIds: new Set(),
          names: new Set(),
        },
      });

      if (body.scheduledId) {
        try {
          await db.updateScheduledStatus(body.scheduledId, 'live', {
            startedAt: new Date().toISOString(),
          });
        } catch (_) {}
      }

      const meeting = meetings.get(code);
      // Plan limits come from whoever pays for the room: the venue owner, else the signed-in host.
      try {
        const ent = await require('../lib/plans').entitlements(venue ? venue.ownerUserId : authUser ? authUser.id : null);
        meeting.limits = { plan: ent.plan, audience: ent.limits.audience, meeting: ent.limits.meeting, speakerSeats: ent.limits.speakerSeats, ownerUserId: venue ? venue.ownerUserId : authUser ? authUser.id : null };
      } catch (e) { console.warn('[plan limits]', e.message); }
      stage.init(meeting, {
        enabled: !!(body.stage || (event && event.category !== 'meeting')),
        seats: body.speakerSeats || (event && event.speakerSeats),
      });
      if (event) {
        meeting.eventId = event.id;
        meeting.eventSlug = event.slug;
        meeting.ownerTheme = event.theme || null;
        meeting.event = { id: event.id, slug: event.slug, title: event.title, category: event.category, visibility: event.visibility, theme: event.theme };
        try {
          const evSet = event.settings && (typeof event.settings === 'object' ? event.settings : JSON.parse(event.settings));
          if (evSet && evSet.certs) meeting.settings.certs = require('../features/certificates/service').normalizeCerts(evSet.certs);
        } catch (_) {}
        await require('../venue/data').markEventLive(event.id, { code, historyId }).catch((e) => console.warn('[event live]', e.message));
      }
      if (venue) await vdata.markVenueOpen(code, historyId).catch((e) => console.warn('[venue open]', e.message));
      try {
        await db.upsertMembership({
          code,
          userId: authUser ? authUser.id : null,
          participantId: hostId,
          displayName: hostName,
          role: 'host',
          status: 'ACTIVE',
          email: authUser?.email || null,
        });
      } catch (e) { console.warn('[membership] host', e.message); }

      const hostWsCredential = signWsCredential({ participantId: hostId, code, joinKey: host.joinKey });
      return sendJSON(res, 200, {
        code,
        name,
        hostId,
        participantId: hostId,
        wsCredential: hostWsCredential,
        role: 'host',
        participants: getParticipantsList(meeting),
        waiting: [],
        raisedHands: [],
        security: getSecurityState(meeting),
        inviteToken,
        inviteLink: `/${code}?key=${inviteToken}`,
        permissions: resolvePermissions(meeting, host),
        content: null,
        stage: stage.state(meeting),
        eventSlug: meeting.eventSlug || null,
        eventId: meeting.eventId || null,
        certs: (meeting.settings && meeting.settings.certs) || null,
        venue: meeting.venue || null,
        freeUntilMs: openedBilling?.session.free_until_ms || null,
        paidEntry: meeting.paidEntry || null,
      });
    } catch (e) {
      if (openedBilling) {
        if (publishedCode && meetings.has(publishedCode)) await endMeeting(publishedCode, 'open-failed').catch(() => {});
        else await require('../features/wallet/billing-data').settle(openedBilling.historyId, {now:Number(openedBilling.session.started_ms),endReason:'open-failed'}).catch(() => {});
      }
      if (openedPaidEntry) {
        if (publishedCode && meetings.has(publishedCode)) await endMeeting(publishedCode, 'open-failed').catch(() => {});
        else {
          await require('../features/wallet/paid-entry').settle(openedPaidEntry.code, Date.now()).catch(() => {});
          await db.endMeetingHistory(openedPaidEntry.historyId).catch(() => {});
        }
      } else if (newPaidHistoryId != null) {
        await db.q('DELETE FROM meeting_history WHERE id=$1', [newPaidHistoryId]).catch((err) => console.warn('[create] history cleanup', err.message));
      }
      console.error('[create]', e.message);
      const details = e.activeMeeting ? { activeMeeting: e.activeMeeting } : {};
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Bad request'), ...details });
    }
  }

  if (urlPath === '/api/join' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      // Accept code (y5yi87, legacy ABC-234) or legacy letters+numbers split; case-insensitive.
      const code = normCode(body.code || ((body.letters || '') + (body.numbers || '')));
      if (!isCode(code)) {
        return sendJSON(res, 400, { error: 'Enter the 6-character meeting code' });
      }

      const meeting = meetings.get(code) || await getOrRestoreMeeting(code);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found. Check the code.' });

      await require('../features/wallet/billing').check(meeting);
      // Secure invite key enforcement
      const providedKey = body.key || body.inviteToken || null;
      const requireKey = meeting.inviteAccess === 'approval' || meeting.requireInviteKey === true;
      if (requireKey) {
        if (!providedKey || providedKey !== meeting.inviteToken) {
          return sendJSON(res, 403, { error: 'A valid invitation link is required to join this meeting.' });
        }
      }

      const authUser = await getAuthUser(req, res);
      const paidMeeting = !!(meeting.paidEntry && meeting.paidEntry.enabled);
      if (paidMeeting && !authUser) return sendJSON(res, 401, { error: 'Sign in to join this paid-entry meeting', signInRequired: true });
      let paidAdmission = paidMeeting && authUser
        ? await require('../features/wallet/paid-entry').admission(code, authUser.id)
        : null;
      const participantId = body.participantId || 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const participantName = normalizeParticipantName(
        body.participantName
        || authUser?.displayName
        || authUser?.username
        || (authUser?.email && authUser.email.split('@')[0])
      );
      if (!participantName) {
        return sendJSON(res, 400, { error: 'Please enter your display name' });
      }

      if (isBlocked(meeting, {
        userId: authUser ? authUser.id : null,
        participantId,
        name: participantName,
      })) {
        return sendJSON(res, 403, { error: 'You no longer have access to this meeting.' });
      }

      // Persistent membership: blocked/removed in DB
      let membership = null;
      try {
        membership = await db.getMembership(code, {
          userId: authUser ? authUser.id : null,
          participantId,
        });
      } catch (_) {}
      if (membership && (membership.status === 'BLOCKED' || (membership.status === 'REMOVED' && !(paidMeeting && paidAdmission)))) {
        return sendJSON(res, 403, { error: 'You no longer have access to this meeting.' });
      }

      const savedParticipant = meeting.participants.get(participantId);
      const resumesSeat = !!savedParticipant &&
        (savedParticipant.userId == null || String(savedParticipant.userId) === String(authUser?.id)) &&
        (!savedParticipant.joinSessionId || savedParticipant.joinSessionId === req._sid) &&
        verifyWsCredential(body.wsCredential, { participantId, code, joinKey: savedParticipant.joinKey }).ok;
      const existing = savedParticipant && (resumesSeat || (!authUser && !savedParticipant.userId)) ? savedParticipant : null;
      const existingByUser = authUser ? findParticipantByUserId(meeting, authUser.id) : null;
      const rejoinCandidate = existing || existingByUser;
      if (authUser && duplicateAccount(meeting, authUser.id, resumesSeat ? existing : null)) {
        return sendJSON(res, 409, { error: JOIN_CONFLICT });
      }

      if (meeting.settings && meeting.settings.locked) {
        const canRejoin = rejoinCandidate && (rejoinCandidate.status === 'ACTIVE' || rejoinCandidate.status === 'APPROVED' || rejoinCandidate.status === 'LEFT');
        if (!canRejoin) {
          return sendJSON(res, 403, { error: 'Meeting is locked. New participants cannot join.' });
        }
      }

      const isGuest = !authUser;
      if (isGuest && meeting.settings && meeting.settings.guestAccess === false) {
        return sendJSON(res, 403, { error: 'Guest access is disabled for this meeting. Please sign in.' });
      }

      const activeCount = [...meeting.participants.values()].filter((p) => p.status === 'ACTIVE').length;
      const cap = stage.capacity(meeting);
      if (activeCount >= cap && !(rejoinCandidate && rejoinCandidate.status === 'ACTIVE')) {
        return sendJSON(res, 403, { error: `This room is full (max ${cap})` });
      }

      // Ticketed events: a valid ticket is needed to join (hosts, speakers and returning hosts skip).
      let joinTicket = null;
      if (meeting.eventId && !paidMeeting && !(rejoinCandidate && (rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost'))) {
        try {
          const gate = await require('../features/commerce/service').canJoinEvent(meeting.eventId, authUser);
          if (!gate.ok) return sendJSON(res, 403, { error: gate.reason, ticketRequired: true, eventSlug: meeting.eventSlug || null });
          joinTicket = gate.ticket || null;
        } catch (e) { console.warn('[tickets] gate', e.message); }
      } else if (meeting.eventId && authUser) {
        try { joinTicket = await require('../features/commerce/service').ticketFor(meeting.eventId, authUser.id); } catch (_) {}
      }

      let role = isGuest ? 'guest' : 'participant';
      let status = 'ACTIVE';

      // Venue admins join as cohosts and skip the waiting room
      if (authUser && meeting.venue) {
        try {
          const v = await require('../venue/data').getVenueByCode(meeting.code);
          if (v && await require('../venue/data').isVenueAdmin(v.id, authUser.id)) {
            role = 'cohost';
          }
        } catch (_) {}
      }

      if (rejoinCandidate) {
        if (rejoinCandidate.status === 'BLOCKED' || (rejoinCandidate.status === 'REMOVED' && !(paidMeeting && paidAdmission))) {
          return sendJSON(res, 403, { error: 'You no longer have access to this meeting.' });
        }
        if (rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost') {
          role = rejoinCandidate.role;
        }
      }

      const usagePaidJoin = !!(paidMeeting && meeting.paidEntry && meeting.paidEntry.model === 'usage');
      const paidAdmissionApproved = !!(paidMeeting && rejoinCandidate && rejoinCandidate.paidAdmissionApproved);
      const skipWait = !!(joinTicket && joinTicket.perks && joinTicket.perks.skipWaitingRoom);
      const needsWaiting = paidMeeting && !usagePaidJoin
        ? role !== 'host' && role !== 'cohost' && !paidAdmissionApproved
        : meeting.settings && meeting.settings.waitingRoom && role !== 'host' && !skipWait &&
          !(rejoinCandidate && (rejoinCandidate.status === 'ACTIVE' || rejoinCandidate.status === 'APPROVED' || rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost'));

      if (needsWaiting) status = 'WAITING';

      // Recheck after ticket and venue lookups, then reserve the seat before any further awaits.
      if (authUser && duplicateAccount(meeting, authUser.id, resumesSeat ? existing : null)) {
        return sendJSON(res, 409, { error: JOIN_CONFLICT });
      }
      const pid = rejoinCandidate?.id || (meeting.participants.has(participantId) ? 'user-' + crypto.randomUUID() : participantId);
      const participant = createParticipant({
        id: pid,
        name: participantName,
        role: rejoinCandidate && (rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost')
          ? rejoinCandidate.role
          : role,
        userId: authUser ? authUser.id : null,
        username: authUser ? authUser.username : null,
        verified: !!(authUser && isVerified(authUser)),
        device: body.device || 'desktop',
        status,
      });
      if (paidMeeting) participant.paidAdmissionApproved = false;
      if (rejoinCandidate && rejoinCandidate.role === 'host') {
        participant.role = 'host';
        participant.isHost = true;
      }

      if (joinTicket) participant.ticket = joinTicket;
      if (authUser) {
        participant.joinKey = (resumesSeat && existing.joinKey) || crypto.randomUUID();
        participant.joinSessionId = req._sid;
        participant.joinReservedUntil = Date.now() + JOIN_CONNECT_GRACE_MS;
      }
      meeting.participants.set(pid, participant);
      const wsCredential = signWsCredential({ participantId: pid, code, joinKey: participant.joinKey });

      if (status === 'ACTIVE' && meeting.historyId) {
        await db.logParticipantJoin({
          meetingHistoryId: meeting.historyId,
          userId: authUser ? authUser.id : null,
          displayName: participantName,
          participantId: pid,
        });
        await db.updateMaxParticipants(
          meeting.historyId,
          [...meeting.participants.values()].filter((p) => p.status === 'ACTIVE').length
        );
      }

      meeting.lastActivity = Date.now();

      if (status === 'WAITING') {
        broadcastToModerators(code, {
          type: 'waiting-request',
          participant: { id: pid, name: participantName, role, isGuest },
          waiting: getWaitingList(meeting),
        });
        try {
          await db.upsertMembership({
            code,
            userId: authUser ? authUser.id : null,
            participantId: pid,
            displayName: participantName,
            role,
            status: 'WAITING',
            email: authUser?.email || null,
          });
        } catch (_) {}
        return sendJSON(res, 200, {
          code,
          name: meeting.name,
          venue: meeting.venue || null,
          participantId: pid,
          wsCredential,
          role,
          status: 'WAITING',
          waitingRoom: true,
          paidEntry: meeting.paidEntry ? { ...meeting.paidEntry, paid: !!paidAdmission } : null,
          participants: [],
          waiting: [],
          security: getSecurityState(meeting),
          content: null,
        });
      }

      try {
        await db.upsertMembership({
          code,
          userId: authUser ? authUser.id : null,
          participantId: pid,
          displayName: participantName,
          role: participant.role,
          status: status,
          email: authUser?.email || null,
        });
      } catch (e) { console.warn('[membership] join', e.message); }

      if (usagePaidJoin && authUser && status === 'ACTIVE' && participant.role !== 'host') {
        try {
          const admission = await require('../features/wallet/paid-entry').accept({ code, userId: authUser.id, participantId: pid });
          participant.paidAdmissionApproved = true;
          paidAdmission = admission;
        } catch (e) {
          meeting.participants.delete(pid);
          return sendJSON(res, e.status || 402, { error: e.message || 'Add credits to join this paid-entry meeting', signInRequired: e.status === 401, topUp: e.status === 402 });
        }
      }

      // Restore role from membership if previously cohost/host
      if (membership && (membership.role === 'cohost' || membership.role === 'host') && membership.status === 'ACTIVE') {
        participant.role = membership.role;
        participant.isHost = membership.role === 'host';
        meeting.participants.set(pid, participant);
      }

      broadcast(code, {
        type: 'participant-joined',
        participantId: pid,
        participants: getParticipantsList(meeting),
        waiting: getWaitingList(meeting),
      }, pid);

      return sendJSON(res, 200, {
        code,
        name: meeting.name,
        venue: meeting.venue || null,
        freeUntilMs: meeting.billingId ? (await require('../features/wallet/billing-data').get(meeting.billingId))?.free_until_ms || null : null,
        paidEntry: meeting.paidEntry ? { ...meeting.paidEntry, paid: !!paidAdmission } : null,
        participantId: pid,
        wsCredential,
        role: participant.role,
        status: 'ACTIVE',
        participants: getParticipantsList(meeting),
        waiting: getWaitingList(meeting),
        raisedHands: getRaisedHands(meeting),
        security: getSecurityState(meeting),
        content: getContentState(meeting),
        permissions: resolvePermissions(meeting, participant),
        previouslyJoined: !!(membership && membership.status === 'ACTIVE'),
        stage: stage.state(meeting),
        eventSlug: meeting.eventSlug || null,
        eventId: meeting.eventId || null,
        certs: (participant.role === 'host' || participant.role === 'cohost') ? ((meeting.settings && meeting.settings.certs) || null) : undefined,
      });
    } catch (e) {
      console.error('[join]', e);
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Bad request') });
    }
  }

  if (urlPath.startsWith('/api/meeting/') && req.method === 'GET') {
    const code = normCode(urlPath.split('/').pop());
    const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
    if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
    await require('../features/wallet/billing').check(meeting);
    meeting.lastActivity = Date.now();
    return sendJSON(res, 200, {
      code,
      name: meeting.name,
      venue: meeting.venue || null,
      participants: getParticipantsList(meeting),
      waiting: getWaitingList(meeting),
      raisedHands: getRaisedHands(meeting),
      security: getSecurityState(meeting),
      createdAt: meeting.createdAt,
      content: getContentState(meeting),
      locked: !!(meeting.settings && meeting.settings.locked),
      stage: stage.state(meeting),
      eventSlug: meeting.eventSlug || null,
      requiresKey: meeting.inviteAccess === 'approval' || meeting.requireInviteKey === true,
      guestAccess: !(meeting.settings && meeting.settings.guestAccess === false),
      freeUntilMs: meeting.billingId ? (await require('../features/wallet/billing-data').get(meeting.billingId))?.free_until_ms || null : null,
      paidEntry: meeting.paidEntry || null,
    });
  }

  if (urlPath === '/api/meeting/paid-entry/extend' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
      if (!meeting?.paidEntry?.enabled) return sendJSON(res, 404, { error: 'Paid-entry meeting not found' });
      const participant = meeting.participants.get(body.participantId);
      if (!participant || participant.id !== meeting.hostId || participant.role !== 'host') return sendJSON(res, 403, { error: 'Only the host can extend this meeting' });
      if (!verifyWsCredential(body.wsCredential, { participantId: participant.id, code, joinKey: participant.joinKey }).ok) return sendJSON(res, 403, { error: 'Invalid room credential' });
      const user = await getAuthUser(req, res);
      if (!user) return sendJSON(res, 401, { error: 'Sign in to extend this meeting' });
      const result = await require('../features/wallet/paid-entry').extend({ code, hostUserId: user.id, minutes: body.minutes });
      meeting.paidEntry.runtimeEndMs = result.session.runtimeEndMs;
      broadcast(code, { type: 'paid-entry-extension', runtimeEndMs: result.session.runtimeEndMs, minutes: result.addedMinutes });
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Could not extend this meeting') });
    }
  }

  if (urlPath === '/api/meeting/billing/claim' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
      if (!meeting?.billingId) return sendJSON(res, 404, { error: 'Meeting not found' });
      const participant = meeting.participants.get(body.participantId);
      if (!participant || participant.id !== meeting.hostId || participant.role !== 'host') return sendJSON(res, 403, { error: 'Only this meeting’s host can connect a wallet' });
      if (!verifyWsCredential(body.wsCredential, { participantId: participant.id, code, joinKey: participant.joinKey }).ok) return sendJSON(res, 403, { error: 'Invalid room credential' });
      const user = await getAuthUser(req, res);
      if (!user) return sendJSON(res, 200, { claimed: false, authenticated: false });
      if (duplicateAccount(meeting, user.id, participant)) return sendJSON(res, 409, { error: JOIN_CONFLICT });
      const row = await withAccountReservation(participant, user.id,
        () => require('../features/wallet/billing-data').claimHost(meeting.billingId, user));
      participant.userId = user.id;
      participant.joinSessionId = req._sid;
      participant.username = user.username;
      participant.verified = isVerified(user);
      meeting.hostUserId = user.id;
      await db.upsertMembership({ code, userId: user.id, participantId: participant.id, displayName: participant.name, role: 'host', status: 'ACTIVE', email: user.email || null }).catch(() => {});
      return sendJSON(res, 200, { claimed: true, freeUntilMs: row.free_until_ms });
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Could not connect your wallet') });
    }
  }

  // Regenerate secure invite token (host only)
  if (urlPath === '/api/invite/regenerate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const participantId = body.participantId;
      const meeting = meetings.get(code);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
      await require('../features/wallet/billing').check(meeting);
      const actor = meeting.participants.get(participantId);
      if (!actor || !can(meeting, actor, 'manageSecurity')) {
        return sendJSON(res, 403, { error: 'Not allowed' });
      }
      meeting.inviteToken = generateInviteToken();
      return sendJSON(res, 200, {
        inviteToken: meeting.inviteToken,
        inviteLink: `/${code}?key=${meeting.inviteToken}`,
      });
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Bad request') });
    }
  }



  if (urlPath === '/api/meeting/paid-entry/enable' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
      const participant = meeting.participants.get(body.participantId);
      if (!participant || participant.id !== meeting.hostId || participant.role !== 'host') return sendJSON(res, 403, { error: 'Only the host can switch this meeting to Paid Entry' });
      if (!verifyWsCredential(body.wsCredential, { participantId: participant.id, code, joinKey: participant.joinKey }).ok) return sendJSON(res, 403, { error: 'Invalid room credential' });
      const user = await getAuthUser(req, res);
      if (!user) return sendJSON(res, 401, { error: 'Sign in to switch this meeting to Paid Entry', signInRequired: true });
      if (duplicateAccount(meeting, user.id, participant)) return sendJSON(res, 409, { error: JOIN_CONFLICT });
      if (meeting.paidEntry && meeting.paidEntry.enabled) return sendJSON(res, 409, { error: 'This meeting is already on Paid Entry' });
      const usage = require('../features/wallet/usage');
      const result = await withAccountReservation(participant, user.id, async () => {
        const offer = await usage.offerSwitch({ code, hostUserId: user.id, ownerId: require('../features/wallet/billing').ownerId });
        await usage.acceptUsage({ code, userId: user.id, participantId: participant.id, isHost: true, startNow: false });
        return offer;
      });
      meeting.hostUserId = user.id;
      participant.userId = user.id;
      participant.joinSessionId = req._sid;
      meeting.paidEntry = { ...result.session, enabled: true, model: 'usage', switchDeadlineMs: result.deadlineMs };
      for (const [pid, p] of meeting.participants) {
        if (p.role === 'host' || pid === participant.id) continue;
        if (p.status !== 'ACTIVE' && p.status !== 'WAITING') continue;
        await require('../features/wallet/usage').markPending(code, { userId: p.userId || null, participantId: pid }).catch(() => {});
      }
      broadcast(code, { type: 'paid-entry-switch', deadlineMs: result.deadlineMs, rateCreditsPerMin: 1, hostId: participant.id });
      return sendJSON(res, 200, { paidEntry: meeting.paidEntry, deadlineMs: result.deadlineMs });
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Could not switch to Paid Entry') });
    }
  }

  if (urlPath === '/api/meeting/paid-entry/accept' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
      if (!meeting?.paidEntry?.enabled || meeting.paidEntry.model !== 'usage') return sendJSON(res, 404, { error: 'Paid-entry meeting not found' });
      const participant = meeting.participants.get(body.participantId);
      if (!participant) return sendJSON(res, 403, { error: 'Not a participant of this meeting' });
      if (!verifyWsCredential(body.wsCredential, { participantId: participant.id, code, joinKey: participant.joinKey }).ok) return sendJSON(res, 403, { error: 'Invalid room credential' });
      const user = await getAuthUser(req, res);
      if (!user) return sendJSON(res, 401, { error: 'Sign in to continue in this paid-entry meeting', signInRequired: true });
      if (duplicateAccount(meeting, user.id, participant)) return sendJSON(res, 409, { error: JOIN_CONFLICT });
      const admission = await withAccountReservation(participant, user.id,
        () => require('../features/wallet/usage').acceptUsage({ code, userId: user.id, participantId: participant.id, isHost: participant.role === 'host', startNow: false }));
      participant.userId = user.id;
      participant.joinSessionId = req._sid;
      participant.username = user.username;
      participant.paidAdmissionApproved = true;
      return sendJSON(res, 200, { ok: true, admission });
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Could not accept Paid Entry'), topUp: e.status === 402 });
    }
  }

  if (urlPath === '/api/meeting/account/claim' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
      const participant = meeting.participants.get(body.participantId);
      if (!participant) return sendJSON(res, 403, { error: 'Not a participant of this meeting' });
      if (!verifyWsCredential(body.wsCredential, { participantId: participant.id, code, joinKey: participant.joinKey }).ok) return sendJSON(res, 403, { error: 'Invalid room credential' });
      const user = await getAuthUser(req, res);
      if (!user) return sendJSON(res, 200, { claimed: false, authenticated: false });
      if (duplicateAccount(meeting, user.id, participant)) return sendJSON(res, 409, { error: JOIN_CONFLICT });
      participant.userId = user.id;
      participant.joinSessionId = req._sid;
      participant.username = user.username;
      participant.verified = isVerified(user);
      if (participant.role === 'host' || participant.id === meeting.hostId) {
        meeting.hostUserId = user.id;
        if (meeting.billingId) {
          const row = await require('../features/wallet/billing-data').claimHost(meeting.billingId, user);
          await db.upsertMembership({ code, userId: user.id, participantId: participant.id, displayName: participant.name, role: 'host', status: 'ACTIVE', email: user.email || null }).catch(() => {});
          return sendJSON(res, 200, { claimed: true, role: 'host', freeUntilMs: row.free_until_ms });
        }
      }
      await db.upsertMembership({ code, userId: user.id, participantId: participant.id, displayName: participant.name, role: participant.role, status: participant.status, email: user.email || null }).catch(() => {});
      if (meeting.paidEntry && meeting.paidEntry.enabled && meeting.paidEntry.model === 'usage' && body.acceptPaid) {
        await require('../features/wallet/usage').acceptUsage({ code, userId: user.id, participantId: participant.id, isHost: participant.role === 'host', startNow: false });
        participant.paidAdmissionApproved = true;
      }
      return sendJSON(res, 200, { claimed: true, role: participant.role });
    } catch (e) {
      return sendJSON(res, e.status || 400, { error: publicErr(e, 'Could not connect your account'), topUp: e.status === 402 });
    }
  }

  if (urlPath === '/api/leave' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const participantId = body.participantId;
      const meeting = meetings.get(code);
      if (meeting && participantId) {
        const p = meeting.participants.get(participantId);
        if (p?.joinKey && !verifyWsCredential(body.wsCredential, { participantId, code, joinKey: p.joinKey }).ok) {
          const user = body.wsCredential ? null : await getAuthUser(req, res);
          if (!user || !p.joinSessionId || p.joinSessionId !== req._sid || meeting.participants.get(participantId) !== p) {
            return sendJSON(res, 403, { error: 'Invalid room credential' });
          }
        }
        if (p) {
          p.status = 'LEFT';
          p.leftAt = Date.now();
          p.handRaisedAt = null;
          p.sharing = false;
        }
        clients.delete(participantId);
        meeting.lastActivity = Date.now();

        if (meeting.historyId) {
          await db.logParticipantLeave({
            meetingHistoryId: meeting.historyId,
            participantId,
          });
        }

        const activeLeft = [...meeting.participants.values()].filter((x) => x.status === 'ACTIVE').length;
        if (activeLeft === 0) {
          await endMeeting(code, 'empty');
        } else {
          broadcast(code, {
            type: 'participant-left',
            participantId,
            participants: getParticipantsList(meeting),
            waiting: getWaitingList(meeting),
            raisedHands: getRaisedHands(meeting),
          });
        }
      }
      return sendJSON(res, 200, { ok: true });
    } catch {
      return sendJSON(res, 400, { error: 'Bad request' });
    }
  }

  return false;
};
