// sounds: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';
import { toast } from '/js/ui.js';
import { playSound, soundById } from '/js/room/sounds.js';

onMessage('sound', (R, m) => { const sd = soundById(m.id); if (!sd) return false; playSound(m.id); R.stageR.burst(sd.emoji, m.participantId === R.me.id ? '' : `${m.name} · ${sd.label}`); return false; });
onMessage('sound-denied', (R, m) => { toast(m.error || 'Sound not sent', { icon: 'volumeX', group: 'engage', ms: 2500 }); return false; });
