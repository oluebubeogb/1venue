/**
 * 1venue REST routes: events and discovery, social (feed, follows, comments),
 * prefs, files, STT, transcripts and AI summaries, Bible, QR, whiteboards,
 * dashboard and global search. handleVenueRoutes() returns true once it has
 * answered a request.
 */
const { parseBody, readRaw, sendJSON, sendText, clientIp, rateLimit } = require('../lib/http');
const { getAuthUser, publicUser } = require('../lib/auth');
const { verifyWsCredential } = require('../lib/wsCredential');
const { isModerator } = require('../lib/permissions');
const store = require('../rooms/store');
const config = require('../config');
const data = require('../venue/data');
const stage = require('../venue/stage');

const lazy = (m) => () => require(m);
const ai = lazy('../venue/ai');
const stt = lazy('../venue/stt');
const bible = lazy('../venue/bible');
const qr = lazy('../venue/qr');
const storage = lazy('../venue/storage');

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
async function requireUser(req, res) {
  const u = await getAuthUser(req, res);
  if (!u) throw httpError(401, 'Sign in to continue');
  return { ...u, ...publicUser(u) };
}
/** In-room callers prove membership with the same HMAC credential the WebSocket uses. */
function roomParticipant(req, codeHint) {
  const code = String(req.headers['x-room-code'] || codeHint || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pid = String(req.headers['x-participant-id'] || '');
  const cred = String(req.headers['x-room-credential'] || '');
  if (!code || !pid || !cred) return null;
  if (!verifyWsCredential(cred, { participantId: pid, code }).ok) return null;
  const meeting = store.getMeeting(code);
  const p = meeting && meeting.participants.get(pid);
  if (!p || p.status !== 'ACTIVE') return null;
  return { code, meeting, participant: p };
}
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const attach = (name) => ({ 'Content-Disposition': `attachment; filename="${String(name).replace(/[^\w.\- ]+/g, '_')}"` });

function liveInfo(ev) {
  if (!ev || ev.status !== 'live') return null;
  const m = store.getMeeting(ev.code);
  if (!m) return null;
  let active = 0;
  for (const p of m.participants.values()) if (p.status === 'ACTIVE') active++;
  return { code: ev.code, viewers: active, stage: stage.state(m), requiresKey: !!m.requireInviteKey };
}

async function historyAccess(req, res, historyId) {
  const h = await data.getHistory(historyId);
  if (!h) throw httpError(404, 'Session not found');
  const rp = roomParticipant(req, h.code);
  if (rp && rp.meeting.historyId === historyId) return { h, by: rp.participant.name, userId: rp.participant.userId };
  const u = await getAuthUser(req, res);
  if (u && (await data.canAccessHistory(historyId, u.id))) return { h, by: publicUser(u).displayName, userId: u.id };
  throw httpError(u ? 403 : 401, u ? 'You did not attend this session' : 'Sign in to continue');
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler });

// ------------------------------------------------------------ prefs & profile
route('GET', '/api/prefs', async (ctx) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  return u ? data.getPrefs(u.id) : { ...(await data.getPrefs(0)), anonymous: true };
});
route('PUT', '/api/prefs', async (ctx) => data.setPrefs((await requireUser(ctx.req, ctx.res)).id, await ctx.body()));
route('PATCH', '/api/profile', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  await data.updateProfile(u.id, await ctx.body());
  return data.getUserProfile(u.id, u.id);
});

