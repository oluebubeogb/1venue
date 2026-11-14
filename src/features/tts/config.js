/** TTS settings (all from env; see .env.example "text-to-speech"). */
const { env, int } = require('../../config');
const { allowedLanguages } = require('./languages');

// Voices listed in the model's input schema (google/gemini-3.8-flash-tts, "voice" enum).
const VOICES = ['Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe', 'Charon', 'Despina',
  'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Pulcherrima', 'Puck',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'];

function load() {
  const voice = env('TTS_VOICE', 'Kore');
  return {
    token: env('REPLICATE_API_TOKEN', ''), // server-side only, never sent to browsers
    apiBase: env('REPLICATE_API_BASE', 'https://api.replicate.com/v1').replace(/\/+$/, ''),
    model: env('TTS_REPLICATE_MODEL', 'google/gemini-3.8-flash-tts'), // "owner/name" or "owner/name:version"
    voice: VOICES.includes(voice) ? voice : 'Kore',
    format: env('TTS_FORMAT', 'mp3') === 'wav' ? 'wav' : 'mp3',
    maxChars: Math.max(50, int('TTS_MAX_CHARS', 1500)),
    ratePerMin: Math.max(1, int('TTS_RATE_PER_MIN', 10)), // new generations per person per minute (cache hits are free)
    dailyChars: Math.max(0, int('TTS_DAILY_CHAR_LIMIT', 200_000)), // new characters per day for the whole server; 0 = no cap
    timeoutMs: int('TTS_TIMEOUT_MS', 90_000),
    maxAudioBytes: int('TTS_MAX_AUDIO_MB', 20) * 1048576,
    languages: allowedLanguages(env('TTS_LANGUAGES', '')),
  };
}

module.exports = { load, VOICES };
