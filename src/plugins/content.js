/**
 * Content sharing over the room WebSocket (works without LiveKit).
 * Allowed types only:
 *   youtube — a YouTube video id; every viewer streams from YouTube, play/pause/seek follow the remote holder
 *   slides  — page images (a PDF rendered to images in the presenter's browser, uploaded to storage)
 *   image   — a single uploaded image
 * Generic web pages (most sites refuse to be framed) and self-hosted video (would stream from this server)
 * are intentionally not supported.
 */
const YT_ID = /^[\w-]{11}$/;
const FILE_URL = /^\/files\/[\w-]{1,64}\/[\w.%~()'!*-]{1,240}$/;
const okFile = (u) => typeof u === 'string' && FILE_URL.test(u);

function sanitizeContent(msg) {
  const type = msg.contentType;
  const title = String(msg.title || '').trim().slice(0, 80);
  if (type === 'youtube') {
    const id = String(msg.videoId || '');
    if (!YT_ID.test(id)) return null;
    return { type, videoId: id, url: `https://www.youtube.com/watch?v=${id}`, title: title || 'YouTube video', pages: null, fileMeta: null };
  }
  if (type === 'slides') {
    const pages = Array.isArray(msg.pages) ? msg.pages.filter(okFile).slice(0, 200) : [];
    if (!pages.length) return null;
    return { type, url: pages[0], pages, title: title || 'Slides', fileMeta: sanitizeMeta(msg.fileMeta) };
  }
  if (type === 'image') {
    if (!okFile(msg.url)) return null;
    return { type, url: msg.url, pages: null, title: title || 'Image', fileMeta: sanitizeMeta(msg.fileMeta) };
  }
  return null;
}
function sanitizeMeta(m) {
  if (!m || typeof m !== 'object') return null;
  return { name: String(m.name || '').slice(0, 120), size: Number(m.size) || 0, mime: String(m.mime || '').slice(0, 80) };
}

module.exports = {
  sanitizeContent,
  id: 'content',
  register(ctx) {
    const { broadcast, getContentState, getParticipantsList, clients, getClient } = ctx;

    ctx.onWs('content-start', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;
      const c = sanitizeContent(msg);
      if (!c) return;
      meeting.content = {
        ...c,
        ownerId: participantId,
        remoteHolderId: participantId,
        scrollMode: 'uniform',
        scroll: null,
        page: 1,
        media: c.type === 'youtube' ? { paused: true, t: 0, at: Date.now() } : null,
      };
      broadcast(meetingCode, { type: 'content-state', content: getContentState(meeting) });
    });

    ctx.onWs('content-stop', ({ participantId, meeting, meetingCode }) => {
      if (!meeting.content) return;
      const isOwner = meeting.content.ownerId === participantId;
      const isHost = meeting.participants.get(participantId)?.isHost;
      if (!isOwner && !isHost) return;
      meeting.content = null;
      broadcast(meetingCode, { type: 'content-state', content: null });
    });

    ctx.onWs('content-update', ({ msg, participantId, meeting, meetingCode }) => {
      if (!meeting.content) return;
      const holder = meeting.content.remoteHolderId;
      const isHolder = holder === participantId;
      const isOwner = meeting.content.ownerId === participantId;
      if (!isHolder && !isOwner) return;
      if (msg.scroll) meeting.content.scroll = msg.scroll;
      if (msg.page != null) {
        const max = meeting.content.pages ? meeting.content.pages.length : 1;
        meeting.content.page = Math.max(1, Math.min(max, Math.round(Number(msg.page)) || 1));
      }
      if (msg.media && typeof msg.media === 'object') {
        const m = msg.media;
        meeting.content.media = {
          paused: !!m.paused,
          t: Math.max(0, Number(m.t) || 0),
          at: Date.now(),
          rate: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].includes(Number(m.rate)) ? Number(m.rate) : 1,
        };
      }
      if (msg.scrollMode) meeting.content.scrollMode = msg.scrollMode === 'free' ? 'free' : 'uniform';
      if (msg.title) meeting.content.title = String(msg.title).slice(0, 80);
      broadcast(
        meetingCode,
        { type: 'content-update', content: getContentState(meeting), from: participantId },
        participantId
      );
    });

    ctx.onWs('remote-handoff', ({ msg, participantId, meeting, meetingCode }) => {
      if (!meeting.content) return;
      const targetId = msg.targetId;
      const isOwner = meeting.content.ownerId === participantId;
      const isHolder = meeting.content.remoteHolderId === participantId;
      const isHost = meeting.participants.get(participantId)?.isHost;
      if (!isOwner && !isHolder && !isHost) return;
      if (targetId && !meeting.participants.has(targetId)) return;
      meeting.content.remoteHolderId = targetId || meeting.content.ownerId;
      broadcast(meetingCode, { type: 'content-state', content: getContentState(meeting) });
    });

    ctx.onWs('remote-claim', ({ participantId, meeting, meetingCode }) => {
      if (!meeting.content) return;
      const holderId = meeting.content.remoteHolderId;
      const holderOnline =
        holderId && clients.has(holderId) && clients.get(holderId)?.readyState === 1;
      const isOwner = meeting.content.ownerId === participantId;
      if (isOwner || !holderOnline) {
        meeting.content.remoteHolderId = participantId;
        broadcast(meetingCode, { type: 'content-state', content: getContentState(meeting) });
      }
    });

    ctx.onRegister((ws, meeting) => {
      if (!meeting) return;
      try {
        ws.send(JSON.stringify({ type: 'content-state', content: getContentState(meeting) }));
      } catch (_) {}
    });
  },
};
