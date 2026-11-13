// chat: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage, chime } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('chat', (R, m) => { R.data.chat.push(m); if (R.data.chat.length > 400) R.data.chat.shift(); if (m.participantId !== R.me.id) { if (R.panel.tab !== 'chat') { R.unread.chat++; R.peek(m.name, m.text || (m.attachment?.kind === 'passage' ? '📖 ' + m.attachment.reference : '📎 attachment')); } if ((m.mentions || []).some((x) => x.id === R.me.id)) { chime(990); toast(`${m.name} mentioned you`, { icon: 'chat', group: 'social' }); } } });
onMessage('chat-history', (R, m) => { R.data.chat = m.messages || []; });