// ------------------------------------------------------------ events & discovery
route('GET', '/api/categories', async () => ({ categories: data.CATEGORIES, counts: await data.categoryCounts() }));
route('GET', '/api/discover', async (ctx) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  const s = ctx.url.searchParams;
  const events = await data.discover({ q: s.get('q'), category: s.get('category'), status: s.get('status'), tag: s.get('tag'), limit: int(s.get('limit'), 24), offset: int(s.get('offset'), 0), viewerId: u && u.id });
  return { events: events.map((e) => ({ ...e, live: liveInfo(e) })) };
});
route('GET', '/api/events/mine', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  const [hosting, going] = await Promise.all([data.myEvents(u.id), data.rsvpedEvents(u.id)]);
  return { hosting: hosting.map((e) => ({ ...e, live: liveInfo(e) })), going };
});
route('POST', '/api/events', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  const b = await ctx.body();
  const ev = await data.createEvent(u, b);
  if (Array.isArray(b.speakers)) ev.speakers = await data.setSpeakers(ev.id, b.speakers);
  return ev;
});
route('GET', '/api/events/([\\w-]+)', async (ctx, [slug]) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  const ev = await data.getEventBySlug(slug, u && u.id);
  if (!ev || (ev.visibility === 'private' && (!u || u.id !== ev.host.id))) {
    // rooms look up their (optional) event by code: answer quietly instead of 404
    if (new URL(ctx.req.url, 'http://x').searchParams.get('optional') === '1') return null;
    throw httpError(404, 'Event not found');
  }
  return { ...ev, speakers: await data.listSpeakers(ev.id), live: liveInfo(ev), isHost: !!(u && u.id === ev.host.id) };
});
route('PATCH', '/api/events/(\\d+)', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  const b = await ctx.body();
  const ev = await data.updateEvent(int(id), u.id, b);
  if (!ev) throw httpError(404, 'Event not found or not yours');
  if (Array.isArray(b.speakers)) ev.speakers = await data.setSpeakers(ev.id, b.speakers);
  return ev;
});
route('DELETE', '/api/events/(\\d+)', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  if (!(await data.deleteEvent(int(id), u.id))) throw httpError(404, 'Event not found or not yours');
  return { ok: true };
});
route('POST', '/api/events/(\\d+)/rsvp', async (ctx, [id]) => ({ going: await data.toggleRsvp(int(id), (await requireUser(ctx.req, ctx.res)).id) }));
route('PUT', '/api/events/(\\d+)/speakers', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  const ev = await data.getEventById(int(id), u.id);
  if (!ev || ev.host.id !== u.id) throw httpError(403, 'Only the host can edit speakers');
  return { speakers: await data.setSpeakers(ev.id, (await ctx.body()).speakers) };
});
route('GET', '/api/events/([\\w-]+)/qr\\.svg', async (ctx, [slug]) => {
  const ev = await data.getEventBySlug(slug);
  if (!ev || ev.visibility === 'private') throw httpError(404, 'Event not found');
  const s = ctx.url.searchParams;
  const when = ev.status === 'live' ? 'LIVE now' : ev.startsAt ? new Date(ev.startsAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: s.get('tz') || 'Africa/Lagos' }) : '';
  const svg = qr().svg(`${ctx.origin}/e/${ev.slug}`, { accent: ev.theme.accent, accent2: ev.theme.accent2, title: ev.title, category: ev.category, when, subtitle: `by ${ev.host.name}`, seed: ev.slug, dark: s.get('dark') === '1', frame: s.get('frame') !== '0' });
  return { raw: svg, type: 'image/svg+xml; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=300', ...(s.get('download') ? attach(`${ev.slug}-qr.svg`) : {}) } };
});
route('GET', '/api/qr\\.svg', async (ctx) => {
  const s = ctx.url.searchParams;
  const text = String(s.get('text') || '').slice(0, 600);
  if (!text) throw httpError(400, 'text is required');
  const svg = qr().svg(text, { accent: s.get('accent') || undefined, accent2: s.get('accent2') || undefined, title: s.get('title') || '', subtitle: s.get('subtitle') || '', category: s.get('category') || '', when: s.get('when') || '', dark: s.get('dark') === '1', frame: s.get('frame') !== '0' });
  return { raw: svg, type: 'image/svg+xml; charset=utf-8', headers: { 'Cache-Control': 'public, max-age=600' } };
});

