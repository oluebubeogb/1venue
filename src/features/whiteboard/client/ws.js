// whiteboard: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('wb-sync', (R, m) => { R.teamStrokes = m.strokes || []; if (R.teamBoard) R.teamBoard.strokes = R.teamStrokes; return false; });
onMessage('wb-stroke', (R, m) => { (R.teamStrokes ||= []).push(m.stroke); if (R.teamBoard) R.teamBoard.append([m.stroke]); return false; });
onMessage('wb-clear', (R, m) => { R.teamStrokes = []; if (R.teamBoard) R.teamBoard.strokes = []; return false; });
