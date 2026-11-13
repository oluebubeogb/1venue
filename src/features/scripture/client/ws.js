// scripture: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('scripture-show', (R, m) => {
  const first = !R.scripture; R.scripture = m.scripture; R.scrOwnTr = first ? false : R.scrOwnTr;
  if ((m.scripture.mode || 'side') === 'stage') R.stageView = null;
  // Default: read it in the sidebar (Tools → Scripture), not over the stage.
  else if (first || !(R.panel.tab === 'tools' && R.panel.sub.tools === 'scripture')) { if (first) R.panel.open('tools', 'scripture'); }
  if (R.panel.tab === 'tools' && R.panel.sub.tools === 'scripture') R.panel.refresh('tools');
});
onMessage('scripture-clear', (R, m) => { R.scripture = null; R.scrOwnTr = false; if (R.panel.tab === 'tools' && R.panel.sub.tools === 'scripture') R.panel.refresh('tools'); });
