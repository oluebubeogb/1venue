/**
 * Sessions: meeting history and artifacts (notes, restart).
 * Raw HTTP handler.
 * Each block answers its path and returns; unmatched requests fall through (return false).
 */
const {
  db, normCode, parseBody, sendJSON, getAuthUser,
} = require('../../core/http-kit');

module.exports = async function handle(req, res, parsed) {
  const urlPath = parsed.pathname;

  if (urlPath === '/api/history' && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const limit = Math.min(100, Math.max(1, parseInt(parsed.searchParams.get('limit') || '50', 10)));
    const rows = await db.getHistoryForUser(user.id, limit);
    const history = [];
    for (const r of rows) {
      let artifact = null;
      try {
        if (r.ended_at) {
          artifact = await db.ensureArtifactForHistory(r.id, r.code);
        } else {
          artifact = await db.getArtifactForHistory(r.id);
        }
      } catch (_) {}
      history.push({
        id: r.id,
        code: r.code,
        name: r.name,
        hostDisplayName: r.host_display_name,
        createdAt: r.created_at,
        endedAt: r.ended_at,
        maxParticipants: r.max_participants,
        wasHost: !!r.was_host,
        artifactSlug: artifact ? artifact.artifact_slug : null,
        artifactUrl: artifact ? `/m/${r.code}/${artifact.artifact_slug}` : null,
      });
    }
    return sendJSON(res, 200, { history });
  }

  if (urlPath.startsWith('/api/history/') && req.method === 'GET') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const id = parseInt(urlPath.split('/').pop(), 10);
    if (!id) return sendJSON(res, 400, { error: 'Invalid id' });
    const meeting = await db.getMeetingHistoryById(id);
    if (!meeting) return sendJSON(res, 404, { error: 'Not found' });
    // Only host or someone who joined can view
    const participants = await db.getMeetingParticipantsLog(id);
    const allowed =
      meeting.host_user_id === user.id ||
      participants.some((p) => p.user_id === user.id);
    if (!allowed) return sendJSON(res, 403, { error: 'Forbidden' });
    let artifact = null;
    try {
      if (meeting.ended_at) artifact = await db.ensureArtifactForHistory(id, meeting.code);
      else artifact = await db.getArtifactForHistory(id);
    } catch (_) {}
    const recordings = await db.getRecordingsForHistory(id).catch(() => []);
    return sendJSON(res, 200, {
      meeting: {
        id: meeting.id,
        code: meeting.code,
        name: meeting.name,
        venue: meeting.venue || null,
        hostDisplayName: meeting.host_display_name,
        createdAt: meeting.created_at,
        endedAt: meeting.ended_at,
        maxParticipants: meeting.max_participants,
      },
      participants: participants.map((p) => ({
        displayName: p.display_name,
        userId: p.user_id,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
      })),
      artifact: artifact
        ? {
            id: artifact.id,
            slug: artifact.artifact_slug,
            url: `/m/${meeting.code}/${artifact.artifact_slug}`,
            isLive: !!artifact.is_live,
            isPublic: !!artifact.is_public,
          }
        : null,
      recordings: (recordings || []).map((rec) => ({
        id: rec.id,
        status: rec.status,
        startedAt: rec.started_at,
        endedAt: rec.ended_at,
        fileUrl: rec.file_url || null,
      })),
    });
  }

  // ----- Artifacts (Phase 1) -----
  if (urlPath.startsWith('/api/artifacts/') && req.method === 'GET') {
    const parts = urlPath.split('/').filter(Boolean); // api, artifacts, code, slug
    if (parts.length >= 4) {
      const code = normCode(parts[2]);
      const slug = parts[3];
      const artifact = await db.getArtifactBySlug(code, slug);
      if (!artifact) return sendJSON(res, 404, { error: 'Artifact not found' });
      const meeting = artifact.meeting_history_id
        ? await db.getMeetingHistoryById(artifact.meeting_history_id)
        : null;
      const user = await getAuthUser(req, res);
      const isPublic = !!artifact.is_public;
      let allowed = isPublic;
      if (!allowed && user && meeting) {
        const partsLog = await db.getMeetingParticipantsLog(meeting.id);
        allowed =
          meeting.host_user_id === user.id ||
          partsLog.some((p) => p.user_id === user.id);
      }
      if (!allowed) return sendJSON(res, 403, { error: 'Forbidden' });
      const chat = await db.getChatForArtifact(artifact.id).catch(() => []);
      const activity = meeting
        ? await db.getActivityForMeeting(meeting.id).catch(() => [])
        : [];
      const recordings = meeting
        ? await db.getRecordingsForHistory(meeting.id).catch(() => [])
        : [];
      const participants = meeting
        ? await db.getMeetingParticipantsLog(meeting.id).catch(() => [])
        : [];
      let note = null;
      if (user) note = await db.getPersonalNote(artifact.id, user.id).catch(() => null);
      return sendJSON(res, 200, {
        artifact: {
          id: artifact.id,
          code: artifact.short_code,
          slug: artifact.artifact_slug,
          isLive: !!artifact.is_live,
          isPublic: isPublic,
          createdAt: artifact.created_at,
        },
        meeting: meeting
          ? {
              id: meeting.id,
              code: meeting.code,
              name: meeting.name,
              venue: meeting.venue || null,
              hostDisplayName: meeting.host_display_name,
              createdAt: meeting.created_at,
              endedAt: meeting.ended_at,
            }
          : null,
        chat: (chat || []).map((c) => ({
          id: c.id,
          senderId: c.sender_id,
          senderName: c.sender_name,
          body: c.body,
          attachments: typeof c.attachments === 'string' ? JSON.parse(c.attachments || 'null') : c.attachments,
          createdAt: c.created_at,
        })),
        activity,
        recordings: (recordings || []).map((rec) => ({
          id: rec.id,
          status: rec.status,
          startedAt: rec.started_at,
          endedAt: rec.ended_at,
          fileUrl: rec.file_url || null,
        })),
        participants: (participants || []).map((p) => ({
          displayName: p.display_name,
          userId: p.user_id,
          joinedAt: p.joined_at,
          leftAt: p.left_at,
        })),
        note: note ? { content: note.content, updatedAt: note.updated_at } : null,
        isHost: !!(user && meeting && meeting.host_user_id === user.id),
      });
    }
  }

  if (urlPath.match(/^\/api\/artifacts\/[^/]+\/[^/]+\/note$/) && req.method === 'POST') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const parts = urlPath.split('/').filter(Boolean);
    const code = normCode(parts[2]);
    const slug = parts[3];
    const artifact = await db.getArtifactBySlug(code, slug);
    if (!artifact) return sendJSON(res, 404, { error: 'Artifact not found' });
    const body = await parseBody(req);
    const note = await db.upsertPersonalNote({
      artifactId: artifact.id,
      userId: user.id,
      content: body.content || '',
    });
    return sendJSON(res, 200, { note: { content: note.content, updatedAt: note.updated_at } });
  }


  if (urlPath.match(/^\/api\/artifacts\/[^/]+\/[^/]+\/restart$/) && req.method === 'POST') {
    const user = await getAuthUser(req, res);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated' });
    const parts = urlPath.split('/').filter(Boolean);
    const code = normCode(parts[2]);
    const slug = parts[3];
    const artifact = await db.getArtifactBySlug(code, slug);
    if (!artifact) return sendJSON(res, 404, { error: 'Artifact not found' });
    const meeting = artifact.meeting_history_id
      ? await db.getMeetingHistoryById(artifact.meeting_history_id)
      : null;
    if (!meeting || meeting.host_user_id !== user.id) {
      return sendJSON(res, 403, { error: 'Only the host can restart this meeting' });
    }
    await db.setArtifactLive(artifact.id, true);
    return sendJSON(res, 200, {
      ok: true,
      joinUrl: `/m/${encodeURIComponent(code)}?restart=1&artifact=${encodeURIComponent(slug)}`,
      code,
      artifactSlug: slug,
    });
  }

  return false;
};
