/** Room plugin: scripture (moved from src/plugins/venue.js). Turn off with FEATURE_SCRIPTURE=false. */
const stage = require('../../venue/stage');
const { mod, active, err } = require('../../core/room-helpers');

// ------------------------------------------------------------------ scripture
const scripturePlugin = {
  id: 'scripture',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onRegister((ws, meeting) => {
      if (meeting.scripture) try { ws.send(JSON.stringify({ type: 'scripture-show', scripture: meeting.scripture })); } catch (_) {}
    });
    // The host broadcasts a reference; each client renders it in their own translation.
    ctx.onWs('scripture-show', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const st = stage.ensure(meeting);
      if (!(mod(meeting, pid) || st.speakers.has(pid))) {
        try { ctx.sendToParticipant(pid, { type: 'error', error: 'Request sent to host' }); } catch (_) {}
        const hosts = [...meeting.participants.values()].filter(x => x.role === 'host' || x.role === 'cohost' || x.isHost);
        hosts.forEach(h => {
          try { ctx.sendToParticipant(h.id, { type: 'permission-request', fromId: pid, fromName: p.name, action: 'scripture', detail: `share ${msg.reference}`, at: Date.now() }); } catch (_) {}
        });
        return;
      }
      const bible = require('../venue/bible');
      const ref = bible.parseReference(msg.reference);
      if (!ref) return err(ctx, pid, 'Could not read that reference');
      meeting.scripture = { reference: String(msg.reference).slice(0, 60), parsed: ref, translation: msg.translation ? String(msg.translation).slice(0, 40) : null, mode: msg.mode === 'stage' ? 'stage' : 'side', by: p.name, byId: pid, at: Date.now() };
      broadcast(meetingCode, { type: 'scripture-show', scripture: meeting.scripture });
    });
    ctx.onWs('scripture-clear', ({ participantId: pid, meeting, meetingCode }) => {
      if (!(mod(meeting, pid) || stage.ensure(meeting).speakers.has(pid))) return;
      meeting.scripture = null;
      broadcast(meetingCode, { type: 'scripture-clear' });
    });
  },
};

module.exports = scripturePlugin;
