'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-sqlite-features-'));
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = path.join(dir, 'venue.sqlite');
const db = require('../db');
const data = require('../src/venue/data');
let user, event, venue, historyId;
test.before(async () => {
  user = await db.createUser({ username: 'host', email: 'host@example.test', passwordHash: 'hash' });
  historyId = await db.startMeetingHistory({ code: 'abc123', name: 'Test room', hostUserId: user.id, hostDisplayName: 'Host' });
});
test.after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('preferences and profile round trip as objects and booleans', async () => {
  const prefs = await data.setPrefs(user.id, { theme: 'dark', reduceMotion: true, extra: { compact: true } });
  assert.equal(prefs.reduceMotion, true);
  assert.deepEqual((await data.getPrefs(user.id)).extra, { compact: true });
  await data.updateProfile(user.id, { displayName: 'Ada', bio: 'Host', handle: 'ada', avatarUrl: null });
  assert.equal((await data.getUserProfile(user.id, user.id)).handle, 'ada');
});

test('event discovery, RSVP, speakers, and materials work locally', async () => {
  event = await data.createEvent({ id: user.id, username: 'host', displayName: 'Ada' }, { title: 'SQLite Seminar', category: 'seminar', tags: ['engineering'] });
  assert.equal(event.title, 'SQLite Seminar');
  assert.equal((await data.discover({ q: 'SQLite' }))[0].id, event.id);
  assert.equal((await data.discover({ tag: 'engineering' }))[0].id, event.id);
  assert.equal(await data.toggleRsvp(event.id, user.id), true);
  await data.setSpeakers(event.id, [{ name: 'Ada', email: 'host@example.test' }]);
  assert.equal((await data.listSpeakers(event.id))[0].email, 'host@example.test');
  const material = await data.createMaterial(user.id, { title: 'Slides', kind: 'slides', payload: { pages: ['/files/abc/a.png'] } });
  assert.equal((await data.setEventMaterials(event.id, user.id, [material.id])).length, 1);
});

test('venue, social feed, polls, Q&A, and transcript data work locally', async () => {
  venue = await data.createVenue(user.id, 'My Venue');
  assert.equal((await data.getVenueByCode(venue.code)).id, venue.id);
  await data.markVenueOpen(venue.code, historyId);
  assert.ok((await data.getVenueBySlug(venue.slug)).openedAt);
  const post = await data.createPost(user.id, { body: 'Welcome' });
  assert.equal((await data.feed(user.id)).length > 0, true);
  const poll = await data.createPoll({ code: 'abc123', historyId, question: 'Ready?', options: ['Yes', 'No'], createdBy: 'host' });
  assert.equal((await data.votePoll(poll.id, 'voter', [0])).tally[0], 1);
  const question = await data.addQuestion({ code: 'abc123', historyId, authorKey: 'guest', authorName: 'Guest', body: 'Why?' });
  await data.addHostAnswer(question.id, 'Because', 'Ada');
  assert.equal((await data.listQuestions('abc123', historyId, 'guest'))[0].hostAnswers.length, 1);
  await data.addTranscriptSegment({ historyId, code: 'abc123', speakerName: 'Ada', text: 'Hello', source: 'manual' });
  assert.equal((await data.getTranscript(historyId))[0].text, 'Hello');
});

test('dashboard, scripture cache, and whiteboard listing work locally', async () => {
  assert.equal(typeof (await data.dashboard(user.id)).stats.hosted, 'number');
  await data.bibleCachePut('eng_kjv', 'JHN', 3, { verses: ['hello'] });
  assert.deepEqual(await data.bibleCacheGet('eng_kjv', 'JHN', 3, 30), { verses: ['hello'] });
  await data.createWhiteboard(user.id, 'Notes', { pages: [{ strokes: [] }] });
  assert.equal((await data.listWhiteboards(user.id))[0].pages, 1);
});

