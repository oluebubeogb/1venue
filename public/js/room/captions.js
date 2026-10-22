// Live captions. Primary: server STT (N-ATLaS / Whisper) via short self-contained audio chunks.
// Fallback: the browser's Web Speech API. Every final line is stored server-side as "Name: text".
import { toast } from '../ui.js';

const WS_LANG = { en: 'en-NG', yo: 'yo-NG', ig: 'ig-NG', ha: 'ha-NG', pcm: 'en-NG', fr: 'fr-FR' };
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Captioner {
  constructor(R) { this.R = R; this.on = false; this.mode = null; this.rec = null; this.sr = null; this.timer = null; this.failures = 0; }
  get lang() { return this.R.captionLang(); }
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
    this.rec = null; this.sr = null; this.mode = null;
    if (this.ac) { this.ac.close().catch(() => {}); this.ac = null; }
    this.R.onCaptionMode && this.R.onCaptionMode(null);
  }
  async loopStt() {
    if (!this.on || this.mode !== 'stt') return;
    const track = this.R.media.micTrack();
    if (!track || track.muted || !this.R.media.mic) { this.timer = setTimeout(() => this.loopStt(), 1500); return; }
    const stream = new MediaStream([track]);
    // simple VAD: skip silent chunks so we don't burn STT on silence
    if (!this.ac) { this.ac = new AudioContext(); }
    const src = this.ac.createMediaStreamSource(stream); const an = this.ac.createAnalyser(); an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.fftSize); let peak = 0;
    const meter = setInterval(() => { an.getByteTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); }, 120);
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const rec = this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(meter); try { src.disconnect(); } catch { /* */ }
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
    sr.onend = () => { if (this.on && this.mode === 'webspeech') setTimeout(() => { try { sr.start(); } catch { /* */ } }, 300); };
    try { sr.start(); } catch { /* */ }
  }
}
