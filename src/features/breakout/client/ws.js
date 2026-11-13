// breakout: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('breakout-state', (R, m) => { R.breakouts = m.breakouts; });
onMessage('breakout-assign', (R, m) => { toast(`Moving you to ${m.room.name}…`, { icon: 'split', group: 'people' }); R.joinBreakout(m.room); });
onMessage('breakout-return', (R, m) => { toast('Back to the main room', { icon: 'home', group: 'people' }); R.joinBreakout(null); });