test('meeting records, attendance, chat, direct messages, and groups persist locally', async () => {
  await db.logParticipantJoin({ meetingHistoryId: historyId, userId: user.id, displayName: 'Ada', participantId: 'p1' });
  await db.updateMaxParticipants(historyId, 3);
  const share = await db.createAttendanceShare(historyId, user.id);
  assert.equal((await db.getAttendanceShareByToken(share.token)).is_public, true);
  const artifact = await db.createArtifact({ meetingHistoryId: historyId, shortCode: 'abc123' });
  await db.saveChatMessage({ meetingHistoryId: historyId, artifactId: artifact.id, senderId: 'p1', senderName: 'Ada', body: 'Hello', attachments: [{ name: 'a' }] });
  assert.equal((await db.getChatForHistory(historyId))[0].attachments[0].name, 'a');
  const other = await db.createUser({ username: 'guest', email: 'guest@example.test', passwordHash: 'hash' });
  const thread = await db.findOrCreateDmThread(user.id, other.id);
  await db.saveDmMessage({ threadId: thread.id, senderUserId: user.id, senderName: 'Ada', body: 'Private' });
  assert.equal((await db.getDmMessages(thread.id))[0].body, 'Private');
  await db.createChatGroup({ id: 'group1', meetingCode: 'abc123', meetingHistoryId: historyId, title: 'Team' });
  await db.addChatGroupMember({ groupId: 'group1', participantId: 'p1', userId: user.id, displayName: 'Ada' });
  assert.equal((await db.listChatGroupMembers('group1')).length, 1);
  await db.endMeetingHistory(historyId);
  assert.ok((await db.getMeetingHistoryById(historyId)).ended_at);
});

test('comments, Q&A answer edits, summaries, and venue admins work locally', async () => {
  const comment = await data.addComment({ targetType: 'event', targetKey: event.id, userId: user.id, authorKey: `user:${user.id}`, authorName: 'Ada', body: 'First' });
  assert.equal((await data.listComments('event', event.id))[0].id, comment.id);
  assert.equal((await data.toggleCommentLike(comment.id, `user:${user.id}`)).liked, true);
  const question = await data.addQuestion({ code: 'abc123', historyId, authorKey: 'guest2', authorName: 'Guest 2', body: 'How?' });
  const answer = (await data.addHostAnswer(question.id, 'Initial', 'Ada')).hostAnswers[0];
  assert.equal((await data.editHostAnswer(question.id, answer.id, 'Edited')).hostAnswers[0].text, 'Edited');
  assert.equal((await data.deleteHostAnswer(question.id, answer.id)).hostAnswers.length, 0);
  await data.saveSummary({ historyId, content: 'Summary one', provider: 'local', userId: user.id });
  await data.saveSummary({ historyId, content: 'Summary two', provider: 'local', userId: user.id });
  assert.equal((await data.latestSummaries(historyId))[0].content, 'Summary two');
  const result = await data.addVenueAdmins(venue.id, user.id, 'guest');
  assert.equal(result.added.length, 1);
  assert.equal((await data.listVenueAdmins(venue.id)).length, 1);
});

test('event search follows edits and handles punctuation-only input', async () => {
  await data.updateEvent(event.id, user.id, { title: 'Updated Workshop' });
  assert.equal((await data.discover({ q: 'Updated' }))[0].id, event.id);
  assert.equal((await data.discover({ q: 'SQLite' })).some((e) => e.id === event.id), false);
  assert.ok(Array.isArray(await data.discover({ q: '!!!' })));
});

test('schedules, membership, recordings, uploads, and notes persist locally', async () => {
  const scheduled = await db.createScheduledMeeting({ code: 'xyz789', name: 'Later', hostUserId: user.id, hostDisplayName: 'Ada', scheduledStart: new Date('2026-12-01T12:00:00.000Z') });
  assert.equal((await db.getScheduledByCode('xyz789')).id, scheduled.id);
  assert.equal((await db.updateScheduledStatus(scheduled.id, 'live')).status, 'live');
  const member = await db.upsertMembership({ code: 'abc123', userId: user.id, participantId: 'p1', displayName: 'Ada', role: 'host', status: 'ACTIVE' });
  assert.equal((await db.getMembership('abc123', { userId: user.id })).id, member.id);
  const recording = await db.startRecording({ meetingHistoryId: historyId, code: 'abc123', startedByUserId: user.id, startedByName: 'Ada', options: { audio: true } });
  assert.equal((await db.stopRecording(recording.id)).status, 'stopped');
  const artifact = await db.ensureArtifactForHistory(historyId, 'abc123');
  await db.upsertPersonalNote({ artifactId: artifact.id, userId: user.id, content: 'Remember' });
  assert.equal((await db.getPersonalNote(artifact.id, user.id)).content, 'Remember');
  await data.insertFile({ id: 'file-local-1', ownerUserId: user.id, driver: 'local', objectKey: 'x', filename: 'x.txt', mime: 'text/plain', size: 12, purpose: 'attachment' });
  assert.equal(await data.fileUsage({ userId: user.id }), 12);
});
