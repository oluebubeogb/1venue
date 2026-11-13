// moderation: room WebSocket messages handled in the browser (moved from public/js/room/wsHandlers.js).
// Return false to skip the re-render; anything else re-renders the room (R.changed()).
import { onMessage } from '/js/room/registry.js';
import { toast, confirmDlg } from '/js/ui.js';

onMessage('hand-raised', (R, m, { roster }) => { roster(); if (m.participantId !== R.me.id && R.isMod()) toast(`✋ ${m.name} raised a hand`, { group: 'engage', ms: 2500 }); });
onMessage(['hand-lowered', 'hands-cleared'], (R, m, { roster }) => { roster(); if (m.type === 'hands-cleared') R.hands = []; });
onMessage('role-changed', (R, m, { roster }) => { roster(); if (m.participantId === R.me.id) { R.me.role = m.role; toast(`You are now ${m.role === 'cohost' ? 'a co-host' : m.role === 'host' ? 'the host' : 'a participant'}`, { icon: 'shield', group: 'admin' }); } });
onMessage('host-transferred', (R, m, { roster }) => { roster(); if (m.to === R.me.id) { R.me.role = 'host'; toast('You are now the host', { icon: 'crown', group: 'admin' }); } else if (m.from === R.me.id) R.me.role = 'cohost'; });
onMessage(['security-updated', 'security-state'], (R, m) => { R.security = { ...R.security, ...(m.security || {}) }; if (m.security?.maxParticipants) R.maxParticipants = m.security.maxParticipants; });
onMessage('meeting-locked', (R, m) => { R.security.locked = m.locked; toast(m.locked ? 'Room locked' : 'Room unlocked', { icon: m.locked ? 'lock' : 'unlock', group: 'admin' }); });
onMessage('force-mute', (R, m) => { R.media.setMic(false).catch(() => {}); toast(`${m.byName || 'The host'} muted you`, { icon: 'micOff', group: 'media' }); });
onMessage('ask-unmute', (R, m) => { confirmDlg(`${m.byName || 'The host'} is asking you to unmute.`, { ok: 'Unmute' }).then((ok) => ok && R.toggleMic(true)); });
onMessage('allow-unmute', (R, m) => { toast('You can unmute again', { icon: 'mic', group: 'media' }); });
onMessage('ask-choose-mic', (R, m) => { toast(`${m.byName || 'The host'} suggests checking your microphone`, { icon: 'headphones', group: 'media' }); R.deviceSheet(); });
onMessage(['ring-all', 'ring-participant'], (R, m) => { if (m.type === 'ring-all' || m.targetId === R.me.id) R.ring(m.fromName); });
onMessage('force-layout', (R, m) => {
  if (m.layout && R.security?.forceLayout && !R.isMod()) {
    R.setLayout(m.layout, { fromHost: true });
    if (m.pick != null && R.stageR?.setPick) R.stageR.setPick(m.pick);
  }
});
onMessage('permission-request', (R, m) => { if (R.isMod()) { toast(`${m.fromName} wants to ${m.detail}`, { icon: 'alert', action: { label: 'Grant', run: () => R.send('grant-permission', { targetId: m.fromId, action: m.action }) } }); } return false; });