// ------------------------------------------------------------ comments (events, posts)
const TARGETS = { events: 'event', posts: 'post' };
route('GET', '/api/(events|posts)/(\\d+)/comments', async (ctx, [kind, id]) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  return { comments: await data.listComments(TARGETS[kind], id, { viewerKey: u ? `u:${u.id}` : '', before: ctx.url.searchParams.get('before') }) };
});
route('POST', '/api/(events|posts)/(\\d+)/comments', async (ctx, [kind, id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  if (!rateLimit(`c:${u.id}`, 20)) throw httpError(429, 'Slow down a little');
  const b = await ctx.body();
  let moderation = null;
  if (ai().status().enabled) {
    moderation = await ai().moderate(b.body).catch(() => null);
    if (moderation && !moderation.allowed) throw httpError(422, `Comment held: ${moderation.reason || 'community guidelines'}`);
  }
  return data.addComment({ targetType: TARGETS[kind], targetKey: id, parentId: b.parentId || null, userId: u.id, authorKey: `u:${u.id}`, authorName: u.displayName, body: b.body, moderation });
});
route('GET', '/api/comments/(\\d+)/replies', async (ctx, [id]) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  const c = await data.getComment(int(id));
  if (!c) throw httpError(404, 'Comment not found');
  return { replies: await data.listComments(c.target_type, c.target_key, { parentId: c.id, viewerKey: u ? `u:${u.id}` : '' }) };
});
route('POST', '/api/comments/(\\d+)/like', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  const r = await data.toggleCommentLike(int(id), `u:${u.id}`);
  return { liked: r.liked, likeCount: r.likeCount };
});
route('DELETE', '/api/comments/(\\d+)', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  const c = await data.getComment(int(id));
  if (!c) throw httpError(404, 'Comment not found');
  let allowed = c.author_key === `u:${u.id}`;
  if (!allowed && c.target_type === 'event') { const ev = await data.getEventById(int(c.target_key)); allowed = ev && ev.host.id === u.id; }
  if (!allowed) throw httpError(403, 'Not allowed');
  await data.hideComment(c.id);
  return { ok: true };
});

// ------------------------------------------------------------ social
route('GET', '/api/feed', async (ctx) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  return { posts: await data.feed(u ? u.id : 0, { before: ctx.url.searchParams.get('before') }) };
});
route('POST', '/api/posts', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  if (!rateLimit(`p:${u.id}`, 10)) throw httpError(429, 'Slow down a little');
  const b = await ctx.body();
  return data.createPost(u.id, { kind: 'post', body: b.body, eventId: b.eventId, media: Array.isArray(b.media) ? b.media.filter((m) => m && /^\/files\/|^https:\/\//.test(m.url)) : [] });
});
route('POST', '/api/posts/(\\d+)/like', async (ctx, [id]) => data.togglePostLike(int(id), (await requireUser(ctx.req, ctx.res)).id));
route('DELETE', '/api/posts/(\\d+)', async (ctx, [id]) => {
  if (!(await data.deletePost(int(id), (await requireUser(ctx.req, ctx.res)).id))) throw httpError(404, 'Post not found');
  return { ok: true };
});
route('GET', '/api/people/suggested', async (ctx) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  return { people: await data.suggestedPeople(u && u.id) };
});
route('GET', '/api/users/search', async (ctx) => ({ users: await data.searchUsers(ctx.url.searchParams.get('q') || '', 10) }));
route('GET', '/api/users/(\\d+)', async (ctx, [id]) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  const p = await data.getUserProfile(int(id), u && u.id);
  if (!p) throw httpError(404, 'User not found');
  const events = (await data.myEvents(p.id)).filter((e) => e.visibility === 'public' && e.status !== 'draft');
  return { ...p, isMe: !!(u && u.id === p.id), events: events.slice(0, 12).map((e) => ({ ...e, live: liveInfo(e) })) };
});
route('GET', '/api/users/(\\d+)/timeline', async (ctx, [id]) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  return { posts: await data.userTimeline(int(id), u && u.id, { before: ctx.url.searchParams.get('before') }) };
});
route('POST', '/api/users/(\\d+)/follow', async (ctx, [id]) => {
  const u = await requireUser(ctx.req, ctx.res);
  const b = await ctx.body();
  return { following: await data.follow(u.id, int(id), b.on !== false) };
});

// ------------------------------------------------------------ dashboard & search
route('GET', '/api/dashboard', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  const [dash, hosting, going, live, history, people, profile] = await Promise.all([
    data.dashboard(u.id), data.myEvents(u.id), data.rsvpedEvents(u.id), data.discover({ status: 'live', limit: 8, viewerId: u.id }),
    require('../../db').getHistoryForUser(u.id).catch(() => []), data.suggestedPeople(u.id, 5), data.getUserProfile(u.id, u.id),
  ]);
  return { ...dash, profile, hosting: hosting.slice(0, 12).map((e) => ({ ...e, live: liveInfo(e) })), going, live: live.map((e) => ({ ...e, live: liveInfo(e) })), history: (history || []).slice(0, 10), people };
});
route('GET', '/api/search', async (ctx) => {
  const qy = String(ctx.url.searchParams.get('q') || '').trim();
  if (qy.length < 2) return { events: [], people: [] };
  const u = await getAuthUser(ctx.req, ctx.res);
  const [events, people] = await Promise.all([data.discover({ q: qy, limit: 6, viewerId: u && u.id }), data.searchUsers(qy, 5)]);
  const ref = bible().parseReference(qy);
  return { events, people, scripture: ref ? { reference: `${ref.bookName} ${ref.chapter}${ref.verses ? ':' + ref.verses[0] + (ref.verses.length > 1 ? '-' + ref.verses[ref.verses.length - 1] : '') : ''}` } : null };
});

