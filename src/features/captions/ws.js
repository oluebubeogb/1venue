/** Room plugin: captions. Turn off with FEATURE_CAPTIONS=false. */
const data = require('../../venue/data');
const { mod, active, voterKey } = require('../../core/room-helpers');

// ------------------------------------------------------------------ captions
// Clients send recognised text (from server STT via /api/stt, or Web Speech).
// The server stamps the speaker name, stores the segment, and relays captions.
const captionsPlugin = {
  id: 'captions',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onWs('caption', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      if (!text) return;
      const final = msg.final !== false;
      broadcast(meetingCode, { type: 'caption', participantId: pid, name: p.name, text, final, lang: msg.lang || null, at: Date.now() }, final ? undefined : pid);
      if (final && meeting.transcribe !== false) {
        await data.addTranscriptSegment({ historyId: meeting.historyId, code: meetingCode, speakerKey: voterKey(p), speakerName: p.name, text, lang: msg.lang, source: msg.source === 'stt' ? 'stt' : 'webspeech' }).catch(() => {});
      }
    });
    ctx.onWs('transcript-toggle', ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      meeting.transcribe = !!msg.on;
      broadcast(meetingCode, { type: 'transcript-state', on: meeting.transcribe, historyId: meeting.historyId });
    });
    ctx.onRegister((ws, meeting) => {
      try { ws.send(JSON.stringify({ type: 'transcript-state', on: meeting.transcribe !== false, historyId: meeting.historyId })); } catch (_) {}
    });
  },
};

module.exports = captionsPlugin;
