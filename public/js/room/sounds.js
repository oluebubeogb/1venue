// Room sound effects, synthesized with Web Audio: no audio files, nothing to download.
// Only the sound id crosses the network; every client renders it locally.
export const SOUNDS = [
  { id: 'applause', label: 'Applause', emoji: '👏', keywords: 'clap clapping applaud bravo well done' },
  { id: 'drumroll', label: 'Drum roll', emoji: '🥁', keywords: 'drum roll reveal announce suspense' },
  { id: 'suspense', label: 'Suspense', emoji: '😱', keywords: 'suspense tension dramatic dun' },
  { id: 'laugh', label: 'Laugh', emoji: '😂', keywords: 'laugh haha lol funny joke' },
  { id: 'cheers', label: 'Cheers', emoji: '🙌', keywords: 'cheer cheers crowd yay woo hooray celebrate' },
  { id: 'tada', label: 'Ta-da', emoji: '🎉', keywords: 'tada ta-da fanfare win success celebrate' },
  { id: 'ding', label: 'Ding', emoji: '🔔', keywords: 'ding bell correct right notify' },
  { id: 'boo', label: 'Boo', emoji: '👎', keywords: 'boo booing jeer' },
  { id: 'crickets', label: 'Crickets', emoji: '🦗', keywords: 'crickets silence awkward quiet nobody' },
];
export const soundById = (id) => SOUNDS.find((s) => s.id === id);
export function searchSounds(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  if (/^(sounds?|sfx|effects?|sound effects?)$/.test(q)) return SOUNDS;
  const words = q.replace(/^(play|sound)\s+/, '').split(/\s+/);
  return SOUNDS.filter((s) => words.every((w) => w.length > 1 && (s.label.toLowerCase().includes(w) || s.id.includes(w) || s.keywords.split(' ').some((k) => k.startsWith(w)))));
}
const KEY = 'venue.sounds.muted';
export const soundsMuted = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setSoundsMuted = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {} };

let ac, master, noiseBuf;
function ctx() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.55;
    const comp = ac.createDynamicsCompressor(); master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function gainAt(t, peak, a, dur, out = master) {
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  g.connect(out); return g;
}
function noise(t, dur, { type = 'bandpass', f = 1500, q = 1, peak = 0.5, a = 0.002, out } = {}) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = gainAt(t, peak, a, dur, out); s.connect(fl); fl.connect(g);
  s.start(t, Math.random()); s.stop(t + a + dur + 0.05); return { s, fl, g };
}
function tone(t, freq, dur, { type = 'sine', peak = 0.3, a = 0.01, out, glide } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + a + dur);
  const g = gainAt(t, peak, a, dur, out); o.connect(g); o.start(t); o.stop(t + a + dur + 0.05); return { o, g };
}
const lowpass = (f, q = 0.7, out = master) => { const l = ac.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = f; l.Q.value = q; l.connect(out); return l; };

