// stage: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage, chime } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('stage-state', (R, m) => { const was = R.isSpeaker(R.me.id); R.stage = { requests: [], speakers: [], ...m.stage }; if (was && !R.isSpeaker(R.me.id)) R.demoted(); });
onMessage('stage-request', (R, m) => { if (R.isMod()) { chime(600); toast(`🎤 ${m.request.name} wants to speak`, { group: 'engage', icon: 'stage' }); } });
onMessage('stage-invited', (R, m) => { chime(880); toast('You’re on stage — unmute when you’re ready', { icon: 'stage', group: 'engage', ms: 5000 }); R.promoted(); });
onMessage('stage-removed', (R, m) => { R.demoted(); toast('You’re back in the audience', { icon: 'users', group: 'engage' }); });
onMessage('stage-denied', (R, m) => { toast('Your request to speak was declined', { icon: 'x' }); });
