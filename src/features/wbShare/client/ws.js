// wbShare: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('pboard-list', (R, m) => {
  const before = new Set((R.boards || []).map((b) => b.ownerId)); R.boards = m.boards || [];
  for (const b of R.boards) if (!before.has(b.ownerId) && b.ownerId !== R.me?.id) toast(`${b.name} is sharing a board`, { icon: 'board', group: 'content', ms: 9000, action: { label: 'View', run: () => R.viewBoard(b.ownerId) } });
  if (R.stageView && R.stageView.startsWith('pboard:') && !R.boards.some((b) => 'pboard:' + b.ownerId === R.stageView)) { R.stageView = null; R.renderStage(true); toast('They stopped sharing their board', { icon: 'eyeOff', group: 'content' }); }
});
onMessage('pboard-frame', (R, m) => {
  const cur = R.viewFrames[m.ownerId];
  if (m.append && cur && cur.page === m.page) { cur.strokes = [...(cur.strokes || []), ...(m.strokes || [])]; if (R.viewingOwner === m.ownerId && R.viewingBoard) R.viewingBoard.append(m.strokes || []); return false; }
  if (m.append) return false; // missed the base frame; the next full frame catches us up
  R.viewFrames[m.ownerId] = { page: m.page || 0, pages: m.pages || 1, bg: m.bg || 'dots', strokes: m.strokes || [], images: m.images || [], texts: m.texts || [] };
  if (R.viewingOwner === m.ownerId && R.viewingBoard) R.viewingBoard.show(R.viewFrames[m.ownerId]);
  return false;
});
