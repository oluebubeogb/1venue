# 1venue

**1venue** is a platform for live events and online meetings, at <https://1venue.live>. One place to host a Sunday service, a community town hall, a conference session or a class: people join from a link or a QR code on any phone or laptop, with no app to install.

## Who it is for

- **Churches and faith communities:** sermons and services with scripture shown in sync for everyone (Bible and Qur'an, in English, Yorùbá, Igbo, Hausa, Arabic and more), read-out, live captions and transcripts.
- **Communities and organisations:** town halls, talk shows and AMAs with a stage of speakers, an audience that can request to speak, polls and Q&A.
- **Conferences and seminars:** scheduled events with discovery, shared materials, presentation mode and attendance.
- **Classes and teams:** meetings with a waiting room, breakout rooms, whiteboards, chat and screen share.

## Key features

- **Events:** create, schedule and discover live and upcoming events; venues; categories (talk show, seminar, sermon, class, workshop and more); branded QR codes and share links.
- **Stage:** speaker seats with a request-to-speak queue, host controls, audience mode for large rooms.
- **Meetings:** audio, video and screen share (LiveKit with simulcast and bitrate caps for low bandwidth), waiting room, lock, roles and per-person permissions, breakout rooms, raise hand, picture-in-picture.
- **Engagement:** chat with attachments and voice notes, private and group chats, reactions, polls, Q&A, comments.
- **Content:** presentation mode for links, PDFs and slides (PPTX), screen timeline, personal whiteboards you can share, shared materials.
- **Scripture and books:** host-synced Bible and Qur'an passages in rooms, a reader at `/books`, and read-out where the language is supported.
- **Captions and transcripts:** live captions tuned for Nigerian-accented English and Nigerian languages, transcripts stored as `Name: text`, one-click AI summaries, downloads.
- **People:** accounts with email + password or Continue with Google, profiles, follows, a feed, a dashboard with your events, sessions and stats. Guests can join rooms with just a name.
- **App feel:** installable PWA, light and dark themes, accent colours, font-size setting, a command bar (`/` or Ctrl K).
- **Recordings** are captured in the browser and saved to the user's own device.

**Stack:** Node 22 (plain `http` and `ws`, no framework, no build step), PostgreSQL 16 with migrations on boot, LiveKit for media, vanilla ES-module front end with a service worker.

## Quick start (local)

```bash
npm install
# a local Postgres, e.g.:
docker run -d --name venue-pg -e POSTGRES_USER=venue -e POSTGRES_PASSWORD=venue -e POSTGRES_DB=venue -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgres://venue:venue@localhost:5432/venue PUBLIC_URL=http://localhost:3000 AI_MOCK=true npm run dev
```

Open <http://localhost:3000>. Without SMTP, sign-up and reset links are printed in the terminal. Without `LIVEKIT_*`, rooms still work for chat, polls, Q&A, boards, scripture and transcripts (through the browser's speech recognition); audio and video stay off until LiveKit is configured.

```bash
npm test        # node --test; DB-backed tests need DATABASE_URL
npm run icons   # regenerate PWA icons (needs python3 + Pillow)
```

### SQLite for local testing

Run `npm install`, then `npm run dev:sqlite` and open <http://localhost:3000>.
The app creates `data/venue.sqlite` automatically. Sign up with a username, email,
password, and phone number. Verification and reset links print in the terminal
when SMTP is not configured. AI uses local mock responses in this mode.

Run `npm run test:sqlite` for the SQLite test suite. Integration tests use temporary
database files. Stop the server before resetting local data, then delete
`data/venue.sqlite` and its `-wal` and `-shm` companions. PostgreSQL remains the
deployment database. LiveKit, Google OAuth, real AI/STT/TTS, and LibreOffice need
their own configuration to exercise those integrations.

Local event search uses SQLite FTS5 and title matching; typo matching can differ
from PostgreSQL trigram search. Schema changes need migrations in both
`migrations/` / feature migrations (PostgreSQL) and `migrations/sqlite/`.

## Architecture

One Node process serves the API, the front end and a WebSocket hub for live room state; PostgreSQL stores everything that lasts; LiveKit carries audio and video on its own server (the separate `livekit-server` repo, so several apps can share it). Each feature lives in its own folder, `src/features/<feature>/`. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the full feature list is in [docs/FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md) and the product plan in [docs/BLUEPRINT.md](docs/BLUEPRINT.md).

## Deploy on Coolify (recommended)

1. **Database.** Push this repo to GitHub or GitLab. In Coolify, go to **+ New → Database → PostgreSQL 16** and copy its *internal* connection URL.
2. **App.** **+ New → Application → your repo**, build pack **Dockerfile**, port **3000**.
3. **Environment variables.** Paste in `.env.example` and fill in at least:
   - `PUBLIC_URL` (e.g. `https://1venue.live`)
   - `JWT_SECRET`, generated with `openssl rand -hex 32`
   - `DATABASE_URL`, the internal URL from step 1
   - `LIVEKIT_URL` (e.g. `wss://rtc.1venue.live`), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
   - `SMTP_*` and `MAIL_FROM`, so confirmation and password-reset emails go out (see [docs/AUTH.md](docs/AUTH.md))
   - Optional: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for "Continue with Google", and `CANONICAL_HOST`
4. **Storage.** Add a persistent storage mount at `/data` (uploads live in `/data/uploads`), or use Cloudflare R2 (`STORAGE_DRIVER=s3`).
5. **Domain.** Set the domain (the same value as `PUBLIC_URL`) and deploy. DNS, Cloudflare and the www → apex redirect are in [docs/DEPLOY-1venue.live.md](docs/DEPLOY-1venue.live.md).
   - Health checks: `GET /health` is liveness (no database call; the Dockerfile uses it). `GET /ready` also checks the database (503 when it is down).
   - Monitoring: set `METRICS_TOKEN` to enable `GET /metrics` (Prometheus text, `Authorization: Bearer <token>`).
   - Tables are created on first boot.
6. **Optional services.** AI summaries (`AI_PRIMARY_*`, `AI_SECONDARY_*`, any OpenAI-compatible provider), speech-to-text (`STT_*`), read-out (`REPLICATE_API_TOKEN`). See below and `.env.example`.
7. **Restarts and memory.** Deploys do not end live meetings: on shutdown the app saves every live room to Postgres and the new container restores it; browsers show "Reconnecting…" and rejoin by themselves. Keep Coolify's stop grace period at 15 s or more. The Node heap is `NODE_MAX_OLD_SPACE_MB` (default 2048); keep the container limit about 1 GB above it.

LiveKit runs from the `livekit-server` repo as its own Coolify resource: see [docs/livekit-coolify.md](docs/livekit-coolify.md), and check it with `npm run livekit:check`.

### Docker compose (alternative)

```bash
cp .env.example .env        # set PUBLIC_URL, JWT_SECRET, POSTGRES_PASSWORD, LIVEKIT_*, SMTP_*
docker compose up -d --build
```

Postgres runs with a named volume and a health check, and the app waits for it. Defaults suit a VPS with 8 GB+ RAM; every limit is an env var (`PG_*`, `APP_MEM_LIMIT`, `NODE_MAX_OLD_SPACE_MB`).

## Configuration

Every setting is an environment variable, documented in [.env.example](.env.example) and read in `src/config.js`. The main groups:

| Area | Variables | Docs |
|---|---|---|
| Core | `PUBLIC_URL`, `CORS_ORIGINS`, `CANONICAL_HOST`, `JWT_SECRET`, `TRUST_PROXY` | [DEPLOY-1venue.live.md](docs/DEPLOY-1venue.live.md) |
| Accounts | `ALLOW_LOCAL_SIGNUP`, `AUTH_*`, `BCRYPT_COST`, `GOOGLE_*` | [AUTH.md](docs/AUTH.md) |
| Email | `SMTP_*`, `MAIL_FROM`, `MAIL_REPLY_TO` | [AUTH.md](docs/AUTH.md) |
| Database | `DATABASE_URL`, `DATABASE_POOL_MAX`, `AUTO_MIGRATE` | |
| Media | `LIVEKIT_*`, `SIMULCAST`, `VIDEO_*`, `MAX_PARTICIPANTS`, `MAX_AUDIENCE` | [livekit-coolify.md](docs/livekit-coolify.md) |
| Storage | `STORAGE_DRIVER`, `S3_*`, `UPLOAD_*` | `.env.example` |
| AI and speech | `AI_*`, `STT_*`, `REPLICATE_API_TOKEN`, `TTS_*` | [TTS.md](docs/TTS.md) |
| Monitoring | `METRICS_TOKEN`, `METRICS_LOG` | |

## Accounts and sign-in

Full details, Google Cloud Console steps and SMTP examples: [docs/AUTH.md](docs/AUTH.md).

- Email + password sign-up (`ALLOW_LOCAL_SIGNUP`), email confirmation, forgot/reset password, change password and change email (re-confirmed).
- "Continue with Google" (OpenID Connect with PKCE) when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set; hidden otherwise.
- Short-lived access token plus a rotating refresh token stored hashed in Postgres, in host-only `HttpOnly; Secure; SameSite=Lax` cookies. Settings → Account lists every signed-in device, with sign out per device and "Sign out everywhere".
- Guests can join rooms with just a name.

## Speech-to-text

`STT_PROVIDER=auto` tries the providers in this order:

1. **Primary** (`STT_PRIMARY_*`, named N-ATLaS by default). Any OpenAI-compatible `/audio/transcriptions` endpoint: a RunPod GPU pod running an OpenAI-compatible Whisper server (e.g. speaches), or the optional `stt-sidecar/` on a separate box (the sidecar serves the NCAIR1/Awarri N-ATLaS Whisper-Small fine-tunes for Nigerian-accented English, Yorùbá, Igbo and Hausa; it is a CPU build).
2. **Secondary** (`STT_SECONDARY_*`, Whisper). Any OpenAI-compatible endpoint: Groq (`whisper-large-v3-turbo`, cheapest), OpenAI (`whisper-1`), etc.
3. **The browser's Web Speech API.**

Every line is stored as `Name: text`. Transcripts can be saved, summarised by AI with one click, and downloaded: the transcript as `.txt` and the summary as `.md`.

The N-ATLaS weights are gated on Hugging Face and use their own *Open-Source Research and Innovation License*. Accept those terms before you use them.

## Bibles

The Bibles come from the Free Use Bible API (bible.helloao.org, sourced from eBible.org), with a fallback to bible-api.com. The translations are:

- **English:** KJV, WEB, BSB, ASV, BBE, YLT and Darby are public domain. FBV and LSV are CC BY-SA.
- **African languages:** Yorùbá, Igbo, Hausa and Kiswahili, under the eBible.org licences.
- **European languages:** Louis Segond 1910, Reina-Valera 1909, Bíblia Livre and Luther 1912.
- **Arabic:** Van Dyck.

The Good News Translation (GNT) is copyrighted by the American Bible Society, so it is not bundled. Use BBE or WEB as the plain-English choice.

## Read-out (text-to-speech)

The 🔊 icon reads scripture aloud through Replicate's `google/gemini-3.8-flash-tts` (server-side, cached in storage). It only appears when the language is supported: Igbo, Hausa, Arabic and English yes; Yorùbá no. Set `REPLICATE_API_TOKEN` to turn it on. Setup, pricing and language rules: [docs/TTS.md](docs/TTS.md).

## Recordings and storage

Recordings are captured in the browser and saved straight to the user's device as `.webm`, so they are never uploaded. Shared files go to VPS disk (`STORAGE_DRIVER=local`). To use S3, Cloudflare R2, MinIO or Spaces instead, set `STORAGE_DRIVER=s3` and fill in the `S3_*` variables (`.env.example` has an R2 walkthrough). Downloads from a private bucket are streamed, not loaded into memory. Chat attachments are always uploaded as files; inline `data:` attachments are off by default (`CHAT_INLINE_MAX_MB=0`).

## Contributing

Each feature lives in one folder, `src/features/<feature>/` (WebSocket plugin, API routes, queries, migrations, browser handlers and CSS), and is discovered automatically. Start from `src/features/_template/`. Branches, pull requests, tests and code owners are described in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE). Bible and Qur'an texts, speech models and other third-party content keep their own licences (noted above and in `docs/`).
