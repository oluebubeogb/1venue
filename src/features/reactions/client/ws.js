// reactions: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('reaction', (R, m) => { R.stageR.burst(m.emoji, m.participantId === R.me.id ? '' : m.name); return false; });
