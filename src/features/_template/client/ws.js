// Browser side: room WebSocket messages for this feature. Served as /features/<id>/ws.js.
// Return false to skip re-rendering the room; anything else re-renders it.
import { onMessage } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('my-feature-pong', (R, m) => {
  toast(`${m.name}: ${m.text}`, { icon: "info" });
  return false;
});
