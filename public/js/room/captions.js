// Live captions. Primary: server STT (Whisper on Replicate, then N-ATLaS / Whisper servers) via short
// speech clips cut at natural pauses (2-5 s, silence never sent; shared Segmenter from voice.js).
// Fallback: the browser's Web Speech API. Every final line is stored server-side as "Name: text".
import { toast } from '../ui.js';
import { Segmenter } from '../voice.js';

const WS_LANG = { en: 'en-NG', yo: 'yo-NG', ig: 'ig-NG', ha: 'ha-NG', pcm: 'en-NG', fr: 'fr-FR' };
export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Captioner {
  constructor(R) { this.R = R; this.on = false; this.mode = null; this.rec = null; this.sr = null; this.timer = null; this.failures = 0; }
  get lang() { return this.R.captionLang(); }
  get usesServer() { return !!(this.R.config.stt?.server && window.MediaRecorder && !this.browserFallback); }
  // Per-user opt-out from auto captions (when the host saves a transcript).
  get optOut() { try { return localStorage.getItem('venue.captionOptOut') === '1'; } catch { return false; } }
  set optOut(v) { try { localStorage.setItem('venue.captionOptOut', v ? '1' : '0'); } catch { /* */ } }
  // Always-on pipeline: runs whenever the room transcribes, independent of any panel being open.
  autoSync() {
    const R = this.R;
    const want = !this.optOut && this.usesServer && R.isSpeaker(R.me.id) && !!R.media;
    // Server STT waits for the published microphone track.
    if (want && !this.on) { this.auto = true; this.start().catch(() => {}); }
    else if (!want && this.on && this.auto) this.stop();
  }
  // User toggled "caption me": manual start clears the opt-out, manual stop during a saved transcript sets it.
  setMine(on) { if (on) { this.optOut = false; this.auto = false; return this.start(); } if (this.R.transcribe) this.optOut = true; this.stop(); return Promise.resolve(); }
  // Browser speech opens its own capture. Only an explicit Caption me action starts it.
  onMic(on) {
    if (!on && this.mode === 'webspeech') this.stop();
  }
  async start() {
    if (this.on) return;
    this.on = true;
    if (this.usesServer) { this.mode = 'stt'; this.loopStt(); }
    else if (SpeechRec && this.R.media.mic) this.startWebSpeech();
    else if (SpeechRec) { this.on = false; toast('Unmute before turning on browser captions', { icon: 'captions' }); return; }
    else { this.on = false; toast('Captions need a speech service or a browser with speech recognition (Chrome / Edge)', { icon: 'alert' }); return; }
    this.R.onCaptionMode && this.R.onCaptionMode(this.mode);
  }
  stop() {
    this.on = false; clearTimeout(this.timer);
    try { this.rec && this.rec.state !== 'inactive' && this.rec.stop(); } catch { /* */ }
    try { this.sr && this.sr.stop(); } catch { /* */ }
    this.rec = null; this.sr = null; this.mode = null; this.auto = false;
    if (this.seg) { this.seg.stop(); this.seg = null; } this.srcTrack = null;
    this.R.onCaptionMode && this.R.onCaptionMode(null);
  }
  async loopStt() {
    if (!this.on || this.mode !== 'stt') return;
    const track = this.R.media.micTrack();
    if (!track || track.readyState !== 'live') { this.timer = setTimeout(() => this.loopStt(), 1500); return; }
    if (this.seg && this.srcTrack === track) { this.timer = setTimeout(() => this.loopStt(), 2000); return; } // re-check for device switches
    if (this.seg) { this.seg.stop(); this.seg = null; }
    this.srcTrack = track;
    const maxMs = Math.min(15, Math.max(2, this.R.config.stt?.segmentMaxSeconds || 5)) * 1000;
    // Muted = LiveKit disables the track (silence), so the VAD simply sends nothing.
    this.seg = new Segmenter(new MediaStream([track]), { maxMs, onHearing: () => {}, onClip: (blob, ms) => this.sendClip(blob, ms) });
    this.seg.start();
    this.timer = setTimeout(() => this.loopStt(), 2000);
  }
  async sendClip(blob, ms) {
    if (!this.on || this.mode !== 'stt' || !this.R.media.mic) return;
    try {
      const r = await fetch(`/api/stt?mode=caption&code=${this.R.code}&lang=${this.lang}`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type, 'X-Audio-Ms': String(Math.round(ms || 0)), ...this.R.headers() }, credentials: 'include' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error('stt ' + r.status); e.fallback = j.fallback; throw e; }
      this.failures = 0;
    } catch (e) {
      if ((e.fallback === 'webspeech' || ++this.failures >= 3) && SpeechRec && this.mode === 'stt') {
        this.browserFallback = true;
        this.stop();
        toast(e.fallback ? 'Caption limit reached. Choose Caption me to use browser captions.' : 'Speech service unavailable. Choose Caption me to use browser captions.', { icon: 'captions', group: 'ai' });
      }
    }
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
    sr.onend = () => {
      if (this.sr !== sr || !this.R.media.mic) return;
      this.timer = setTimeout(() => {
        if (this.sr !== sr || !this.R.media.mic) return;
        try { sr.start(); } catch { /* */ }
      }, 300);
    };
    try { sr.start(); } catch { /* */ }
  }
}
