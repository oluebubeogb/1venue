// captions: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('caption', (R, m) => { if (m.final !== false) { R.data.captions.push({ participantId: m.participantId, name: m.name, text: m.text, at: m.at || Date.now() }); if (R.data.captions.length > 2000) R.data.captions.shift(); } R.stageR.caption(m); if (R.panel.tab === 'tools' && R.panel.sub.tools === 'captions') R.panel.refresh(); return false; });
onMessage('transcript-state', (R, m) => { R.transcribe = !!m.on; if (m.historyId) R.historyId = m.historyId; R.captioner && R.captioner.autoSync(); });
