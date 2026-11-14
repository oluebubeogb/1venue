// Room WebSocket message registry. Feature modules (src/features/<id>/client/ws.js, served as
// /features/<id>/ws.js) register handlers here; wsHandlers.js dispatches to them.
//
//   import { onMessage } from '/js/room/registry.js';
//   onMessage('poll-new', (R, m, { roster }) => { R.data.polls.push(m.poll); });   // re-renders
//   onMessage('reaction', (R, m) => { R.stageR.burst(m.emoji); return false; });  // no re-render
const handlers = new Map();

export function onMessage(types, fn) {
  for (const t of [].concat(types)) {
    if (handlers.has(t)) console.warn(`[room] two features handle "${t}"; the later one wins`);
    handlers.set(t, fn);
  }
}

export function getHandler(type) { return handlers.get(type); }
export function messageTypes() { return [...handlers.keys()]; }

export const chime = (f = 660, d = 0.12) => { try { const ac = chime.ac ||= new AudioContext(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.06, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d * 3); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d * 3); } catch { /* */ } };
