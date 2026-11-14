module.exports = {
  id: 'deviceIcons',
  register(ctx) {
    const { broadcast, getParticipantsList } = ctx;
    ctx.onWs('device', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;
      p.device = ['mobile', 'tablet', 'desktop'].includes(msg.device) ? msg.device : 'desktop';
      broadcast(meetingCode, {
        type: 'participants',
        participants: getParticipantsList(meeting),
      });
    });
  },
};
