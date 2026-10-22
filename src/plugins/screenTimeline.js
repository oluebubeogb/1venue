/** Screen timeline: up to 10 host/cohost images; acts as fallback "screen" for viewers */
module.exports = {
  id: 'screenTimeline',
  register(ctx) {
    const { broadcast } = ctx;

    function ensure(meeting) {
      if (!meeting.screenTimeline) {
        meeting.screenTimeline = { items: [], slideshow: false, selected: 0 };
      }
      return meeting.screenTimeline;
    }

    function canEdit(meeting, participantId) {
      const p = meeting.participants.get(participantId);
      if (!p) return false;
      if (p.isHost || p.role === 'host' || p.role === 'cohost') return true;
      // Per-user override from host/cohost people menu
      if (p.permissionOverrides && p.permissionOverrides.screenTimeline) return true;
      try {
        const { resolvePermissions } = require('../lib/permissions');
        const perms = resolvePermissions(meeting, p);
        return !!perms.screenTimeline;
      } catch (_) {
        return false;
      }
    }

    ctx.onWs('screen-timeline-add', ({ msg, participantId, meeting, meetingCode }) => {
      if (!canEdit(meeting, participantId)) {
        console.warn('[screenTimeline] add denied for', participantId);
        try {
          const { sendToParticipant } = ctx;
          if (sendToParticipant) {
            sendToParticipant(participantId, { type: 'error', error: 'Not allowed to add timeline images' });
          }
        } catch (_) {}
        return;
      }
      const st = ensure(meeting);
      if (!msg.item || !msg.item.dataUrl) {
        console.warn('[screenTimeline] add missing dataUrl');
        return;
      }
      if (st.items.length >= 10) return;
      const item = {
        id: String(msg.item.id || ('st-' + Date.now())).slice(0, 64),
        dataUrl: String(msg.item.dataUrl).slice(0, 2_500_000),
        ownerId: participantId,
        ownerName: String(msg.item.ownerName || meeting.participants.get(participantId)?.name || 'Host').slice(0, 64),
      };
      st.items.push(item);
      // Keep current selection; only default to 0 on the first image
      if (st.items.length === 1) st.selected = 0;
      // Single event — avoid add + full state (that caused rapid image flicker)
      broadcast(meetingCode, {
        type: 'screen-timeline-add',
        item,
        selected: st.selected,
        count: st.items.length,
      });
    });

    ctx.onWs('screen-timeline-remove', ({ msg, participantId, meeting, meetingCode }) => {
      if (!canEdit(meeting, participantId)) return;
      const st = ensure(meeting);
      const id = msg.id;
      st.items = st.items.filter((x) => x.id !== id);
      if (st.selected >= st.items.length) st.selected = Math.max(0, st.items.length - 1);
      broadcast(meetingCode, { type: 'screen-timeline-remove', id });
      broadcast(meetingCode, {
        type: 'screen-timeline-state',
        items: st.items,
        slideshow: st.slideshow,
        selected: st.selected,
      });
    });

    ctx.onWs('screen-timeline-slideshow', ({ msg, participantId, meeting, meetingCode }) => {
      if (!canEdit(meeting, participantId)) return;
      const st = ensure(meeting);
      st.slideshow = !!msg.on;
      broadcast(meetingCode, { type: 'screen-timeline-slideshow', on: st.slideshow });
    });

    ctx.onWs('screen-timeline-select', ({ msg, participantId, meeting, meetingCode }) => {
      const st = ensure(meeting);
      if (typeof msg.index !== 'number' || msg.index < 0 || msg.index >= st.items.length) return;
      // Only host/cohost may drive a shared selection, and only while slideshow is on
      const p = meeting.participants.get(participantId);
      const hostLike = p && (p.isHost || p.role === 'host' || p.role === 'cohost');
      if (!hostLike || !st.slideshow) return;
      st.selected = msg.index;
      broadcast(meetingCode, { type: 'screen-timeline-select', index: st.selected }, participantId);
    });

    ctx.onWs('screen-timeline-request', ({ meeting, ws }) => {
      if (!meeting || !ws) return;
      const st = ensure(meeting);
      try {
        ws.send(JSON.stringify({
          type: 'screen-timeline-state',
          items: st.items,
          slideshow: st.slideshow,
          selected: st.selected || 0,
        }));
      } catch (_) {}
    });

    ctx.onRegister((ws, meeting) => {
      if (!meeting) return;
      const st = ensure(meeting);
      try {
        ws.send(JSON.stringify({
          type: 'screen-timeline-state',
          items: st.items,
          slideshow: st.slideshow,
          selected: st.selected || 0,
        }));
      } catch (_) {}
    });
  },
};
