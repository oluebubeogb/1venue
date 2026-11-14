/** Room plugin: polls. Turn off with FEATURE_POLLS=false. */
const data = require('../../venue/data');
const { mod, active, voterKey, err } = require('../../core/room-helpers');

// ------------------------------------------------------------------ polls
const pollsPlugin = {
  id: 'polls',
  register(ctx) {
    const { broadcast, sendToParticipant } = ctx;
    ctx.onRegister((ws, meeting, pid) => {
      const p = meeting.participants.get(pid);
      data.listPolls(meeting.code || meeting.id, meeting.historyId, p ? voterKey(p) : '')
        .then((polls) => { try { ws.send(JSON.stringify({ type: 'polls', polls })); } catch (_) {} }).catch(() => {});
    });
    ctx.onWs('poll-create', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p || !mod(meeting, pid)) return err(ctx, pid, 'Only hosts can start polls');
      try {
        const poll = await data.createPoll({ code: meetingCode, historyId: meeting.historyId, question: msg.question, options: msg.options, multi: msg.multi, anonymous: msg.anonymous, createdBy: p.userId });
        broadcast(meetingCode, { type: 'poll-new', poll, by: p.name });
      } catch (e) { err(ctx, pid, e.message); }
    });
    ctx.onWs('poll-vote', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      try {
        await data.votePoll(msg.pollId, voterKey(p), msg.choices);
        const mine = await data.pollResults(msg.pollId, voterKey(p));
        sendToParticipant(pid, { type: 'poll-update', poll: mine });
        const pub = await data.pollResults(msg.pollId);
        broadcast(meetingCode, { type: 'poll-tally', pollId: pub.id, tally: pub.tally, voters: pub.voters }, pid);
      } catch (e) { err(ctx, pid, e.message); }
    });
    ctx.onWs('poll-close', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const poll = await data.closePoll(msg.pollId);
      broadcast(meetingCode, { type: 'poll-update', poll: { ...poll, mine: undefined } });
    });
  },
};

module.exports = pollsPlugin;