// ------------------------------------------------------------ files
route('POST', '/api/files', async (ctx) => {
  const u = await getAuthUser(ctx.req, ctx.res);
  const rp = u ? null : roomParticipant(ctx.req);
  if (!u && !rp) throw httpError(401, 'Sign in or join a room to upload');
  if (!rateLimit(`f:${clientIp(ctx.req)}`, 30)) throw httpError(429, 'Too many uploads');
  const buf = await readRaw(ctx.req, config.STORAGE.maxUploadBytes + 1);
  const filename = decodeURIComponent(String(ctx.req.headers['x-file-name'] || 'upload'));
  const mime = String(ctx.req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  if (/html|javascript|svg/i.test(mime)) throw httpError(415, 'That file type is not allowed');
  const rec = await storage().save(buf, { filename, mime, ownerUserId: u && u.id, ownerKey: rp ? `p:${rp.participant.id}` : null, purpose: ctx.url.searchParams.get('purpose') || 'attachment' });
  return { id: rec.id, url: rec.url, filename: rec.filename, mime: rec.mime, size: rec.size };
});

// ------------------------------------------------------------ speech-to-text
route('POST', '/api/stt', async (ctx) => {
  const rp = roomParticipant(ctx.req, ctx.url.searchParams.get('code'));
  if (!rp) throw httpError(401, 'Join the room to send captions');
  if (!rateLimit(`stt:${rp.participant.id}`, 40)) throw httpError(429, 'Caption rate limit');
  const buf = await readRaw(ctx.req, config.STT.maxChunkBytes);
  const lang = ctx.url.searchParams.get('lang') || 'en';
  const mime = String(ctx.req.headers['content-type'] || 'audio/webm').split(';')[0];
  const out = await stt().transcribe(buf, mime, lang);
  const text = out && out.text;
  if (text) {
    const p = rp.participant;
    store.broadcast(rp.code, { type: 'caption', participantId: p.id, name: p.name, text, final: true, lang, at: Date.now() });
    if (rp.meeting.transcribe !== false) await data.addTranscriptSegment({ historyId: rp.meeting.historyId, code: rp.code, speakerKey: p.userId ? `u:${p.userId}` : `p:${p.id}`, speakerName: p.name, text, lang, source: 'stt' });
  }
  return { text: text || '', provider: out && out.provider };
});

// ------------------------------------------------------------ transcripts & summaries
route('GET', '/api/sessions/(\\d+)', async (ctx, [id]) => {
  const { h } = await historyAccess(ctx.req, ctx.res, int(id));
  const [segments, summaries] = await Promise.all([data.getTranscript(h.id, { limit: 3000 }), data.latestSummaries(h.id)]);
  return { id: h.id, code: h.code, name: h.name, startedAt: h.created_at, endedAt: h.ended_at, segments, summaries };
});
route('GET', '/api/sessions/(\\d+)/transcript\\.txt', async (ctx, [id]) => {
  const { h } = await historyAccess(ctx.req, ctx.res, int(id));
  const text = data.transcriptToText(await data.getTranscript(h.id));
  const head = `${h.name || 'Session'} (${h.code})\n${new Date(h.created_at).toUTCString()}\n\n`;
  return { raw: head + (text || '(no transcript yet)') + '\n', type: 'text/plain; charset=utf-8', headers: attach(`${(h.name || 'transcript').slice(0, 40)}-transcript.txt`) };
});
route('POST', '/api/sessions/(\\d+)/summary', async (ctx, [id]) => {
  const { h, userId } = await historyAccess(ctx.req, ctx.res, int(id));
  if (!rateLimit(`ai:${clientIp(ctx.req)}`, 20)) throw httpError(429, 'AI rate limit, try again in a minute');
  const kind = (await ctx.body()).kind === 'action_items' ? 'action_items' : 'summary';
  const transcript = data.transcriptToText(await data.getTranscript(h.id));
  if (!transcript) throw httpError(400, 'There is no transcript to summarise yet');
  const r = kind === 'summary' ? await ai().summarize(transcript, h.name) : await ai().actionItems(transcript);
  return data.saveSummary({ historyId: h.id, kind, content: r.text, provider: r.provider, model: r.model, userId });
});
route('GET', '/api/sessions/(\\d+)/summary\\.md', async (ctx, [id]) => {
  const { h } = await historyAccess(ctx.req, ctx.res, int(id));
  const sums = await data.latestSummaries(h.id);
  if (!sums.length) throw httpError(404, 'No summary yet');
  const md = `# ${h.name || 'Session'}\n\n_${new Date(h.created_at).toUTCString()} · ${h.code}_\n\n` + sums.map((s) => `## ${s.kind === 'summary' ? 'Summary' : 'Action items'}\n\n${s.content}\n`).join('\n');
  return { raw: md, type: 'text/markdown; charset=utf-8', headers: attach(`${(h.name || 'session').slice(0, 40)}-summary.md`) };
});

// ------------------------------------------------------------ Bible
route('GET', '/api/bible/translations', async () => ({ translations: bible().TRANSLATIONS, default: config.BIBLE.defaultTranslation }));
route('GET', '/api/bible/books', async () => ({ books: bible().BOOKS }));
route('GET', '/api/bible/passage', async (ctx) => {
  if (!rateLimit(`b:${clientIp(ctx.req)}`, 120)) throw httpError(429, 'Too many requests');
  return bible().passage(ctx.url.searchParams.get('ref'), ctx.url.searchParams.get('t'));
});
route('GET', '/api/bible/([\\w]+)/([\\w]{3})/(\\d{1,3})', async (ctx, [t, b, c]) => {
  if (!rateLimit(`b:${clientIp(ctx.req)}`, 120)) throw httpError(429, 'Too many requests');
  return { ...(await bible().chapter(t, b, c)), _cache: true };
});

// ------------------------------------------------------------ AI
async function aiGuard(ctx) {
  if (!require('../lib/features').features.ai) throw httpError(404, 'AI is disabled');
  const u = await getAuthUser(ctx.req, ctx.res);
  const rp = roomParticipant(ctx.req);
  if (!u && !rp) throw httpError(401, 'Sign in or join a room to use AI');
  if (!rateLimit(`ai:${clientIp(ctx.req)}`, 30)) throw httpError(429, 'AI rate limit, try again in a minute');
  return { u, rp };
}
async function roomContext(rp) {
  if (!rp || !rp.meeting.historyId) return '';
  return data.transcriptToText(await data.getTranscript(rp.meeting.historyId, { limit: 1500 }));
}
const aiOut = (r) => ({ text: r.text, provider: r.provider, model: r.model, mock: !!r.mock });
route('POST', '/api/ai/ask', async (ctx) => {
  const { rp } = await aiGuard(ctx);
  const b = await ctx.body();
  if (!b.question) throw httpError(400, 'Ask a question');
  const context = (await roomContext(rp)) || (rp ? `Session: ${rp.meeting.name}` : '');
  return aiOut(await ai().ask(String(b.question).slice(0, 1000), context));
});
route('POST', '/api/ai/catchup', async (ctx) => {
  const { rp } = await aiGuard(ctx);
  if (!rp) throw httpError(400, 'Catch-up works inside a room');
  const segs = rp.meeting.historyId ? await data.getTranscript(rp.meeting.historyId, { limit: 2000 }) : [];
  const minutes = Math.min(60, Math.max(2, int((await ctx.body()).minutes, 10)));
  const since = Date.now() - minutes * 60000;
  const recent = data.transcriptToText(segs.filter((s) => new Date(s.at).getTime() >= since));
  if (!recent) return { text: 'Nothing has been said in that window yet, or captions are off.', provider: 'local', mock: true };
  return aiOut(await ai().catchUp(recent, minutes));
});
route('POST', '/api/ai/translate', async (ctx) => {
  await aiGuard(ctx);
  const b = await ctx.body();
  return aiOut(await ai().translate(String(b.text || ''), String(b.lang || 'English').slice(0, 30)));
});
route('POST', '/api/ai/title', async (ctx) => {
  await aiGuard(ctx);
  const b = await ctx.body();
  const r = await ai().titleDescription(String(b.notes || ''), b.category);
  let out = {};
  try { out = JSON.parse(String(r.text).replace(/^```(json)?|```$/g, '').trim()); } catch (_) { out = { title: String(r.text).split('\n')[0].slice(0, 80), description: String(r.text).slice(0, 400) }; }
  return { title: out.title || '', description: out.description || '', provider: r.provider, mock: !!r.mock };
});
route('POST', '/api/ai/scripture', async (ctx) => {
  await aiGuard(ctx);
  const b = await ctx.body();
  const r = await ai().scripture(String(b.query || '').slice(0, 300), b.translation);
  const refs = String(r.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [ref, why] = l.replace(/^[-*\d.\s]+/, '').split('|').map((x) => (x || '').trim());
    return bible().parseReference(ref) ? { reference: ref, why: why || '' } : null;
  }).filter(Boolean).slice(0, 6);
  return { refs, provider: r.provider, mock: !!r.mock };
});

