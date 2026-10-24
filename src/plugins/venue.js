/**
 * 1venue room plugins: stage (speaker seats and request-to-speak), polls, Q&A,
 * social comments, synced scripture, live captions and transcripts, and
 * share-to-view personal whiteboards. Each one is a separate plugin, so any of
 * them can be turned off with FEATURE_<ID>=false.
 */
const { resolvePermissions, isModerator } = require('../lib/permissions');
const stage = require('../venue/stage');
const data = require('../venue/data');

const mod = (meeting, pid) => isModerator(meeting.participants.get(pid));
const active = (meeting, pid) => { const p = meeting.participants.get(pid); return p && p.status === 'ACTIVE' ? p : null; };
const voterKey = (p) => (p.userId ? `u:${p.userId}` : `p:${p.id}`);
const err = (ctx, pid, error) => ctx.sendToParticipant(pid, { type: 'error', error });
const throttle = new Map();
function limited(pid, kind, ms) {
  const k = pid + kind, now = Date.now();
  if ((throttle.get(k) || 0) > now - ms) return true;
  throttle.set(k, now);
  if (throttle.size > 5000) throttle.clear();
  return false;
}

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

// ------------------------------------------------------------------ comments
function commentTarget(meeting, code) {
  return meeting.eventId ? { type: 'event', key: String(meeting.eventId) } : { type: 'room', key: `${code}:${meeting.historyId || 0}` };
}
const commentsPlugin = {
  id: 'comments',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onRegister((ws, meeting, pid) => {
      const p = meeting.participants.get(pid);
      const t = commentTarget(meeting, meeting.code || '');
      data.listComments(t.type, t.key, { viewerKey: p ? voterKey(p) : '', limit: 60 })
        .then((comments) => { try { ws.send(JSON.stringify({ type: 'comments', comments })); } catch (_) {} }).catch(() => {});
    });
    ctx.onWs('comment-add', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p || limited(pid, 'comment', 1500)) return;
      const t = commentTarget(meeting, meetingCode);
      let moderation = null;
      const ai = require('../venue/ai');
      if (ai.status().enabled && meeting.settings && meeting.settings.aiModeration !== false) {
        moderation = await ai.moderate(msg.body).catch(() => null);
        if (moderation && !moderation.allowed) return err(ctx, pid, `Comment held: ${moderation.reason || 'community guidelines'}`);
      }
      try {
        const comment = await data.addComment({ targetType: t.type, targetKey: t.key, parentId: msg.parentId || null, userId: p.userId, authorKey: voterKey(p), authorName: p.name, body: msg.body, moderation });
        broadcast(meetingCode, { type: 'comment-new', comment: { ...comment, mine: false } });
      } catch (e) { err(ctx, pid, e.message); }
    });
    ctx.onWs('comment-like', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const r = await data.toggleCommentLike(Number(msg.id), voterKey(p));
      ctx.sendToParticipant(pid, { type: 'comment-liked', id: Number(msg.id), liked: r.liked });
      broadcast(meetingCode, { type: 'comment-likes', id: Number(msg.id), likeCount: r.likeCount });
    });
    ctx.onWs('comment-replies', async ({ msg, participantId: pid, meeting, ws }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const t = commentTarget(meeting, meeting.code || '');
      const replies = await data.listComments(t.type, t.key, { parentId: Number(msg.id), viewerKey: voterKey(p) });
      ws.send(JSON.stringify({ type: 'comment-replies', id: Number(msg.id), replies }));
    });
    ctx.onWs('comment-hide', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const c = await data.getComment(Number(msg.id));
      const p = active(meeting, pid);
      if (!c || !p || !(mod(meeting, pid) || c.author_key === voterKey(p))) return;
      await data.hideComment(c.id);
      broadcast(meetingCode, { type: 'comment-hidden', id: Number(c.id) });
    });
  },
};

