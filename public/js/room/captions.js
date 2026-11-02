// Live captions. Primary: server STT (N-ATLaS / Whisper) via short self-contained audio chunks.
// Fallback: the browser's Web Speech API. Every final line is stored server-side as "Name: text".
import { toast } from '../ui.js';

const WS_LANG = { en: 'en-NG', yo: 'yo-NG', ig: 'ig-NG', ha: 'ha-NG', pcm: 'en-NG', fr: 'fr-FR' };
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Captioner {
  constructor(R) { this.R = R; this.on = false; this.mode = null; this.rec = null; this.sr = null; this.timer = null; this.failures = 0; }
  get lang() { return this.R.captionLang(); }
  // Per-user opt-out from auto captions (when the host saves a transcript).
  get optOut() { try { return localStorage.getItem('venue.captionOptOut') === '1'; } catch { return false; } }
  set optOut(v) { try { localStorage.setItem('venue.captionOptOut', v ? '1' : '0'); } catch { /* */ } }
  // Always-on pipeline: runs whenever the room transcribes, independent of any panel being open.
  autoSync() {
    const R = this.R; const cfg = R.config.stt || {};
    const supported = !!((cfg.server && window.MediaRecorder) || SpeechRec);
    const want = !!R.transcribe && !this.optOut && supported && R.isSpeaker(R.me.id) && !!R.media;
    if (want && !this.on) { this.auto = true; this.start().catch(() => {}); }
    else if (!R.transcribe && this.on && this.auto) this.stop();
  }
  // User toggled "caption me": manual start clears the opt-out, manual stop during a saved transcript sets it.
  setMine(on) { if (on) { this.optOut = false; this.auto = false; return this.start(); } if (this.R.transcribe) this.optOut = true; this.stop(); return Promise.resolve(); }
  // Mic toggled: pause instead of tearing down (STT loop already idles while muted).
  onMic(on) {
    if (!this.on || this.mode !== 'webspeech' || !this.sr) return;
    try { on ? this.sr.start() : this.sr.stop(); } catch { /* already in that state */ }
  }
  async start() {
    if (this.on) return;
    this.on = true;
    const cfg = this.R.config.stt || {};
    if (cfg.server && window.MediaRecorder) { this.mode = 'stt'; this.loopStt(); }
    else if (SpeechRec) this.startWebSpeech();
    else { this.on = false; toast('Captions need a speech service or a browser with speech recognition (Chrome / Edge)', { icon: 'alert' }); return; }
    this.R.onCaptionMode && this.R.onCaptionMode(this.mode);
  }
  stop() {
    this.on = false; clearTimeout(this.timer);
    try { this.rec && this.rec.state !== 'inactive' && this.rec.stop(); } catch { /* */ }
    try { this.sr && this.sr.stop(); } catch { /* */ }
    this.rec = null; this.sr = null; this.mode = null; this.auto = false;
    if (this.srcNode) { try { this.srcNode.disconnect(); } catch { /* */ } this.srcNode = null; this.srcTrack = null; }
    if (this.ac) { this.ac.close().catch(() => {}); this.ac = null; this.an = null; }
    this.R.onCaptionMode && this.R.onCaptionMode(null);
  }
  async loopStt() {
    if (!this.on || this.mode !== 'stt') return;
    const track = this.R.media.micTrack();
    if (!track || track.muted || !this.R.media.mic) { this.timer = setTimeout(() => this.loopStt(), 1500); return; }
    const stream = new MediaStream([track]);
    // simple VAD: skip silent chunks so we don't burn STT on silence
    // one AudioContext + analyser for the whole session; rebuild the source only when the mic track changes
    if (!this.ac) { this.ac = new AudioContext(); this.an = this.ac.createAnalyser(); this.an.fftSize = 512; }
    if (this.srcTrack !== track) { if (this.srcNode) { try { this.srcNode.disconnect(); } catch { /* */ } } this.srcNode = this.ac.createMediaStreamSource(stream); this.srcNode.connect(this.an); this.srcTrack = track; }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    const an = this.an;
    const buf = new Uint8Array(an.fftSize); let peak = 0;
    const meter = setInterval(() => { an.getByteTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); }, 120);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const rec = this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(meter);
      if (this.on && this.mode === 'stt') this.loopStt();
      if (peak < 6 || !chunks.length) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      try {
        const r = await fetch(`/api/stt?code=${this.R.code}&lang=${this.lang}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type, ...this.R.headers() }, credentials: 'include' });
        if (!r.ok) throw new Error('stt ' + r.status);
        this.failures = 0;
      } catch {
        if (++this.failures >= 3 && SpeechRec) { toast('Speech service unavailable — switched to on-device captions', { icon: 'captions', group: 'ai' }); this.mode = null; this.startWebSpeech(); this.R.onCaptionMode && this.R.onCaptionMode(this.mode); }
      }
    };
    rec.start();
    const secs = Math.min(15, Math.max(3, this.R.config.stt?.chunkSeconds || 6));
    this.timer = setTimeout(() => { try { rec.state !== 'inactive' && rec.stop(); } catch { /* */ } }, secs * 1000);
  }
  startWebSpeech() {
    if (!SpeechRec) return;
    this.mode = 'webspeech';
    const sr = this.sr = new SpeechRec();
    sr.continuous = true; sr.interimResults = true; sr.lang = WS_LANG[this.lang] || 'en-NG';
    let lastInterim = 0;
    sr.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const text = r[0].transcript.trim(); if (!text) continue;
        if (!this.R.media.mic) continue; // never caption while muted
        if (r.isFinal) this.R.send('caption', { text, final: true, lang: this.lang, source: 'webspeech' });
        else if (Date.now() - lastInterim > 700) { lastInterim = Date.now(); this.R.send('caption', { text, final: false, lang: this.lang, source: 'webspeech' }); }
      }
    };
    sr.onerror = (e) => { if (e.error === 'not-allowed') { this.stop(); toast('Microphone permission is needed for captions', { icon: 'alert' }); } };
    sr.onend = () => { if (this.on && this.mode === 'webspeech' && this.R.media.mic) setTimeout(() => { try { sr.start(); } catch { /* */ } }, 300); };
    try { sr.start(); } catch { /* */ }
  }
}
