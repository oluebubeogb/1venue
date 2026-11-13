// content: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('content-state', (R, m) => { R.content = m.content; R.stageView = null; });
onMessage('content-update', (R, m) => { if (R.content && m.content) { const pg = R.content.page; const pagesChanged = Array.isArray(m.content.pages); R.content = { ...R.content, ...m.content }; if (m.content.media && R.applyMediaSync) R.applyMediaSync(m.content.media); if (pagesChanged) R.renderStage(true); else if (m.content.page !== pg && R.applyPage) R.applyPage(m.content.page); } R.applySlideshow && R.applySlideshow(!!R.content?.slideshow); R.panel.refresh(); return false; });
