/** Plugin: in-meeting chat — text, mentions, images (webp), file attachments
 *  Permanent: messages are written to chat_messages and linked to meeting history / artifact.
 */

const db = require('../../db');

const MAX_TEXT = 2000;
const MAX_IMAGE_DATA_CHARS = 900_000;
const MAX_FILE_DATA_CHARS = 7_000_000; // ~5 MB binary as data URL
const MAX_HISTORY = 150;

const { normalizeAttachment } = require('../lib/attachment');

module.exports = {
  id: 'chat',
  register(ctx) {
    const { broadcast } = ctx;

    ctx.onWs('chat', ({ msg, participantId, meeting, meetingCode }) => {
      const p = meeting.participants.get(participantId);
      if (!p) return;

      const text = String(msg.text || '').trim().slice(0, MAX_TEXT);
      const mentions = Array.isArray(msg.mentions)
        ? msg.mentions
            .slice(0, 20)
            .map((m) => ({
              id: String(m.id || '').slice(0, 80),
              name: String(m.name || '').slice(0, 40),
            }))
            .filter((m) => m.id || m.name)
        : [];

      const attachment = normalizeAttachment(msg.attachment);
      if (!text && !attachment) return;

      const chatMsg = {
        type: 'chat',
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        participantId,
        name: p.name,
        text,
        mentions,
        attachment,
        at: Date.now(),
      };

      if (!Array.isArray(meeting.chatHistory)) meeting.chatHistory = [];
      meeting.chatHistory.push(chatMsg);
      if (meeting.chatHistory.length > MAX_HISTORY * 1.3) {
        meeting.chatHistory = meeting.chatHistory.slice(-MAX_HISTORY);
      }
      broadcast(meetingCode, chatMsg);

      // Persist full attachment so files survive refresh/rejoin
      const attachForDb = attachment
        ? {
            kind: attachment.kind,
            name: attachment.name,
            mime: attachment.mime,
            size: attachment.size,
            dataUrl: attachment.dataUrl || null,
            url: attachment.url || null,
          }
        : null;

      Promise.resolve()
        .then(async () => {
          let artifactId = meeting.artifactId || null;
          if (!artifactId && meeting.historyId) {
            try {
              const art = await db.ensureArtifactForHistory(meeting.historyId, meetingCode);
              if (art) {
                meeting.artifactId = art.id;
                artifactId = art.id;
              }
            } catch (_) {}
          }
          await db.saveChatMessage({
            meetingHistoryId: meeting.historyId || null,
            artifactId,
            sessionId: meetingCode,
            senderId: participantId,
            senderName: p.name,
            senderUserId: p.userId || null,
            body: text || null,
            attachments: attachForDb,
            groupId: null,
          });
        })
        .catch((e) => console.warn('[chat] persist', e.message));
    });

    ctx.onRegister((ws, meeting) => {
      if (!meeting || !Array.isArray(meeting.chatHistory) || !meeting.chatHistory.length) return;
      try {
        // Keep full attachment dataUrls so voice/image/file feel the same as text after rejoin
        const messages = meeting.chatHistory.slice(-80);
        ws.send(JSON.stringify({ type: 'chat-history', messages }));
      } catch (_) {}
    });
  },
};
