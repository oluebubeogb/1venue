// polls: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('polls', (R, m) => { R.data.polls = m.polls || []; });
onMessage('poll-new', (R, m) => { R.data.polls.push(m.poll); if (R.panel.tab !== 'engage') { R.unread.engage++; R.peek('📊 New poll', m.poll.question, () => R.panel.open('engage', 'polls')); } });
onMessage('poll-update', (R, m) => { const i = R.data.polls.findIndex((p) => p.id === m.poll.id); if (i >= 0) R.data.polls[i] = { ...R.data.polls[i], ...m.poll }; else R.data.polls.push(m.poll); });
onMessage('poll-tally', (R, m) => { const p = R.data.polls.find((x) => x.id === m.pollId); if (p) { p.tally = m.tally; p.voters = m.voters; } });