const SYNTH = {
  applause(t) {
    const len = 2.6;
    for (let i = 0; i < 150; i++) {
      const x = Math.random(); const at = t + x * len;
      const env = Math.min(1, x * 5) * (1 - Math.pow(x, 2.2));
      noise(at, rnd(0.02, 0.05), { f: rnd(900, 2600), q: rnd(0.8, 2), peak: 0.25 * env + 0.02 });
    }
  },
  drumroll(t) {
    let at = t, i = 0;
    while (at < t + 1.9) { const p = (at - t) / 1.9; noise(at, 0.06, { type: 'highpass', f: 1800, peak: 0.08 + 0.3 * p }); tone(at, 190, 0.05, { type: 'triangle', peak: 0.05 + 0.1 * p }); at += 0.055 - 0.015 * p + (i++ % 2 ? 0.004 : 0); }
    noise(t + 1.95, 1.3, { type: 'highpass', f: 5000, peak: 0.45, a: 0.004 });
    tone(t + 1.95, 80, 0.35, { peak: 0.6, glide: 45, a: 0.003 });
  },
  suspense(t) {
    const out = lowpass(700, 1);
    const trem = ac.createGain(); trem.gain.value = 0.5; trem.connect(out);
    const lfo = ac.createOscillator(); lfo.frequency.value = 7; const lg = ac.createGain(); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(trem.gain); lfo.start(t); lfo.stop(t + 3.2);
    [110, 116.5, 164.8].forEach((f) => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 2.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.1); o.connect(g); g.connect(trem); o.start(t); o.stop(t + 3.2); });
    tone(t + 2.5, 55, 0.6, { type: 'triangle', peak: 0.7, a: 0.004, glide: 40 });
    noise(t + 2.5, 0.5, { type: 'lowpass', f: 400, peak: 0.4 });
  },
  laugh(t) {
    const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 3;
    const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1250; f2.Q.value = 4;
    f1.connect(master); f2.connect(master);
    const bus = ac.createGain(); bus.gain.value = 1.2; bus.connect(f1); bus.connect(f2);
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.19 + (i > 3 ? (i - 3) * 0.03 : 0), p = 290 - i * 14;
      tone(at, p, 0.11, { type: 'sawtooth', peak: 0.5 - i * 0.04, a: 0.02, glide: p * 0.85, out: bus });
      noise(at, 0.06, { f: 2200, q: 0.8, peak: 0.05, a: 0.01 });
    }
  },
  cheers(t) {
    const len = 2.6;
    const c = noise(t, len, { f: 900, q: 0.6, peak: 0.35, a: 0.5 });
    c.fl.frequency.linearRampToValueAtTime(1500, t + 1.2); c.fl.frequency.linearRampToValueAtTime(1000, t + len);
    for (let i = 0; i < 4; i++) { const at = t + rnd(0.2, 1.4); tone(at, rnd(900, 1200), rnd(0.35, 0.6), { type: 'sine', peak: 0.06, a: 0.06, glide: rnd(1600, 2200) }); }
    for (let i = 0; i < 40; i++) noise(t + rnd(0.2, 2.2), 0.03, { f: rnd(1200, 2600), q: 1.5, peak: 0.12 });
  },
  tada(t) {
    const out = lowpass(2600, 0.8);
    const chord = (at, notes, dur, peak) => notes.forEach((f) => { tone(at, f, dur, { type: 'sawtooth', peak, a: 0.015, out }); tone(at, f * 1.004, dur, { type: 'square', peak: peak * 0.4, a: 0.015, out }); });
    chord(t, [523.25, 659.25, 783.99], 0.12, 0.09);
    chord(t + 0.17, [523.25, 659.25, 783.99, 1046.5], 1.1, 0.1);
    noise(t + 0.17, 0.8, { type: 'highpass', f: 6000, peak: 0.12 });
  },
  ding(t) {
    tone(t, 1318.5, 1.4, { peak: 0.35, a: 0.003 });
    tone(t, 2637, 0.8, { peak: 0.1, a: 0.003 });
    tone(t, 3951, 0.4, { peak: 0.04, a: 0.003 });
  },
  boo(t) {
    const out = lowpass(520, 2);
    for (let i = 0; i < 6; i++) {
      const f = rnd(105, 165), at = t + rnd(0, 0.25);
      const v = tone(at, f, 1.4, { type: 'sawtooth', peak: 0.12, a: 0.35, out, glide: f * 0.82 });
      const vib = ac.createOscillator(); vib.frequency.value = rnd(4, 6); const vg = ac.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(v.o.frequency); vib.start(at); vib.stop(at + 1.8);
    }
  },
  crickets(t) {
    for (let c = 0; c < 2; c++) {
      const f = c ? 4400 : 4750, off = c * 0.27;
      for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) tone(t + off + k * 0.5 + j * 0.045, f, 0.025, { peak: 0.06, a: 0.004 });
    }
  },
};

/** Play a sound locally. Returns false when muted/unknown. */
export function playSound(id, { force = false } = {}) {
  if ((!force && soundsMuted()) || !SYNTH[id]) return false;
  try { const c = ctx(); SYNTH[id](c.currentTime + 0.03); return true; } catch { return false; }
}
