# 1venue: Phase 1–3 changes

Three phases: **(1)** survive restarts and keep memory bounded, **(2)** move heavy services
(LiveKit, speech-to-text) off the app, **(3)** restructure into feature folders so a team can
work in parallel. Nothing here has been deployed. Read "Before you deploy" first.

---

## Before you deploy (manual steps)

Do these in order. Steps 1–3 are needed for this release; 4–6 can follow.

### 1. Coolify env vars for the 1venue app

Add (or check) these on the 1venue application. Secrets you already have stay as they are.

| Variable | Value | Why |
|---|---|---|
| `NODE_MAX_OLD_SPACE_MB` | `2048` | Node heap (was a fixed 384 MB). Use about 65% of the container memory. |
| Coolify → Resource limits → Maximum memory | `3g` (`APP_MEM_LIMIT` when you use docker compose) | Keep about 1 GB above the heap |
| `CHAT_INLINE_MAX_MB` | `0` (default) | Chat attachments always go through `/api/files` |
| `MEETING_RESTORE_MAX_MINUTES` | `30` (default) | How long a saved meeting can wait for its people after a restart |
| `LEFT_PARTICIPANT_PRUNE_MINUTES` | `10` (default) | Forget people who left a meeting |
| Health check path | `/health` | Liveness only; use `/ready` for uptime monitors (it checks the database) |

Everything else has safe defaults; see the new sections at the top of `.env.example`. If
Coolify lets you set a stop timeout for the container, keep it at **15 s or more** (the app needs about 2 s, and
force-exits at 8 s).

### 2. Deploy timing

* The first deploy of this release still runs the **old** code's shutdown, which ends live
  meetings. Deploy it outside meeting hours. From the next deploy on, meetings survive.
* While a Coolify LiveKit resource still builds from `docs/livekit` in this repo, every push to
  `main` may redeploy LiveKit too, which drops calls for a few seconds. Step 4 fixes that.
* The database migration (`meeting_snapshots` table) runs automatically on boot.

### 3. Cloudflare R2 for uploads (recommended)

1. Cloudflare dashboard → **R2** → Create bucket, e.g. `1venue-uploads`, location Automatic.
2. R2 → **Manage API tokens** → Create token: *Object Read & Write*, limited to that bucket.
   Copy the Access Key ID and Secret Access Key (shown once).
3. R2 → Overview: copy your **S3 API** endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Optional, faster downloads: bucket → Settings → **Custom domain**, e.g. `files.collab.name.ng`.
5. On the 1venue app in Coolify set:
   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=1venue-uploads
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_FORCE_PATH_STYLE=true
   S3_PUBLIC_BASE_URL=https://files.collab.name.ng   # only if you did step 4
   ```
6. Existing files stay on the `/data` volume and keep working: each file row remembers which
   storage it was saved to, so old files are still served from `/data` and only new uploads go
   to R2. **Keep the `/data` mount.** (Moving old files to R2 would also need their database rows
   updated; not part of this release.)

Without `S3_PUBLIC_BASE_URL`, downloads are streamed through the app (no longer loaded fully
into memory first).

### 4. LiveKit on its own repo (and later its own VPS)

Full guide: `livekit-server/README.md`. Short version:

1. Push `livekit-server/` to a new Git repo.
2. DNS: `1v.collab.name.ng` A record → the LiveKit server's IP, **DNS only (grey cloud)**.
   Optional TURN/TLS needs a second name, e.g. `turn.collab.name.ng`, also grey cloud.
3. Firewall on that server (ufw **and** Contabo's firewall if you use it): 80/tcp, 443/tcp,
   7881/tcp, 50000–60000/udp, 3478/udp, 30000–30100/udp. Do not open 7880.
4. Keys: `./scripts/generate-keys.sh` (or reuse the current pair so 1venue needs no change).
5. Coolify: new **Docker Compose** resource from the repo; env `LIVEKIT_KEYS="APIkey: secret"`,
   `NODE_IP=<public IPv4>`, `LIVEKIT_DOMAIN=1v.collab.name.ng`; domain on the `livekit` service
   `https://1v.collab.name.ng:7880`. If Coolify won't attach a domain to a host-network service,
   use Option B in the README (Traefik dynamic config).
