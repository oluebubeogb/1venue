# Text-to-speech (the read-out icon)

1venue reads scripture and other content aloud using **Gemini 3.8 Flash TTS**, which runs on
Replicate: <https://replicate.com/google/gemini-3.8-flash-tts>. The code is in `src/features/tts/`.

**The main rule:** the read-out (🔊) icon only appears when the content's language can be read
properly. A Yorùbá passage is never read with an English voice. If the language isn't supported,
or the app can't tell what language the text is in, there is no icon.

---

## 1. One-time setup (about 10 minutes)

1. **Create a Replicate account** at <https://replicate.com> (you can sign in with GitHub).
2. **Add billing.** Replicate charges per use, and models made by companies such as Google need a
   payment method. Open your account's billing page from the menu at <https://replicate.com>.
   **Set a monthly spend limit** there if one is offered. It is your safety net.
3. **Create an API token** at <https://replicate.com/account/api-tokens>. Name it `1venue-prod`.
   The token starts with `r8_`. Treat it like a password.
4. **Add the token in Coolify:** open the 1venue resource, go to **Environment Variables**, and add
   `REPLICATE_API_TOKEN=r8_...`. Then redeploy.
   - Do **not** put the token in git, in `.env.example`, or in any client file.
   - The server is the only part that talks to Replicate. Browsers call `POST /api/tts` on your own
     server and get back an audio URL from your storage (R2 or the local disk).
5. Optional: tune the settings in the next section. The defaults are sensible.
6. **Check it:** open the Bible reader, pick the **Igbo Bible**, and the 🔊 icon should appear.
   Pick the **Yoruba Bible** and it should not appear (see §3).

No token = cloud read-out is off. The icon then only appears on devices that have a built-in
voice for that exact language (usually English and a few big languages).

