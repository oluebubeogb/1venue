// privateChat: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('private-chat', (R, m) => { const e = m.message; R.data.dms.push(e); const other = e.fromId === R.me.id ? e.toId : e.fromId; R.dmNames[other] = e.fromId === R.me.id ? e.toName : e.fromName; if (e.fromId !== R.me.id) { if (!(R.panel.tab === 'chat' && R.dmWith === e.fromId)) R.peek('🔒 ' + e.fromName, e.text || 'attachment'); else R.dmRead[e.fromId] = R.data.dms.filter((x) => x.fromId === e.fromId).length; } R.recountDm(); });
onMessage('private-chat-history', (R, m) => { R.data.dms = m.messages || []; R.data.dms.forEach((e) => { const other = e.fromId === R.me.id ? e.toId : e.fromId; R.dmNames[other] = e.fromId === R.me.id ? e.toName : e.fromName; if (e.fromId !== R.me.id) R.dmRead[e.fromId] = (R.dmRead[e.fromId] || 0) + 1; }); R.recountDm(); });
