/** Room plugin: wbShare (moved from src/plugins/venue.js). Turn off with FEATURE_WB_SHARE=false. */
const { MEMORY } = require('../../config');
const { active } = require('../../core/room-helpers');

// ------------------------------------------------------------------ personal whiteboards
// Every user draws on their own board. Sharing lets others view it live (read-only).
const wbSharePlugin = {
  id: 'wbShare',
  register(ctx) {
    const { broadcast } = ctx;
    const list = (meeting) => [...(meeting.sharedBoards || new Map()).values()].map((b) => ({ ownerId: b.ownerId, name: b.name, at: b.at }));
    ctx.onRegister((ws, meeting) => {
      try { ws.send(JSON.stringify({ type: 'pboard-list', boards: list(meeting) })); } catch (_) {}
    });
    ctx.onWs('pboard-share', ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      meeting.sharedBoards = meeting.sharedBoards || new Map();
      if (msg.on === false) meeting.sharedBoards.delete(pid);
      else meeting.sharedBoards.set(pid, { ownerId: pid, name: p.name, at: Date.now(), snapshot: null });
      broadcast(meetingCode, { type: 'pboard-list', boards: list(meeting) });
    });
    // Owner pushes the page on screen as a full frame (throttled client-side), and single strokes as
    // { append:true } deltas in between. We keep the latest frame so late joiners see the board at once.
    const okImg = (u) => typeof u === 'string' && (/^\/files\//.test(u) || (/^data:image\//.test(u) && u.length < 1.5e6));
    ctx.onWs('pboard-frame', ({ msg, participantId: pid, meeting, meetingCode }) => {
      const b = meeting.sharedBoards && meeting.sharedBoards.get(pid);
      if (!b) return;
      const strokes = Array.isArray(msg.strokes) ? msg.strokes.slice(-MEMORY.wbMaxStrokes) : [];
      const page = Math.max(0, Math.min(49, Number(msg.page) || 0));
      if (msg.append) {
        if (!b.snapshot || b.snapshot.page !== page || JSON.stringify(strokes).length > 200000) return;
        b.snapshot.strokes.push(...strokes);
        if (b.snapshot.strokes.length > MEMORY.wbMaxStrokes) b.snapshot.strokes = b.snapshot.strokes.slice(-Math.ceil(MEMORY.wbMaxStrokes * 0.75));
        b.at = Date.now();
        broadcast(meetingCode, { type: 'pboard-frame', ownerId: pid, append: true, page, strokes }, pid);
        return;
      }
      const frame = {
        page, pages: Math.max(1, Math.min(50, Number(msg.pages) || 1)), bg: ['dots', 'grid', 'lines', 'plain'].includes(msg.bg) ? msg.bg : 'dots', strokes,
        images: (Array.isArray(msg.images) ? msg.images : []).filter((i) => i && okImg(i.url)).slice(0, 40),
        texts: (Array.isArray(msg.texts) ? msg.texts : []).slice(0, 300),
      };
      if (JSON.stringify(frame).length > 3000000) return;
      b.snapshot = frame; b.at = Date.now();
      broadcast(meetingCode, { type: 'pboard-frame', ownerId: pid, ...frame }, pid);
    });
    ctx.onWs('pboard-view', ({ msg, participantId: pid, meeting }) => {
      const b = meeting.sharedBoards && meeting.sharedBoards.get(msg.ownerId);
      ctx.sendToParticipant(pid, { type: 'pboard-frame', ownerId: msg.ownerId, ...((b && b.snapshot) || { page: 0, pages: 1, strokes: [] }), full: true });
    });
  },
};

module.exports = wbSharePlugin;