## 2. Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `REPLICATE_API_TOKEN` | *(empty)* | Turns cloud read-out on. Kept on the server only. |
| `TTS_REPLICATE_MODEL` | `google/gemini-3.8-flash-tts` | The model. Use `owner/name`, or `owner/name:version` to pin a version. |
| `TTS_VOICE` | `Kore` | Default voice (one of the model's 30 voices; listed below). |
| `TTS_FORMAT` | `mp3` | `mp3` (small) or `wav` (24 kHz, about 10× bigger). Keep mp3. |
| `TTS_MAX_CHARS` | `1500` | Longest text per request. The browser splits long chapters into sentence chunks under this size. |
| `TTS_RATE_PER_MIN` | `10` | How many **new** clips one participant or user can generate per minute. Cached clips don't count. |
| `TTS_DAILY_CHAR_LIMIT` | `200000` | Most new characters the whole server will send to Replicate per day (UTC). `0` = no cap. |
| `TTS_LANGUAGES` | *(empty = the documented list)* | Comma-separated language codes that get the icon. This replaces the list (see §3). |
| `TTS_TIMEOUT_MS` | `90000` | How long to wait for Replicate before giving up. |
| `TTS_MAX_AUDIO_MB` | `20` | Refuse audio files larger than this. |
| `REPLICATE_API_BASE` | `https://api.replicate.com/v1` | Only change this for testing. |

`GET /api/tts/config` is public and shows the browser what is on: `enabled`, `model`,
`languages`, `maxChars`, `voices`, and `defaultVoice`. It never includes the token.

## 3. What the model supports (checked on Replicate, 13 Nov 2026)

These facts are from the model page and the Google list it links to; nothing here is guessed.

- **Model id:** `google/gemini-3.8-flash-tts`. It is an official Google model on Replicate, so the
  server calls `POST /v1/models/google/gemini-3.8-flash-tts/predictions`.
- **Inputs** (from the README's *Inputs* table):

  | Input | Meaning | Default |
  | --- | --- | --- |
  | `text` | The words to speak. Can contain `<tags>` (e.g. `<laugh>`), `\|backchannels\|`, and `/IPA/`. | required |
  | `voice` | Narrator voice | `Kore` |
  | `second_voice` | Turns on two-speaker mode when it is not `none` | `none` |
  | `style` | Delivery direction, e.g. "calm, reverent" | empty |
  | `output_format` | `wav` (24 kHz mono) or `mp3` | `wav` |

  1venue sends `text`, `voice`, and `output_format: "mp3"`.
  - The server removes `< > | /` from the content first, so scripture is read as written and
    never "performed" as stage directions.
  - The model returns a URL to the audio. The server downloads it and stores it in your storage.
- **There is no language input.** In the page's words: "The model detects the language from your
  text, so you don't need to set it." (The older 3.1 model's `language_code` input is gone.)
  That is why 1venue does its own language check before calling it.
- **Languages:** the page says "It supports 130 languages" and links to Google's list at
  <https://ai.google.dev/gemini-api/docs/speech-generation#languages>. The
  Gemini 3.8 Flash TTS column there had 132 rows. 1venue's copy is `src/features/tts/languages.js`
  (127 codes; script variants such as Serbian Cyrillic/Latin are merged).
  - ✅ **Igbo** (`ig`). It is listed for Flash TTS but not for the "Flash-Lite" variant, so don't
    switch to a Lite model if you need Igbo.
  - ✅ **Hausa** (`ha`)
  - ✅ **Arabic** (`ar`, plus Egyptian Arabic `arz`)
  - ✅ Swahili, English, French, Portuguese, and many more.
  - ❌ **Yorùbá (`yo`) is NOT on the list.** The Yoruba Bible therefore gets no cloud read-out. Its
    icon only appears on a device that has a real Yorùbá voice installed, which is rare. This is on
    purpose: no badly read Yorùbá.
  - ❌ Nigerian Pidgin (`pcm`) is not listed either.
- **Voices (30):** Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe,
  Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia,
  Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia,
  Sadaltager, Sulafat.
- **Safety:** the page says every clip carries an inaudible **SynthID** watermark marking it as AI
  generated.

**Overriding the list:** `TTS_LANGUAGES=en,ig,ha,ar` shows the icon only for those four languages.
This list replaces the documented one, so you *could* add `yo`. Only do that after listening
yourself and deciding the quality is good enough.

## 4. Pricing (exactly what the Replicate page showed, 13 Nov 2026)

The model page lists:

- **$0.50 per million input tokens** ("or 2,000,000 tokens for $1")
- **$9 per million output tokens** ("or around 111,111 tokens for $1")

The page data also showed "$0.0001 per second" and a typical (p50) run price of "$0.00042". Prices
change, so always check the live page: <https://replicate.com/google/gemini-3.8-flash-tts>.
Most of the cost is in output tokens, which means the length of the audio produced.
Your real spend appears on your Replicate dashboard.

## 5. How the language check works

The server only answers for languages on the allowlist (§3). The browser decides whether to show
the icon at all:

1. **Explicit language metadata wins.** Examples:
   - Bible translations have a language (`src/venue/bible.js`: `ibo_bib` → `ig`, `hau_bib` → `ha`,
     `arb_vdv` → `ar`, `yor_bib` → `yo`, `quran_ar_uthmani` → `ar`, `quran_en_*` → `en`, …).
   - Scripture shared in a room carries its translation id, so a Qur'an English translation is
     read in English, not Arabic.
2. **No metadata?** The browser looks at the script, but only when one script clearly dominates
   (at least 60% of the letters):
   - Arabic script → `ar` (or `ur` / `fa` when Urdu or Persian letters appear)
   - Hebrew → `he`, Greek → `el`, Thai → `th`, Korean → `ko`, Japanese → `ja`, Chinese → `zh`,
     and a few more.
3. **Latin-script text without metadata is never guessed.** Igbo, Hausa, Yorùbá, and English all
   use Latin letters, and a guess would be wrong too often. Cyrillic, Devanagari, and Ethiopic are
   shared by several languages, so they aren't guessed either. These need metadata.
4. Then (since 14 Nov 2026 — device first, cloud only where the device has no voice):
   - The device has a built-in voice for **exactly that language** → **device voice** (free,
     instant). English, French and most big languages land here on phones and laptops.
   - Otherwise, language on the allowlist and cloud on → **cloud voice** (Gemini). Signed-out
     viewers still see the icon; tapping it opens the log-in overlay (cloud audio costs money).
   - Otherwise → **no icon**.

The code is `src/features/tts/client/lang.js` (detection and the decision) and
`src/features/tts/client/readout.js` (playback). The icon itself is `makeListenBtn()` in
`public/js/pages/bible.js`.

### Setting the language on content

- **Bible and Qur'an:** each translation already has a `lang`. To add a translation, set `lang` in
  `src/venue/bible.js`.
- **Events:** events have a `language` field (default `en`), saved through the events API
  (`language: "ig"`). Event pages don't have a read-out icon yet. When a feature adds one, it should
  pass the event's language: `makeListenBtn(() => ({ text, lang: event.language }))`.
- **Any new feature:** call `makeListenBtn(getPayload, { headers })` with
  `getPayload() → { text | verses, lang }`. Inside a room, pass `R.headers()` so guests can use it.
  If you don't know the language, leave `lang` out. Non-Latin scripts are detected automatically;
  otherwise the icon stays hidden, which is the safe result.

## 6. Keeping costs down

- **Caching is built in.** Each clip is stored in your storage under a hash of
  model + voice + format + language + text.
  - The second person to play the same verse gets the stored file: free and instant.
  - Two people pressing play at the same moment trigger only one generation.
  - Popular chapters are paid for once.
- **Cached audio is never rate-limited.** Only new generations count against `TTS_RATE_PER_MIN`.
- **Keep the daily cap** (`TTS_DAILY_CHAR_LIMIT`). It stops a runaway bill. When it is reached,
  listeners see "today's limit" until midnight UTC.
- **Keep `mp3`.** The files are smaller, so storage and bandwidth cost less. Cost on Replicate
  depends on audio length, not file size.
- **Keep `TTS_MAX_CHARS` moderate.** Long texts are split into chunks, and the browser asks for
  only the next chunk ahead. When someone presses Stop, at most one extra chunk has been
  generated.
- **Don't change `TTS_VOICE` casually.** A new voice means new cache keys, so everything is paid
  for again.
- **Restrict languages** with `TTS_LANGUAGES` if you only need a few.
- Only signed-in users and room participants can generate audio. Anonymous visitors get
  "Sign in to listen".

## 7. Igbo / Hausa / Arabic not reading aloud (diagnosis, 14 Nov 2026)

- **Not the short codes.** 1venue never sends a language code to Google: the Replicate model
  `google/gemini-3.8-flash-tts` takes only `text`, `voice`, `second_voice`, `style`, `output_format`
  and detects the language from the text. `TTS_LANGUAGES` is 1venue's own allowlist. Google's
  language table lists Igbo (`ig`), Hausa (`ha`) and Arabic (`ar`) as supported, so `ig,ha,ar` is
  correct. Full tags (`ig-NG`, `ar-XA`), ISO 639-2 (`ibo`, `hau`, `ara`) and names (`igbo`) are now
  accepted too; the server logs a warning at start-up for any code Google does not list.
- **The real causes (fixed):** the cloud voice was offered only to signed-in users, so signed-out
  readers on a device without an Igbo/Hausa voice got no icon at all; the first chunk could be
  1,500 characters (slow, looked broken); and iOS/Safari blocked playback that started after the
  network wait. Now: icon for everyone, a first chunk of ~300 characters, the audio element is
  unlocked on the tap, and a spinner shows while the first clip is prepared.
- **Recommended:** `TTS_LANGUAGES=ig,ha,ar` (English uses the device voice). `REPLICATE_API_TOKEN`
  must be set or the cloud voice is off.
- **Check it:** sign in as an admin and open **/admin → Read-out check**: it shows, for this device,
  whether each language uses the device or cloud voice, and "Test cloud" plays a real clip or shows
  the exact provider error (bad token, billing, …).

## 8. Good to know

- **Privacy:** the text being read is sent to Replicate and Google to make the audio. Don't enable
  read-out on private content you wouldn't send to a third party.
- **Storage:** clips are saved with purpose `tts` in the `files` table, and the `tts_cache` table
  maps text hashes to files. If you delete a clip's file, its cache row is deleted with it
  (`ON DELETE CASCADE`), and the next play generates it again.
  - If you wipe the storage bucket but not the database, cached URLs will 404. In that case, clear
    the cache with `DELETE FROM tts_cache;`.
- **Errors** are shown to listeners as short messages: busy, timed out, or limit reached. The token
  never appears in logs.