6. Stop the old LiveKit resource, deploy the new one, run
   `./scripts/check.sh 1v.collab.name.ng <key> <secret>`, join a room from Wi-Fi and from mobile data.
7. 1venue env: `LIVEKIT_URL=wss://1v.collab.name.ng`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

Contabo sizing: a Cloud VPS 20/30 (6–8 vCPU) is a good dedicated LiveKit box. LiveKit is CPU and
bandwidth bound, not RAM bound.

### 5. Speech-to-text (RunPod or hosted)

The STT sidecar no longer runs inside the app's compose file (it is a 3 GB CPU model that
competed with meetings). Pick one, set it on the 1venue app, and restart:

* **Cheapest hosted:** Groq. `STT_SECONDARY_BASE_URL=https://api.groq.com/openai/v1`,
  `STT_SECONDARY_MODEL=whisper-large-v3-turbo`, `STT_SECONDARY_API_KEY=<groq key>`.
* **OpenAI:** `STT_SECONDARY_BASE_URL=https://api.openai.com/v1`, `STT_SECONDARY_MODEL=whisper-1`.
* **RunPod GPU pod** (your own Whisper, pay per hour): deploy a pod from the image
  `ghcr.io/speaches-ai/speaches:latest-cuda`, expose HTTP port 8000, then
  `STT_PRIMARY_BASE_URL=https://<POD_ID>-8000.proxy.runpod.net/v1`,
  `STT_PRIMARY_MODEL=Systran/faster-whisper-large-v3`, `STT_PRIMARY_API_KEY=<any non-empty>`.
  Stop the pod when you have no events: it bills while running.
* **N-ATLaS (Nigerian-accent models)** on a separate box: `docker compose -f stt-sidecar/docker-compose.yml up -d --build`
  (needs `HF_TOKEN` and accepted model terms), then `STT_PRIMARY_BASE_URL=http://<box>:8000/v1`.
* Nothing set: captions fall back to the browser's Web Speech API, as before.

### 6. GitHub for the team

* Replace the `@LEAD_MAINTAINER` / `@DEV_*` placeholders in `.github/CODEOWNERS`.
* Branch protection on `main`: require a PR, 1 approval, review from Code Owners, and the
  **CI / test** check (`.github/workflows/ci.yml` runs `npm test` against Postgres 16).

---

## Phase 1: restarts, memory, storage

**Restarts no longer end meetings**
* On `SIGTERM` the app saves every live meeting to the new `meeting_snapshots` table
  (participants, roles, chat, polls, Q&A, stage, whiteboards, content, security settings; timers
  dropped), tells browsers `server-restarting`, closes sockets with code 1012, and exits.
* The new process restores a meeting the first time anyone touches it (WebSocket register,
  `/api/join`, `/api/meeting/:code`, `/api/livekit-token`). Lazy restore matters because Coolify
  starts the new container before stopping the old one.
* Browsers show a "Reconnecting…" banner and rejoin automatically with fast, jittered retries.
  Audio/video keep flowing because LiveKit is separate.
* Snapshots older than 30 minutes are ended properly (history closed, event marked ended).
* Creating a meeting with a code that has an old snapshot discards it first.
* Files: `src/rooms/snapshot.js`, `src/index.js`, `src/ws/hub.js`, `src/http/…`, `public/js/room/room.js`,
  `migrations/20261113000000_meeting_snapshots.sql`.

**Memory**
* Heap is configurable (`NODE_MAX_OLD_SPACE_MB`, default 2048, was 384). Compose `mem_limit`
  is 3g for the app and 1g for Postgres (`shared_buffers` 256 MB).