// ------------------------------------------------------------------ scripture
const scripturePlugin = {
  id: 'scripture',
  register(ctx) {
    const { broadcast } = ctx;
    ctx.onRegister((ws, meeting) => {
      if (meeting.scripture) try { ws.send(JSON.stringify({ type: 'scripture-show', scripture: meeting.scripture })); } catch (_) {}
    });
    // The host broadcasts a reference; each client renders it in their own translation.
    ctx.onWs('scripture-show', async ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      const st = stage.ensure(meeting);
      if (!(mod(meeting, pid) || st.speakers.has(pid))) return err(ctx, pid, 'Only hosts and speakers can put scripture on screen');
      const bible = require('../venue/bible');
      const ref = bible.parseReference(msg.reference);
      if (!ref) return err(ctx, pid, 'Could not read that reference');
      meeting.scripture = { reference: String(msg.reference).slice(0, 60), parsed: ref, translation: msg.translation || null, by: p.name, at: Date.now() };
      broadcast(meetingCode, { type: 'scripture-show', scripture: meeting.scripture });
    });
    ctx.onWs('scripture-clear', ({ participantId: pid, meeting, meetingCode }) => {
      if (!(mod(meeting, pid) || stage.ensure(meeting).speakers.has(pid))) return;
      meeting.scripture = null;
      broadcast(meetingCode, { type: 'scripture-clear' });
    });
  },
};

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

// ------------------------------------------------------------------ personal whiteboards
// Every user draws on their own board. Sharing lets others view it live (read-only).
const wbSharePlugin = {
  id: 'wbShare',
  register(ctx) {
    const { broadcast } = ctx;
    const list = (meeting) => [...(meeting.sharedBoards || new Map()).values()].map((b) => ({ ownerId: b.ownerId, name: b.name, at: b.at }));
    ctx.onRegister((ws, meeting) => {
      try { ws.send(JSON.stringify({ type: 'pboard-list', boards: list(meeting) })); } catch (_) {}
    });
    ctx.onWs('pboard-share', ({ msg, participantId: pid, meeting, meetingCode }) => {
      const p = active(meeting, pid);
      if (!p) return;
      meeting.sharedBoards = meeting.sharedBoards || new Map();
      if (msg.on === false) meeting.sharedBoards.delete(pid);
      else meeting.sharedBoards.set(pid, { ownerId: pid, name: p.name, at: Date.now(), snapshot: null });
      broadcast(meetingCode, { type: 'pboard-list', boards: list(meeting) });
    });
    // Owner pushes the page on screen as a full frame (throttled client-side), and single strokes as
    // { append:true } deltas in between. We keep the latest frame so late joiners see the board at once.
    const okImg = (u) => typeof u === 'string' && (/^\/files\//.test(u) || (/^data:image\//.test(u) && u.length < 1.5e6));
    ctx.onWs('pboard-frame', ({ msg, participantId: pid, meeting, meetingCode }) => {
      const b = meeting.sharedBoards && meeting.sharedBoards.get(pid);
      if (!b) return;
      const strokes = Array.isArray(msg.strokes) ? msg.strokes.slice(-1500) : [];
      const page = Math.max(0, Math.min(49, Number(msg.page) || 0));
      if (msg.append) {
        if (!b.snapshot || b.snapshot.page !== page || JSON.stringify(strokes).length > 200000) return;
        b.snapshot.strokes.push(...strokes);
        if (b.snapshot.strokes.length > 2000) b.snapshot.strokes = b.snapshot.strokes.slice(-1500);
        b.at = Date.now();
        broadcast(meetingCode, { type: 'pboard-frame', ownerId: pid, append: true, page, strokes }, pid);
        return;
      }
      const frame = {
        page, pages: Math.max(1, Math.min(50, Number(msg.pages) || 1)), bg: ['dots', 'grid', 'lines', 'plain'].includes(msg.bg) ? msg.bg : 'dots', strokes,
        images: (Array.isArray(msg.images) ? msg.images : []).filter((i) => i && okImg(i.url)).slice(0, 40),
        texts: (Array.isArray(msg.texts) ? msg.texts : []).slice(0, 300),
      };
      if (JSON.stringify(frame).length > 3000000) return;
      b.snapshot = frame; b.at = Date.now();
      broadcast(meetingCode, { type: 'pboard-frame', ownerId: pid, ...frame }, pid);
    });
    ctx.onWs('pboard-view', ({ msg, participantId: pid, meeting }) => {
      const b = meeting.sharedBoards && meeting.sharedBoards.get(msg.ownerId);
      ctx.sendToParticipant(pid, { type: 'pboard-frame', ownerId: msg.ownerId, ...((b && b.snapshot) || { page: 0, pages: 1, strokes: [] }), full: true });
    });
  },
};

module.exports = { stagePlugin, pollsPlugin, qaPlugin, commentsPlugin, scripturePlugin, captionsPlugin, wbSharePlugin };
