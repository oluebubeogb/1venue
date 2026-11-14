/** Room plugin: qa. Turn off with FEATURE_QA=false. */
const data = require('../../venue/data');
const { mod, active, voterKey, err, limited } = require('../../core/room-helpers');

// ------------------------------------------------------------------ Q&A
const qaPlugin = {
  id: 'qa',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onRegister((ws, meeting, pid) => {
      const p = meeting.participants.get(pid);
      data.listQuestions(meeting.code || '', meeting.historyId, p ? voterKey(p) : '')
        .then((questions) => { try { ws.send(JSON.stringify({ type: 'qa-list', questions })); } catch (_) {} }).catch(() => {});
    });
    ctx.onWs('qa-ask', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p || limited(pid, 'qa', 4000)) return;
      try {
        const question = await data.addQuestion({ code: meetingCode, historyId: meeting.historyId, authorKey: voterKey(p), authorName: msg.anonymous ? 'Anonymous' : p.name, body: msg.body });
        broadcast(meetingCode, { type: 'qa-new', question });
      } catch (e) { err(ctx, pid, e.message); }
    });
    ctx.onWs('qa-upvote', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const question = await data.upvoteQuestion(msg.id, voterKey(p));
      ctx.sendToParticipant(pid, { type: 'qa-voted', id: question.id, voted: question.voted });
      broadcast(meetingCode, { type: 'qa-update', question: { ...question, voted: undefined } });
    });
    ctx.onWs('qa-status', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      if (!['open', 'live', 'answered', 'dismissed'].includes(msg.status)) return;
      const question = await data.setQuestionStatus(msg.id, msg.status);
      if (question) broadcast(meetingCode, { type: 'qa-update', question });
    });
    ctx.onWs('qa-host-answer', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const question = await data.setQuestionStatus(msg.id, null, null, msg.answer);
      if (question) broadcast(meetingCode, { type: 'qa-update', question });
    });
    ctx.onWs('qa-host-answer', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const p = meeting.participants.get(pid);
      const question = await data.addHostAnswer(msg.id, msg.answer, p ? p.name : 'Host');
      if (question) broadcast(meetingCode, { type: 'qa-update', question });
    });
    ctx.onWs('qa-host-answer-edit', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const question = await data.editHostAnswer(msg.id, msg.answerId, msg.answer);
      if (question) broadcast(meetingCode, { type: 'qa-update', question });
    });
    ctx.onWs('qa-host-answer-delete', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const question = await data.deleteHostAnswer(msg.id, msg.answerId);
      if (question) broadcast(meetingCode, { type: 'qa-update', question });
    });
    ctx.onWs('qa-ai-answer', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      if (!mod(meeting, pid)) return;
      const qs = await data.listQuestions(meetingCode, meeting.historyId);
      const qn = qs.find((x) => x.id === Number(msg.id));
      if (!qn) return;
      const segs = meeting.historyId ? await data.getTranscript(meeting.historyId, { limit: 800 }) : [];
      const r = await require('../venue/ai').ask(qn.body, data.transcriptToText(segs) || meeting.name);
      const question = await data.setQuestionStatus(qn.id, null, r.text);
      broadcast(meetingCode, { type: 'qa-update', question });
    });
  },
};

module.exports = qaPlugin;
