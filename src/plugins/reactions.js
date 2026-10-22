module.exports = {
  id: 'reactions',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onWs('reaction', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;
      const emoji = String(msg.emoji || '').slice(0, 8);
      if (!emoji) return;
      broadcast(meetingCode, {
        type: 'reaction',
        participantId,
        name: p.name,
        emoji,
        at: Date.now(),
      });
    });
  },
};