* WebSocket heartbeat every 30 s; dead sockets are terminated.
* People who left more than 10 minutes ago are pruned from meeting memory (hosts/co-hosts kept).
* Whiteboard: max 1000 strokes per room, 2000 points per stroke (was 2000 strokes and 4000 points);
  when full, the oldest 25% are dropped. Shared-board frames are capped the same way.
* Screen timeline: max 10 items (as before) and a new 1.5 MB cap per snapshot.
* Inline `data:` chat attachments are off (were allowed up to 0.6 MB over the WebSocket). The
  current client already uploads attachments, so users see no difference.

**Storage:** S3/R2 downloads stream to the browser instead of being buffered in memory. `.env.example`
documents R2.

## Phase 2: services off the app box

* **`livekit-server/`**: a standalone repo for Coolify. livekit-server v1.13.11, host networking,
  config inline in the compose file from env vars (no secrets in git), several apps' keys in
  one `LIVEKIT_KEYS`, TURN/UDP on by default, optional TURN/TLS through Traefik SNI, optional Redis
  for multi-node, health check, key generator and `scripts/check.sh` (health + key/secret check
  against `/rtc/validate`). Config validated with the real v1.13.11 binary.
* **STT**: the sidecar is removed from the default `docker-compose.yml` (now
  `stt-sidecar/docker-compose.yml`, for a separate box). `.env.example` documents Groq, OpenAI,
  RunPod and sidecar options.
* **Health**: `/health` is liveness only (no DB call, so a slow database never makes Docker kill
  the app); `/ready` and `/api/health` check the database and return 503 when it is down. The
  Dockerfile `HEALTHCHECK` uses `/health`.
* **Correction to the old LiveKit doc**: its TURN/TLS recipe (Traefik :5349 → LiveKit :5350 on the
  signalling name) can't work, because LiveKit advertises `turns:<turn domain>:443`. The new
  README uses a separate TURN name routed by SNI on 443.

## Phase 3: feature folders for the team

Behaviour is unchanged; the code is moved, not rewritten.

* `src/features/<id>/` holds each feature: `ws.js` (WebSocket plugin), `routes.js` (JSON API),
  `http.js` (raw HTTP), `data.js` (queries), `migrations/`, `client/ws.js` (browser message
  handlers), `client/*.css`. Discovered automatically (`src/core/features.js`); `FEATURE_<NAME>=false`
  still turns a WebSocket plugin off.
* `src/http/routes.js` (1,550 lines) → a ~90-line pipeline + `src/core/auth-routes.js`,
  `src/core/room-routes.js` and feature `http.js` files. `src/http/venue.js` (730 lines) →
  `src/core/router.js` + 15 feature `routes.js` files (kept as a 15-line shim). Duplicate,
  unreachable `/api/venues/admins|audit` handlers were dropped (the live ones are in
  `features/venues/routes.js`).
* `src/venue/data.js` (806 lines) → 13 feature `data.js` files; `src/venue/data.js` is now a facade
  exporting exactly the same 91 functions.
* `src/plugins/*` → `src/features/<id>/ws.js`; the old `venue.js` mega-plugin split into stage,
  polls, qa, comments, scripture, captions and wbShare. Load order is identical (`order` numbers).
* Browser: `public/js/room/wsHandlers.js` keeps only core room messages; 70 message types moved
  to 19 feature `client/ws.js` files via `public/js/room/registry.js`. The server generates
  `/features/client.js` and `/features/features.css`. A duplicate, unreachable `scripture-clear`
  case was removed.
* CSS: the feature-specific tail of `room.css` (content slides, scripture hits) moved to feature
  CSS, loaded right after `room.css`, so the cascade order is unchanged. `app.css` was **not**
  split (its later override sections depend on order; see `docs/ARCHITECTURE.md`).
* Migrations: core in `migrations/`, per feature in `src/features/<id>/migrations/`, all sorted
  together by file name. New ones use UTC timestamps (`npm run migration:new -- name [--feature id]`).
  Existing `001_`–`013_` files and the `schema_migrations` records are unchanged.