// ------------------------------------------------------------ personal whiteboards
route('GET', '/api/whiteboards', async (ctx) => ({ boards: await data.listWhiteboards((await requireUser(ctx.req, ctx.res)).id) }));
route('GET', '/api/whiteboards/board', async (ctx) => data.getWhiteboard((await requireUser(ctx.req, ctx.res)).id, ctx.url.searchParams.get('title') || 'My board'));
route('PUT', '/api/whiteboards/board', async (ctx) => {
  const u = await requireUser(ctx.req, ctx.res);
  const b = await ctx.body(2e6);
  return data.saveWhiteboard(u.id, b.title || 'My board', { strokes: Array.isArray(b.strokes) ? b.strokes.slice(-5000) : [], bg: b.bg || null });
});

// ------------------------------------------------------------ live room helpers (REST mirror for slow clients)
route('GET', '/api/rooms/([A-Za-z0-9-]+)/stage', async (ctx, [code]) => {
  const m = store.getMeeting(code.toUpperCase().replace(/-/g, ''));
  if (!m) throw httpError(404, 'Room not live');
  return stage.state(m);
});
route('POST', '/api/rooms/([A-Za-z0-9-]+)/end-summary', async (ctx, [code]) => {
  const rp = roomParticipant(ctx.req, code);
  if (!rp || !isModerator(rp.participant)) throw httpError(403, 'Hosts only');
  return { historyId: rp.meeting.historyId };
});

