// WebSocket plugin: room messages from the browser. Delete this file if the feature has none.
// ctx (see src/core/plugin-registry.js): onWs, broadcast, sendToParticipant, getMeeting, ...
const { err, limited } = require('../../core/room-helpers');

module.exports = {
  id: 'myFeature',
  register(ctx) {
    const { broadcast } = ctx;
    // Handler args: { msg, participantId, meeting, meetingCode, ws }
    ctx.onWs('my-feature-ping', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;
      if (limited(participantId, 'my-feature-ping', 500)) return err(ctx, participantId, 'Slow down a little');
      broadcast(meetingCode, { type: 'my-feature-pong', name: p.name, text: String(msg.text || '').slice(0, 200) });
    });
  },
};
