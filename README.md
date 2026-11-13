# 1venue

1venue is a virtual events and meetings platform for the Collab suite. It is a rebuild of **Meet**: every Meet feature is kept (see `docs/MEET_FEATURE_INVENTORY.md`), and on top of that you get live-event discovery, stage seats with a request-to-speak queue, synced Bibles, Nigerian-accent transcription, AI summaries, branded QR codes, personal whiteboards, timelines, dashboards, a command bar and PWA install.

**Stack**
- Node 22, plain `http` and `ws`, with no framework and no build step.
- PostgreSQL 16. Migrations run automatically on boot.
- LiveKit SFU, with simulcast, dynacast and bitrate caps.
- Vanilla ES-module front end with a service worker.

## Deploy on Coolify (recommended)

1. **Database.** Push this repo to GitHub or GitLab. In Coolify, go to **+ New → Database → PostgreSQL 16** and copy its *internal* connection URL.
2. **App.** Go to **+ New → Application → your repo**, set the build pack to **Dockerfile** and the port to **3000**.
3. **Environment variables.** Paste in the variables from `.env.example`. At minimum set these:
   - `PUBLIC_URL`
   - `JWT_SECRET`, generated with `openssl rand -hex 32`
   - `DATABASE_URL`, the internal URL from step 1
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`
   - `COOKIE_DOMAIN=.collab.name.ng`
4. **Storage.** Add a persistent storage mount at `/data`. Uploads live in `/data/uploads`.
5. **Domain.** Set the domain (for example `venue.collab.name.ng`) and deploy.
   - Health checks: `GET /health` is liveness (process up, no database call; the Dockerfile uses it). `GET /ready` also checks the database (503 when it is down).
   - Monitoring: set `METRICS_TOKEN` to enable `GET /metrics` (Prometheus text, `Authorization: Bearer <token>`; 404 while unset). The app also logs one `[metrics]` line a minute (`METRICS_LOG=false` turns it off).
   - Tables are created on first boot.
   - The app must be served under `*.collab.name.ng` so it can read the Collab Accounts `access_token` and `refresh_token` cookies.
6. **Optional.** Fill in `AI_PRIMARY_*` with RunPod (`https://api.runpod.ai/v2/<id>/openai/v1`) and `AI_SECONDARY_*` with any OpenAI-compatible provider. For speech-to-text, point `STT_*` at a hosted OpenAI-compatible endpoint (see *Speech-to-text* below and `.env.example`).
7. **Restarts and memory.** Deploys no longer end live meetings: on shutdown the app saves every live room to Postgres and the new container restores it; browsers show "Reconnecting…" and rejoin by themselves (media keeps flowing through LiveKit). Keep Coolify's stop grace period at 15 s or more. The Node heap is `NODE_MAX_OLD_SPACE_MB` (default 2048); keep the container limit about 1 GB above it.

## Deploy with docker compose (backup)

```bash
cp .env.example .env        # set JWT_SECRET, POSTGRES_PASSWORD, LIVEKIT_*, PUBLIC_URL
docker compose up -d --build
```

Postgres runs with a named volume and a health check, and the app waits until the database is healthy before it starts. Defaults are sized for a Contabo Cloud VPS with 8 GB+ RAM: Postgres `shared_buffers=256MB`, 60 connections, `mem_limit 1g`; the app `mem_limit 3g` with a 2 GB heap. Every value is an env var (`PG_*`, `APP_MEM_LIMIT`, `NODE_MAX_OLD_SPACE_MB`), so a smaller box can lower them.

Speech-to-text is no longer part of this compose file. Use a hosted endpoint, or run `stt-sidecar/docker-compose.yml` on a separate machine.

## Local development

```bash
npm install
DATABASE_URL=postgres://venue@localhost:5432/venue AI_MOCK=true npm run dev
npm test
npm run icons   # regenerate PWA icons from the mark (needs python3 + Pillow)
```

If `LIVEKIT_*` is not set, rooms still work for chat, polls, Q&A, boards, Bible, transcripts (through Web Speech) and so on. Audio and video stay off until you configure LiveKit.

LiveKit runs on its own server from its own repo (`livekit-server/`, shipped next to this one), so several apps can share it. See [docs/livekit-coolify.md](docs/livekit-coolify.md). Check it with `npm run livekit:check`.

## Working on a feature

Each feature lives in one folder, `src/features/<feature>/` (server WebSocket plugin, API routes, queries, migrations, browser handlers and CSS), and is discovered automatically. Start from `src/features/_template/`. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Auth: Collab Accounts SSO

- The app reads the `access_token` cookie. If it has `ACCOUNTS_JWT_SECRET` it verifies the token locally; otherwise it calls `ACCOUNTS_URL/auth/me`.
- It refreshes through `/auth/refresh`.
- Sign-in redirects to `ACCOUNTS_LOGIN_URL?next=<url>`, and sign-out uses `ACCOUNTS_URL/logout?next=`.
- Local email and password accounts are still available when `ALLOW_LOCAL_SIGNUP=true`.

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
