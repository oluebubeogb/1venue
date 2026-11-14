// Incoming WebSocket messages → room state.
// Core room messages (roster, waiting room, removal, meeting end) are handled here.
// Everything else is handled by feature modules: src/features/<id>/client/ws.js, served as
// /features/<id>/ws.js and loaded through the generated /features/client.js.
import { h, toast } from '../ui.js';
import { getHandler, chime } from './registry.js';
import '/features/client.js';

export { chime };

export function handle(R, m) {
  const roster = () => { if (m.participants) R.setPeople(m.participants); if (m.waiting) R.waiting = m.waiting; if (m.raisedHands) R.hands = m.raisedHands; };
  const feature = getHandler(m.type);
  if (feature) { if (feature(R, m, { roster }) !== false) R.changed(); return; }
  switch (m.type) {
    case 'participants': roster(); if (m.security) R.security = { ...R.security, ...m.security }; if (m.self) { R.me.role = m.self.role; } break;
    case 'participant-joined': { const before = R.peopleMap.size; roster(); if (m.participantId !== R.me.id && R.peopleMap.size > before) { const p = R.p(m.participantId); if (p && R.peopleMap.size < 16) { toast(`${p.name} joined`, { icon: 'userPlus', group: 'people', ms: 2200 }); chime(880, 0.08); } } break; }
    case 'participant-left': case 'participant-removed': roster(); break;
    case 'waiting-request': roster(); if (R.isMod()) { chime(520); const t = toast(`${m.participant.name} is waiting to join`, { icon: 'door', group: 'people', ms: 8000 }); t && t.append && t.append(h('button', { class: 'btn xs primary', onclick: () => R.send('admit-participant', { targetId: m.participant.id }) }, 'Admit')); } break;
    case 'waiting-updated': R.waiting = m.waiting || []; break;
    case 'permissions-updated': if (R.meP()) R.meP().permissions = m.permissions; R.applyPerms(); break;
    case 'force-stop-share': R.media.setShare(false).catch(() => {}); toast('The host stopped your screen share', { icon: 'screenOff', group: 'media' }); break;
    case 'share-started': case 'share-stopped': roster(); break;
    case 'removed': R.kicked(m); return;
    case 'meeting-ended': R.ended(m); return;
    case 'toast': toast(m.message, { icon: 'info' }); return;
    case 'error': toast(m.error || 'Something went wrong', { icon: 'alert' }); return;
    case 'admitted': case 'declined': return; // handled during waiting
    default: return;
  }
  R.changed();
}
