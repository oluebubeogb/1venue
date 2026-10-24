/**
 * Phase 2B — collaborative whiteboard stroke relay
 */
module.exports = {
  id: 'whiteboard',
  register(ctx) {
    const { broadcast, sendToParticipant } = ctx;

    ctx.onWs('wb-stroke', ({ msg, participantId, meeting, meetingCode }) => {
      const actor = meeting.participants.get(participantId);
      if (!actor || actor.status !== 'ACTIVE') return;
      if (!Array.isArray(meeting.wbStrokes)) meeting.wbStrokes = [];
      const stroke = {
        id: msg.id || 's_' + Date.now(),
        from: participantId,
        fromName: actor.name,
        tool: ['pencil', 'pen', 'brush', 'eraser'].includes(msg.tool) ? msg.tool : (msg.erase ? 'eraser' : 'pen'),
        points: (Array.isArray(msg.points) ? msg.points : []).slice(0, 4000),
        color: typeof msg.color === 'string' ? msg.color.slice(0, 32) : 'ink',
        width: Math.max(0.5, Math.min(120, Number(msg.width) || 3)),
        erase: msg.tool === 'eraser' || !!msg.erase,
        at: Date.now(),
      };
      meeting.wbStrokes.push(stroke);
      if (meeting.wbStrokes.length > 2000) meeting.wbStrokes = meeting.wbStrokes.slice(-1500);
      broadcast(meetingCode, { type: 'wb-stroke', stroke }, participantId);
    });

    ctx.onWs('wb-clear', ({ participantId, meeting, meetingCode }) => {
      const actor = meeting.participants.get(participantId);
      if (!actor || (actor.role !== 'host' && actor.role !== 'cohost')) return;
      meeting.wbStrokes = [];
      broadcast(meetingCode, { type: 'wb-clear', by: participantId });
    });

    ctx.onWs('wb-sync', ({ participantId, meeting }) => {
      sendToParticipant(participantId, {
        type: 'wb-sync',
        strokes: meeting.wbStrokes || [],
      });
    });
  },
};
