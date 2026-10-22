/** Optional content-share WS handlers (UI mostly removed; keep protocol for compatibility) */
module.exports = {
  id: 'content',
  register(ctx) {
    const { broadcast, getContentState, getParticipantsList, clients, getClient } = ctx;

    ctx.onWs('content-start', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;
      const ctype = msg.contentType || 'url';
      meeting.content = {
        type: ctype,
        title: String(msg.title || 'Shared content').slice(0, 80),
        url: msg.url || null,
        ownerId: participantId,
        remoteHolderId: participantId,
        scrollMode: msg.scrollMode === 'free' ? 'free' : 'uniform',
        scroll: msg.scroll || { x: 0, y: 0 },
        page: msg.page || 1,
        media: msg.media || null,
        fileMeta: msg.fileMeta || null,
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
      if (msg.page != null) meeting.content.page = msg.page;
      if (msg.media) meeting.content.media = { ...meeting.content.media, ...msg.media };
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
