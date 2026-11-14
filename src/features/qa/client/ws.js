// qa: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('qa-list', (R, m) => { R.data.questions = m.questions || []; });
onMessage('qa-new', (R, m) => { R.data.questions.push(m.question); if (R.panel.tab !== 'engage') R.unread.engage++; });
onMessage('qa-update', (R, m) => { const i = R.data.questions.findIndex((q) => q.id === m.question.id); if (i >= 0) R.data.questions[i] = { ...m.question, voted: R.data.questions[i].voted }; else R.data.questions.push(m.question); });
onMessage('qa-voted', (R, m) => { const q = R.data.questions.find((x) => x.id === m.id); if (q) q.voted = m.voted; });
