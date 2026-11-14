/**
 * Core rooms: LiveKit token, create, join, meeting state, invite regenerate, leave.
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, config, normCode, isCode, parseBody, sendJSON, getAuthUser, meetings, clients, getParticipantsList, getWaitingList, getRaisedHands, getContentState, getSecurityState, broadcast, broadcastToModerators, generateCode, generateInviteToken, createMeetingSettings, createParticipant, normalizeParticipantName, findParticipantByUserId, isBlocked, can, resolvePermissions, endMeeting, getOrRestoreMeeting, discardSnapshot, createLiveKitToken, grantsFromPermissions, signWsCredential, stage, publicErr, LIVEKIT_URL,
} = require('./http-kit');

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
      const participant = meeting.participants.get(participantId);
      if (!participant) {
        return sendJSON(res, 403, { error: 'Not a participant of this meeting' });
      }

      const participantName = normalizeParticipantName(body.participantName)
        || participant.name
        || 'Participant';

      if (!body.wsCredential || !require('../lib/wsCredential').verifyWsCredential(body.wsCredential, { participantId, code }).ok) {
        // Some clients omit this. Accept it but log.
        if (body.wsCredential) return sendJSON(res, 403, { error: 'Invalid credential' });
      }
      if (participant.status !== 'ACTIVE') {
        return sendJSON(res, 403, { error: 'Not admitted yet' });
      }
      const perms = resolvePermissions(meeting, participant);
      const grants = grantsFromPermissions(perms);
      // Breakout rooms live in their own LiveKit rooms (CODE-bo-N)
      let roomName = code;
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
      return sendJSON(res, 500, { error: publicErr(e, 'Failed to create token') });
    }
  }

  if (urlPath === '/api/create' && req.method === 'POST') {
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

      await discardSnapshot(code); // a leftover restart snapshot for this code is superseded
      const historyId = await db.startMeetingHistory({
        code,
        name,
        hostUserId: authUser ? authUser.id : null,
        hostDisplayName: hostName,
      });

      await db.logParticipantJoin({
        meetingHistoryId: historyId,
        userId: authUser ? authUser.id : null,
        displayName: hostName,
        participantId: hostId,
      });

      const settings = createMeetingSettings({
        waitingRoom: !!body.waitingRoom || !!venue,
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
        device: body.device || 'desktop',
        status: 'ACTIVE',
      });

      const participants = new Map();
      participants.set(hostId, host);

      const now = Date.now();
      const inviteToken = generateInviteToken();
      meetings.set(code, {
        code,
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
      stage.init(meeting, {
        enabled: !!(body.stage || (event && event.category !== 'meeting')),
        seats: body.speakerSeats || (event && event.speakerSeats),
      });
      if (event) {
        meeting.eventId = event.id;
        meeting.eventSlug = event.slug;
        meeting.ownerTheme = event.theme || null;
        meeting.event = { id: event.id, slug: event.slug, title: event.title, category: event.category, visibility: event.visibility, theme: event.theme };
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

      const hostWsCredential = signWsCredential({ participantId: hostId, code });
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
        venue: meeting.venue || null,
      });
    } catch (e) {
      console.error('[create]', e);
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
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

      // Secure invite key enforcement
      const providedKey = body.key || body.inviteToken || null;
      const requireKey = meeting.inviteAccess === 'approval' || meeting.requireInviteKey === true;
      if (requireKey) {
        if (!providedKey || providedKey !== meeting.inviteToken) {
          return sendJSON(res, 403, { error: 'A valid invitation link is required to join this meeting.' });
        }
      }

      const authUser = await getAuthUser(req, res);
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
      if (membership && (membership.status === 'BLOCKED' || membership.status === 'REMOVED')) {
        return sendJSON(res, 403, { error: 'You no longer have access to this meeting.' });
      }

      const existing = meeting.participants.get(participantId);
      const existingByUser = authUser ? findParticipantByUserId(meeting, authUser.id) : null;
      const rejoinCandidate = existing || existingByUser;

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
        if (rejoinCandidate.status === 'BLOCKED' || rejoinCandidate.status === 'REMOVED') {
          return sendJSON(res, 403, { error: 'You no longer have access to this meeting.' });
        }
        if (rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost') {
          role = rejoinCandidate.role;
        }
      }

      const needsWaiting =
        meeting.settings &&
        meeting.settings.waitingRoom &&
        role !== 'host' &&
        !(rejoinCandidate && (rejoinCandidate.status === 'ACTIVE' || rejoinCandidate.status === 'APPROVED' || rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost'));

      if (needsWaiting) status = 'WAITING';

      const pid = (rejoinCandidate && rejoinCandidate.id) || participantId;
      const participant = createParticipant({
        id: pid,
        name: participantName,
        role: rejoinCandidate && (rejoinCandidate.role === 'host' || rejoinCandidate.role === 'cohost')
          ? rejoinCandidate.role
          : role,
        userId: authUser ? authUser.id : null,
        username: authUser ? authUser.username : null,
        device: body.device || 'desktop',
        status,
      });
      if (rejoinCandidate && rejoinCandidate.role === 'host') {
        participant.role = 'host';
        participant.isHost = true;
      }

      meeting.participants.set(pid, participant);

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
          wsCredential: signWsCredential({ participantId: pid, code }),
          role,
          status: 'WAITING',
          waitingRoom: true,
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
        participantId: pid,
        wsCredential: signWsCredential({ participantId: pid, code }),
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
      });
    } catch (e) {
      console.error('[join]', e);
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
    }
  }

  if (urlPath.startsWith('/api/meeting/') && req.method === 'GET') {
    const code = normCode(urlPath.split('/').pop());
    const meeting = meetings.get(code) || (isCode(code) ? await getOrRestoreMeeting(code) : null);
    if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
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
    });
  }

  // Regenerate secure invite token (host only)
  if (urlPath === '/api/invite/regenerate' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const code = normCode(body.code);
      const participantId = body.participantId;
      const meeting = meetings.get(code);
      if (!meeting) return sendJSON(res, 404, { error: 'Meeting not found' });
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
      return sendJSON(res, 400, { error: publicErr(e, 'Bad request') });
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
          endMeeting(code, 'empty');
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
