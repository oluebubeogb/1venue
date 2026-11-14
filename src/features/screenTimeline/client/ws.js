// screenTimeline: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('screen-timeline-state', (R, m) => { R.timeline = { items: m.items || [], slideshow: !!m.slideshow, selected: m.selected || 0 }; });
onMessage('screen-timeline-add', (R, m) => { R.timeline.items.push(m.item); if (m.selected != null) R.timeline.selected = m.selected; });
onMessage('screen-timeline-remove', (R, m) => { R.timeline.items = R.timeline.items.filter((x) => x.id !== m.id); R.timeline.selected = Math.min(R.timeline.selected, Math.max(0, R.timeline.items.length - 1)); });
onMessage('screen-timeline-slideshow', (R, m) => { R.timeline.slideshow = !!m.on; });
onMessage('screen-timeline-select', (R, m) => { R.timeline.selected = m.index; });
