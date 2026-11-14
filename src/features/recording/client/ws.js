// recording: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';
import { toast } from '/js/ui.js';

onMessage('recording-state', (R, m) => { R.recording = m.recording; });
onMessage('recording-capture', (R, m) => {
  if (R.me.role === 'host') {
    if (m.action === 'start') R.recorder.start({ video: true, name: R.code + '-session' }).catch((e) => { toast('Recording cancelled: ' + (e.message || e), { icon: 'alert' }); R.send('stop-recording', {}); });
    else if (m.action === 'pause') R.recorder.pause(); else if (m.action === 'resume') R.recorder.resume(); else if (m.action === 'stop') R.recorder.stop();
  }
});