* Team files: `CONTRIBUTING.md`, `.github/CODEOWNERS`, `.github/workflows/ci.yml`,
  `src/features/_template/`, `docs/ARCHITECTURE.md`.

**How "unchanged" was checked**
* Full test suite after every step (now 38 tests, including restart, phase-1, structure and an
  end-to-end smoke test).
* HTTP parity: 230 requests (every route, anonymous and signed-in) against the code before and
  after the routes split, each on a fresh database; status codes and response shapes were
  identical.
* API route order: 156 sample paths resolve to the same handler as before.
* Browser handlers: the old `wsHandlers.js` and the new registry were run side by side in Node
  on 86 message types × 48 room states × 2 message shapes (8,256 cases); the resulting room state,
  toasts, sounds and method calls were identical.

---

## Known limitations and risks

* **One app replica.** Rooms live in memory; do not scale the 1venue app to 2+ replicas yet.
* **Crashes still end meetings.** An OOM kill or `SIGKILL` writes no snapshot.
* **Rolling-deploy overlap.** For a few seconds old and new containers both run. A WebSocket
  message sent to the old one in that window can be lost (e.g. a chat line sent right as the
  deploy happens).
* **Left-participant pruning.** Someone who left more than 10 minutes ago is treated as new when
  they come back: room lock and waiting room apply to them like anyone new, and per-person state
  such as a raised hand is gone. Hosts and co-hosts are never pruned.
* **Smaller whiteboard caps** (see Phase 1). Raise `WB_MAX_STROKES` / `WB_MAX_POINTS` if heavy
  boards get trimmed.
* **Heartbeat** is now covered by a test (see the follow-up below). It can still be turned off
  with `WS_HEARTBEAT_MS=0` if unexpected disconnects show up.
* **TURN/TLS** and Coolify's handling of a domain on a host-network service were checked against
  the docs and the real binary's config parser, not on a live server.
* **Docker image** was not built here (no Docker on the build machine); the Dockerfile change is
  small (heap variable, health check).
* **Browser cache.** The service worker version was bumped so clients pick up the new room
  modules; a user with a very old open tab may need a reload.


---

## Follow-up (13 Nov 2026): polls N+1, monitoring, read-out (text-to-speech)

Commits on top of Phase 3, one per step. Tests: 49 passing (`npm test`).

### Polls: fewer database queries
* `listPolls` used 1 query plus 4 per poll (up to 121 for 30 polls), and `pollResults` used 5.
  Both now use **2 queries**: the poll rows, plus one grouped query for counts, voters and "mine".
* The output is the same. `test/polls.test.js` runs the old code (copied verbatim) and the new
  code on the same data and compares the results. The only difference: `mine` is now sorted.
  The old order was random, and the client only checks membership.

### Monitoring
* `GET /metrics` returns Prometheus text with these metrics:
  * rss, heap used, heap total
  * live rooms, connected participants, open sockets
  * `venue_ws_dead_sockets_terminated_total` (sockets the heartbeat killed)
  * uptime
* It needs `Authorization: Bearer $METRICS_TOKEN`. It returns **404 while `METRICS_TOKEN` is
  unset** and 401 for a wrong token.
* Once a minute the app logs one line:
  `[metrics] rss=..MB heap=used/totalMB rooms= participants= sockets= dead_sockets_total= uptime=..s`.
  Turn it off with `METRICS_LOG=false`. Change the interval with `METRICS_LOG_INTERVAL_MS`.
* Code: `src/core/metrics.js`, wired into `src/ws/hub.js`, `src/index.js` and `src/http/routes.js`.
  Tests in `test/metrics.test.js` cover the heartbeat really killing a dead socket.

