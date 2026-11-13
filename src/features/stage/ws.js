/** Room plugin: stage (moved from src/plugins/venue.js). Turn off with FEATURE_STAGE=false. */
const { resolvePermissions } = require('../../lib/permissions');
const stage = require('../../venue/stage');
const { mod, active, err, limited } = require('../../core/room-helpers');

// ------------------------------------------------------------------ stage
const stagePlugin = {
  id: 'stage',
  register(ctx) {
    const { broadcast, sendToParticipant, getParticipantsList } = ctx;
    const emit = (code, meeting) => broadcast(code, { type: 'stage-state', stage: stage.state(meeting) });
    const repermit = async (code, meeting, pid) => {
      const p = meeting.participants.get(pid);
      if (!p) return;
      const perms = resolvePermissions(meeting, p);
      sendToParticipant(pid, { type: 'permissions-updated', permissions: perms });
      await stage.syncLiveKit(code, pid, perms);
    };
    const seat = async (code, meeting, pid) => {
      const st = stage.ensure(meeting);
      st.requests = st.requests.filter((r) => r.id !== pid);
      st.speakers.add(pid);
      await repermit(code, meeting, pid);
      sendToParticipant(pid, { type: 'stage-invited', seats: st.seats });
    };
    const unseat = async (code, meeting, pid, by) => {
      const st = stage.ensure(meeting);
      if (!st.speakers.delete(pid)) return;
      await repermit(code, meeting, pid);
      sendToParticipant(pid, { type: 'stage-removed', by });
    };

    ctx.onRegister((ws, meeting) => {
      try { ws.send(JSON.stringify({ type: 'stage-state', stage: stage.state(meeting) })); } catch (_) {}
    });
    ctx.onWs('stage-request', ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      const st = stage.ensure(meeting);
      if (!p || !st.enabled || st.speakers.has(pid) || mod(meeting, pid)) return;
      if (limited(pid, 'stage', 3000)) return;
      if (!st.requests.find((r) => r.id === pid)) {
        st.requests.push({ id: pid, name: p.name, at: Date.now(), note: String(msg.note || '').slice(0, 140) });
      }
      ctx.broadcastToModerators(meetingCode, { type: 'stage-request', request: st.requests.find((r) => r.id === pid) });
      emit(meetingCode, meeting);
    });
    ctx.onWs('stage-cancel', ({ participantId: pid, meeting, meetingCode }) => {
      const st = stage.ensure(meeting);
      st.requests = st.requests.filter((r) => r.id !== pid);
      emit(meetingCode, meeting);
    });
    ctx.onWs('stage-approve', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const st = stage.ensure(meeting);
      const target = active(meeting, msg.targetId);
      if (!target) return;
      if (stage.seatedCount(meeting) >= st.seats) return err(ctx, pid, `All ${st.seats} speaker seats are taken. Remove someone first or add a seat.`);
      await seat(meetingCode, meeting, target.id);
      emit(meetingCode, meeting);
      broadcast(meetingCode, { type: 'participants', participants: getParticipantsList(meeting) });
    });
    ctx.onWs('stage-deny', ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const st = stage.ensure(meeting);
      st.requests = st.requests.filter((r) => r.id !== msg.targetId);
      sendToParticipant(msg.targetId, { type: 'stage-denied' });
      emit(meetingCode, meeting);
    });
    ctx.onWs('stage-remove', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const target = msg.targetId || pid;
      if (target !== pid && !mod(meeting, pid)) return;
      await unseat(meetingCode, meeting, target, pid);
      emit(meetingCode, meeting);
      broadcast(meetingCode, { type: 'participants', participants: getParticipantsList(meeting) });
    });
    ctx.onWs('stage-config', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const st = stage.ensure(meeting);
      const wasEnabled = st.enabled;
      if (typeof msg.enabled === 'boolean') st.enabled = msg.enabled;
      if (msg.seats != null) st.seats = Math.min(50, Math.max(1, parseInt(msg.seats, 10) || st.seats));
      if (typeof msg.camerasForSpeakers === 'boolean') st.camerasForSpeakers = msg.camerasForSpeakers;
      if (wasEnabled !== st.enabled) {
        for (const [id, p] of meeting.participants) if (p.status === 'ACTIVE') await repermit(meetingCode, meeting, id);
      }
      emit(meetingCode, meeting);
      broadcast(meetingCode, { type: 'participants', participants: getParticipantsList(meeting) });
    });
  },
};

module.exports = stagePlugin;
