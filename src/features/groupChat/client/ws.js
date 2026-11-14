// groupChat: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('group-state', (R, m) => { const g = m.group; const old = R.data.groups.get(g.id); R.data.groups.set(g.id, { ...g, messages: old?.messages || [] }); });
onMessage('group-chat', (R, m) => { const g = R.data.groups.get(m.message.groupId); if (g) { g.messages.push(m.message); if (m.message.fromId !== R.me.id && R.groupOpen !== g.id) R.peek('# ' + g.title, `${m.message.fromName}: ${m.message.text || 'attachment'}`); } });
onMessage('group-members', (R, m) => { const g = R.data.groups.get(m.groupId); if (g) g.members = m.members; });
onMessage('group-removed', (R, m) => { R.data.groups.delete(m.groupId); if (R.groupOpen === m.groupId) R.groupOpen = null; });
onMessage('group-chat-history', (R, m) => { const g = R.data.groups.get(m.groupId); if (g) g.messages = m.messages || []; });
