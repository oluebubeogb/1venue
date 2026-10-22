// Incoming WebSocket messages → room state. Kept separate from room.js for readability.
import { h, toast, confirmDlg } from '../ui.js';

const chime = (f = 660, d = 0.12) => { try { const ac = chime.ac ||= new AudioContext(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.06, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d * 3); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d * 3); } catch { /* */ } };
export { chime };

export function handle(R, m) {
  const roster = () => { if (m.participants) R.setPeople(m.participants); if (m.waiting) R.waiting = m.waiting; if (m.raisedHands) R.hands = m.raisedHands; };
  switch (m.type) {
    case 'participants': roster(); if (m.security) R.security = { ...R.security, ...m.security }; if (m.self) { R.me.role = m.self.role; } break;
    case 'participant-joined': { const before = R.peopleMap.size; roster(); if (m.participantId !== R.me.id && R.peopleMap.size > before) { const p = R.p(m.participantId); if (p && R.peopleMap.size < 16) { toast(`${p.name} joined`, { icon: 'userPlus', group: 'people', ms: 2200 }); chime(880, 0.08); } } break; }
    case 'participant-left': case 'participant-removed': roster(); break;
    case 'waiting-request': roster(); if (R.isMod()) { chime(520); const t = toast(`${m.participant.name} is waiting to join`, { icon: 'door', group: 'people', ms: 8000 }); t && t.append && t.append(h('button', { class: 'btn xs primary', onclick: () => R.send('admit-participant', { targetId: m.participant.id }) }, 'Admit')); } break;
    case 'waiting-updated': R.waiting = m.waiting || []; break;
    case 'hand-raised': roster(); if (m.participantId !== R.me.id && R.isMod()) toast(`✋ ${m.name} raised a hand`, { group: 'engage', ms: 2500 }); break;
    case 'hand-lowered': case 'hands-cleared': roster(); if (m.type === 'hands-cleared') R.hands = []; break;
    case 'role-changed': roster(); if (m.participantId === R.me.id) { R.me.role = m.role; toast(`You are now ${m.role === 'cohost' ? 'a co-host' : m.role === 'host' ? 'the host' : 'a participant'}`, { icon: 'shield', group: 'admin' }); } break;
    case 'host-transferred': roster(); if (m.to === R.me.id) { R.me.role = 'host'; toast('You are now the host', { icon: 'crown', group: 'admin' }); } else if (m.from === R.me.id) R.me.role = 'cohost'; break;
    case 'permissions-updated': if (R.meP()) R.meP().permissions = m.permissions; R.applyPerms(); break;
    case 'security-updated': case 'security-state': R.security = { ...R.security, ...(m.security || {}) }; if (m.security?.maxParticipants) R.maxParticipants = m.security.maxParticipants; break;
    case 'meeting-locked': R.security.locked = m.locked; toast(m.locked ? 'Room locked' : 'Room unlocked', { icon: m.locked ? 'lock' : 'unlock', group: 'admin' }); break;
    case 'force-mute': R.media.setMic(false).catch(() => {}); toast(`${m.byName || 'The host'} muted you`, { icon: 'micOff', group: 'media' }); break;
    case 'ask-unmute': confirmDlg(`${m.byName || 'The host'} is asking you to unmute.`, { ok: 'Unmute' }).then((ok) => ok && R.toggleMic(true)); break;
    case 'allow-unmute': toast('You can unmute again', { icon: 'mic', group: 'media' }); break;
    case 'ask-choose-mic': toast(`${m.byName || 'The host'} suggests checking your microphone`, { icon: 'headphones', group: 'media' }); R.deviceSheet(); break;
    case 'force-stop-share': R.media.setShare(false).catch(() => {}); toast('The host stopped your screen share', { icon: 'screenOff', group: 'media' }); break;
    case 'share-started': case 'share-stopped': roster(); break;
    case 'removed': R.kicked(m); return;
    case 'meeting-ended': R.ended(m); return;
    case 'ring-all': case 'ring-participant': if (m.type === 'ring-all' || m.targetId === R.me.id) R.ring(m.fromName); break;
    case 'chat': R.data.chat.push(m); if (R.data.chat.length > 400) R.data.chat.shift(); if (m.participantId !== R.me.id) { if (R.panel.tab !== 'chat') { R.unread.chat++; R.peek(m.name, m.text || '📎 attachment'); } if ((m.mentions || []).some((x) => x.id === R.me.id)) { chime(990); toast(`${m.name} mentioned you`, { icon: 'chat', group: 'social' }); } } break;
    case 'chat-history': R.data.chat = m.messages || []; break;
    case 'private-chat': { const e = m.message; R.data.dms.push(e); const other = e.fromId === R.me.id ? e.toId : e.fromId; R.dmNames[other] = e.fromId === R.me.id ? e.toName : e.fromName; if (e.fromId !== R.me.id) { if (!(R.panel.tab === 'chat' && R.dmWith === e.fromId)) R.peek('🔒 ' + e.fromName, e.text || 'attachment'); else R.dmRead[e.fromId] = R.data.dms.filter((x) => x.fromId === e.fromId).length; } R.recountDm(); break; }
    case 'private-chat-history': R.data.dms = m.messages || []; R.data.dms.forEach((e) => { const other = e.fromId === R.me.id ? e.toId : e.fromId; R.dmNames[other] = e.fromId === R.me.id ? e.toName : e.fromName; if (e.fromId !== R.me.id) R.dmRead[e.fromId] = (R.dmRead[e.fromId] || 0) + 1; }); R.recountDm(); break;
    case 'group-state': { const g = m.group; const old = R.data.groups.get(g.id); R.data.groups.set(g.id, { ...g, messages: old?.messages || [] }); break; }
    case 'group-chat': { const g = R.data.groups.get(m.message.groupId); if (g) { g.messages.push(m.message); if (m.message.fromId !== R.me.id && R.groupOpen !== g.id) R.peek('# ' + g.title, `${m.message.fromName}: ${m.message.text || 'attachment'}`); } break; }
    case 'group-members': { const g = R.data.groups.get(m.groupId); if (g) g.members = m.members; break; }
    case 'group-removed': R.data.groups.delete(m.groupId); if (R.groupOpen === m.groupId) R.groupOpen = null; break;
    case 'group-chat-history': { const g = R.data.groups.get(m.groupId); if (g) g.messages = m.messages || []; break; }
    case 'reaction': R.stageR.burst(m.emoji, m.participantId === R.me.id ? '' : m.name); break;
    case 'content-state': R.content = m.content; R.stageView = null; break;
    case 'content-update': if (R.content && m.content) { const pg = R.content.page; R.content = { ...R.content, ...m.content }; if (m.content.media && R.applyMediaSync) R.applyMediaSync(m.content.media); if (m.content.page !== pg && R.applyPage) R.applyPage(m.content.page); } R.panel.refresh(); return;
    case 'stage-state': { const was = R.isSpeaker(R.me.id); R.stage = { requests: [], speakers: [], ...m.stage }; if (was && !R.isSpeaker(R.me.id)) R.demoted(); break; }
    case 'stage-request': if (R.isMod()) { chime(600); toast(`🎤 ${m.request.name} wants to speak`, { group: 'engage', icon: 'stage' }); } break;
    case 'stage-invited': chime(880); toast('You’re on stage — unmute when you’re ready', { icon: 'stage', group: 'engage', ms: 5000 }); R.promoted(); break;
    case 'stage-removed': R.demoted(); toast('You’re back in the audience', { icon: 'users', group: 'engage' }); break;
    case 'stage-denied': toast('Your request to speak was declined', { icon: 'x' }); break;
    case 'polls': R.data.polls = m.polls || []; break;
    case 'poll-new': R.data.polls.push(m.poll); if (R.panel.tab !== 'engage') { R.unread.engage++; R.peek('📊 New poll', m.poll.question, () => R.panel.open('engage', 'polls')); } break;
    case 'poll-update': { const i = R.data.polls.findIndex((p) => p.id === m.poll.id); if (i >= 0) R.data.polls[i] = { ...R.data.polls[i], ...m.poll }; else R.data.polls.push(m.poll); break; }
    case 'poll-tally': { const p = R.data.polls.find((x) => x.id === m.pollId); if (p) { p.tally = m.tally; p.voters = m.voters; } break; }
    case 'qa-list': R.data.questions = m.questions || []; break;
    case 'qa-new': R.data.questions.push(m.question); if (R.panel.tab !== 'engage') R.unread.engage++; break;
    case 'qa-update': { const i = R.data.questions.findIndex((q) => q.id === m.question.id); if (i >= 0) R.data.questions[i] = { ...m.question, voted: R.data.questions[i].voted }; else R.data.questions.push(m.question); break; }
    case 'qa-voted': { const q = R.data.questions.find((x) => x.id === m.id); if (q) q.voted = m.voted; break; }
    case 'comments': R.data.comments = m.comments || []; break;
    case 'comment-new': if (!R.data.comments.some((c) => c.id === m.comment.id)) R.data.comments.push(m.comment); break;
    case 'comment-liked': { const c = R.data.comments.find((x) => x.id === m.id); if (c) c.liked = m.liked; break; }
    case 'comment-likes': { const c = R.data.comments.find((x) => x.id === m.id); if (c) c.likeCount = m.likeCount; break; }
    case 'comment-hidden': R.data.comments = R.data.comments.filter((c) => c.id !== m.id); break;
    case 'comment-replies': (m.replies || []).forEach((r) => { if (!R.data.comments.some((c) => c.id === r.id)) R.data.comments.push(r); }); break;
    case 'scripture-show': R.scripture = m.scripture; R.stageView = null; break;
    case 'scripture-clear': R.scripture = null; break;
    case 'caption': if (m.final !== false) { R.data.captions.push({ participantId: m.participantId, name: m.name, text: m.text, at: m.at || Date.now() }); if (R.data.captions.length > 2000) R.data.captions.shift(); } R.stageR.caption(m); if (R.panel.tab === 'tools' && R.panel.sub.tools === 'captions') R.panel.refresh(); return;
    case 'transcript-state': R.transcribe = !!m.on; if (m.historyId) R.historyId = m.historyId; break;
    case 'pboard-list': R.boards = m.boards || []; break;
    case 'pboard-frame': { const cur = R.viewStrokes[m.ownerId] || []; const next = m.append ? [...cur, ...(m.strokes || [])] : (m.strokes || []); R.viewStrokes[m.ownerId] = next; if (R.viewingOwner === m.ownerId && R.viewingBoard) R.viewingBoard.strokes = next; return; }
    case 'wb-sync': R.teamStrokes = m.strokes || []; if (R.teamBoard) R.teamBoard.strokes = R.teamStrokes.map((s) => ({ ...s, tool: s.erase ? 'eraser' : 'pen' })); return;
    case 'wb-stroke': (R.teamStrokes ||= []).push(m.stroke); if (R.teamBoard) R.teamBoard.append([{ ...m.stroke, tool: m.stroke.erase ? 'eraser' : 'pen' }]); return;
    case 'wb-clear': R.teamStrokes = []; if (R.teamBoard) R.teamBoard.strokes = []; return;
    case 'breakout-state': R.breakouts = m.breakouts; break;
    case 'breakout-assign': toast(`Moving you to ${m.room.name}…`, { icon: 'split', group: 'people' }); R.joinBreakout(m.room); break;
    case 'breakout-return': toast('Back to the main room', { icon: 'home', group: 'people' }); R.joinBreakout(null); break;
    case 'screen-timeline-state': R.timeline = { items: m.items || [], slideshow: !!m.slideshow, selected: m.selected || 0 }; break;
    case 'screen-timeline-add': R.timeline.items.push(m.item); if (m.selected != null) R.timeline.selected = m.selected; break;
    case 'screen-timeline-remove': R.timeline.items = R.timeline.items.filter((x) => x.id !== m.id); R.timeline.selected = Math.min(R.timeline.selected, Math.max(0, R.timeline.items.length - 1)); break;
    case 'screen-timeline-slideshow': R.timeline.slideshow = !!m.on; break;
    case 'screen-timeline-select': R.timeline.selected = m.index; break;
    case 'recording-state': R.recording = m.recording; break;
    case 'recording-capture':
      if (R.me.role === 'host') {
        if (m.action === 'start') R.recorder.start({ video: true, name: R.code + '-session' }).catch((e) => { toast('Recording cancelled: ' + (e.message || e), { icon: 'alert' }); R.send('stop-recording', {}); });
        else if (m.action === 'pause') R.recorder.pause(); else if (m.action === 'resume') R.recorder.resume(); else if (m.action === 'stop') R.recorder.stop();
      }
      break;
    case 'activity': R.data.activity.push(m.entry); if (R.data.activity.length > 300) R.data.activity.shift(); if (!(R.panel.tab === 'tools' && R.panel.sub.tools === 'activity')) return; break;
    case 'toast': toast(m.message, { icon: 'info' }); return;
    case 'error': toast(m.error || 'Something went wrong', { icon: 'alert' }); return;
    case 'admitted': case 'declined': return; // handled during waiting
    default: return;
  }
  R.changed();
}
