/**
 * Mute self only — host/cohost force-mute lives in moderation plugin.
 */
module.exports = {
  id: 'mute',
  register(ctx) {
    const { broadcast, getParticipantsList } = ctx;

    ctx.onWs('unmute-self', ({ participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (p) p.mutedByHost = false;
      broadcast(meetingCode, {
        type: 'participants',
        participants: getParticipantsList(meeting),
      });
    });
  },
};