async function handleVenueRoutes(req, res, parsed) {
  const path = parsed.pathname;
  // File downloads (local disk driver, or S3 proxied when there is no public URL)
  const fm = path.match(/^\/files\/([\w-]{10,40})\/[^/]+$/);
  if (fm && req.method === 'GET') {
    const row = await data.getFile(fm[1]);
    if (!row) { sendJSON(res, 404, { error: 'File not found' }); return true; }
    try {
      const f = await storage().open(row);
      const inline = /^(image|audio|video)\//.test(row.mime) || row.mime === 'application/pdf';
      const headers = {
        'Content-Type': row.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        ...(inline ? {} : attach(row.filename)),
      };
      if (f.stream) { res.writeHead(200, { ...headers, 'Content-Length': f.size }); f.stream.pipe(res); }
      else { res.writeHead(200, headers); res.end(f.buffer); }
    } catch (e) { sendJSON(res, 404, { error: 'File missing from storage' }); }
    return true;
  }
  if (!path.startsWith('/api/')) return false;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const proto = (config.TRUST_PROXY && req.headers['x-forwarded-proto']) || 'http';
    const origin = config.PUBLIC_URL || `${String(proto).split(',')[0]}://${req.headers.host}`;
    const ctx = { req, res, url: parsed, origin, body: (limit) => parseBody(req, limit || 256 * 1024) };
    try {
      const out = await r.handler(ctx, m.slice(1));
      if (out && out.raw !== undefined) sendText(res, 200, out.raw, out.type, out.headers || {});
      else sendJSON(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[venue]', req.method, path, e);
      sendJSON(res, status, { error: status >= 500 && !e.expose ? (e.message || 'Server error') : e.message, ...(e.fallback ? { fallback: e.fallback } : {}) });
    }
    return true;
  }
  return false;
}

module.exports = { handleVenueRoutes, roomParticipant };