### Read-out (text-to-speech) with Replicate `google/gemini-3.8-flash-tts`
The full guide is **docs/TTS.md** (setup, pricing as shown on the page, how languages are
decided, cost tips).
* **Model checked on Replicate (13 Nov 2026):**
  * It exists and is an official Google model.
  * Inputs: `text`, `voice` (30 voices, default `Kore`), `second_voice`, `style`, and
    `output_format` (`wav` or `mp3`).
  * **There is no language input.** The model detects the language from the text.
* **Languages (from Google's list linked on that page):**
  * **Igbo, Hausa and Arabic are supported.**
  * **Yorùbá is not supported**, and neither is Nigerian Pidgin.
* **Server** (`src/features/tts/`):
  * `POST /api/tts` is a proxy. The token stays on the server.
  * Only signed-in users and room participants can use it.
  * Languages are checked against an allowlist (Google's list, or `TTS_LANGUAGES`).
  * Text is limited to `TTS_MAX_CHARS`. Model directions (`<tags>`, `|pipes|`, `/IPA/`) are
    removed so content is read, not performed.
  * Limits: a per-person rate limit (`TTS_RATE_PER_MIN`, existing limiter), a whole-server daily
    character cap, and two people asking for the same text at once pay only once.
  * Audio is cached in storage (R2 or disk) by a hash of model + voice + format + language + text.
    Cache hits are free and not rate-limited. The cache is the `tts_cache` table (new migration).
  * `GET /api/tts/config` tells the browser what is on.
* **Browser:**
  * The 🔊 icon starts hidden. It only appears when:
    * the content's language is known (from metadata, or from a clear non-Latin script such as
      Arabic), **and**
    * either the server supports that language or the device has a voice for exactly that language.
  * Otherwise there is no icon, and never an English voice reading another language.
  * Latin-script text (Igbo, Hausa, Yorùbá, English) is never guessed; it needs metadata.
  * Room scripture now passes its translation, so English Qur'an translations are read in English.
    (They used to be treated as Arabic.)
  * The service worker version was bumped (v13) so browsers load the new files.
* Tests (`test/tts.test.js`) use a fake Replicate server: token never exposed, 401, unsupported
  language, size limit, request body and headers, polling, cache, rate limit, room credential,
  503 without a token, and the browser detection and gating rules. A headless-Chrome check on
  the Bible reader confirmed the icon appears for Igbo, Hausa, Arabic and English, is absent
  for Yorùbá, and that Listen/Stop works.

### Manual steps
1. Replicate: create an account, add billing (and a spend limit if offered), and create a token
   at <https://replicate.com/account/api-tokens>.
2. In Coolify, add `REPLICATE_API_TOKEN=r8_...` (a secret; never put it in git). Optional
   settings are in `.env.example` → *Text-to-speech*.
3. Monitoring: in Coolify, add `METRICS_TOKEN=<long random string>` (`openssl rand -hex 32`).
   Scrape it with Prometheus:
   ```yaml
   - job_name: 1venue
     scheme: https
     metrics_path: /metrics
     authorization: { type: Bearer, credentials: <METRICS_TOKEN> }
     static_configs: [{ targets: ['venue.collab.name.ng'] }]
   ```
   Or check it by hand: `curl -H "Authorization: Bearer $METRICS_TOKEN" https://<domain>/metrics`.
4. Set `language` on events (e.g. `ig`, `ha`, `ar`) when creating them, so future read-out on
   events picks the right language.
5. Yorùbá: there is no read-out until a model supports it. To try anyway at your own risk, set
   `TTS_LANGUAGES=en,ig,ha,ar,yo` after listening to the quality yourself.

### Risks
* The text being read is sent to Replicate and Google, and every clip carries a SynthID watermark.
* Spend is bounded by caching, the per-person limit and the daily cap. Still set a spend limit
  on Replicate.
* The model is new, so its inputs or language list could change. Re-check the model page if
  read-out starts failing, and pin a version with `TTS_REPLICATE_MODEL=owner/name:version`.
* If you wipe the storage bucket but keep the database, run `DELETE FROM tts_cache;`.
