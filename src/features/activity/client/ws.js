// activity: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('activity', (R, m) => { R.data.activity.push(m.entry); if (R.data.activity.length > 300) R.data.activity.shift(); if (!(R.panel.tab === 'tools' && R.panel.sub.tools === 'activity')) return false; });
