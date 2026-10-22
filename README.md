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
   - The health check is `GET /health`.
   - Tables are created on first boot.
   - The app must be served under `*.collab.name.ng` so it can read the Collab Accounts `access_token` and `refresh_token` cookies.
6. **Optional.** Fill in `AI_PRIMARY_*` with RunPod (`https://api.runpod.ai/v2/<id>/openai/v1`) and `AI_SECONDARY_*` with any OpenAI-compatible provider. Then set `STT_PRIMARY_BASE_URL` to an N-ATLaS endpoint.

## Deploy with docker compose (backup)

```bash
cp .env.example .env        # set JWT_SECRET, POSTGRES_PASSWORD, LIVEKIT_*, PUBLIC_URL
docker compose up -d --build
docker compose --profile stt up -d --build   # + local N-ATLaS speech-to-text (CPU, needs HF_TOKEN)
```

Postgres is tuned small (shared_buffers 64 MB, 40 connections). It runs with a named volume and a health check, and the app waits until the database is healthy before it starts. The memory caps are 256 MB for the database and 512 MB for the app.

## Local development

```bash
npm install
DATABASE_URL=postgres://venue@localhost:5432/venue AI_MOCK=true npm run dev
npm test
npm run icons   # regenerate PWA icons from the mark (needs python3 + Pillow)
```

If `LIVEKIT_*` is not set, rooms still work for chat, polls, Q&A, boards, Bible, transcripts (through Web Speech) and so on. Audio and video stay off until you configure LiveKit.

## Auth: Collab Accounts SSO

- The app reads the `access_token` cookie. If it has `ACCOUNTS_JWT_SECRET` it verifies the token locally; otherwise it calls `ACCOUNTS_URL/auth/me`.
- It refreshes through `/auth/refresh`.
- Sign-in redirects to `ACCOUNTS_LOGIN_URL?next=<url>`, and sign-out uses `ACCOUNTS_URL/logout?next=`.
- Local email and password accounts are still available when `ALLOW_LOCAL_SIGNUP=true`.

## Speech-to-text

`STT_PROVIDER=auto` tries the providers in this order:

1. **N-ATLaS.** These are NCAIR1/Awarri Whisper-Small fine-tunes for Nigerian-accented English, Yorùbá, Igbo and Hausa. They are reached through any OpenAI-compatible `/audio/transcriptions` endpoint: `stt-sidecar/`, or a RunPod worker.
2. **Whisper.** Any OpenAI-compatible endpoint.
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

## Recordings and storage

Recordings are captured in the browser and saved straight to the user's device as `.webm`, so they are never uploaded. Shared files go to VPS disk (`STORAGE_DRIVER=local`). To use S3, R2, MinIO or Spaces instead, set `STORAGE_DRIVER=s3` and fill in the `S3_*` variables.
