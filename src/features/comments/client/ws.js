// comments: room WebSocket messages handled in the browser.
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';

onMessage('comments', (R, m) => { R.data.comments = m.comments || []; });
onMessage('comment-new', (R, m) => { if (!R.data.comments.some((c) => c.id === m.comment.id)) { R.data.comments.push(m.comment); R.unread.comments++; } });
onMessage('comment-liked', (R, m) => { const c = R.data.comments.find((x) => x.id === m.id); if (c) c.liked = m.liked; });
onMessage('comment-likes', (R, m) => { const c = R.data.comments.find((x) => x.id === m.id); if (c) c.likeCount = m.likeCount; });
onMessage('comment-hidden', (R, m) => { R.data.comments = R.data.comments.filter((c) => c.id !== m.id); });
onMessage('comment-replies', (R, m) => { (m.replies || []).forEach((r) => { if (!R.data.comments.some((c) => c.id === r.id)) R.data.comments.push(r); }); });
