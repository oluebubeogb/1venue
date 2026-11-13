# 1venue architecture

Plain Node 22 (`http` + `ws`), PostgreSQL, LiveKit for media, a vanilla ES-module front end.
No framework and no build step. This page is the map; `CONTRIBUTING.md` is the workflow.

## Processes and services

```
browser ──HTTPS/WSS──> Coolify proxy (Traefik) ──> 1venue app container (this repo, port 3000)
   │                                                   ├── PostgreSQL (DATABASE_URL)
   │                                                   ├── file storage: /data/uploads or S3/R2
   │                                                   └── optional: AI / STT HTTP APIs (OpenAI-compatible)
   └──WSS + UDP/TCP media──> LiveKit server (separate repo `livekit-server`, its own domain)
```

* **1venue app**: HTTP API, static front end, and one WebSocket hub for room state (chat, polls,
  stage, whiteboards, …). All live room state is held **in memory** in `src/rooms/store.js`.
* **LiveKit**: audio, video and screen share. The app only signs tokens for it
  (`src/livekit/tokens.js`), so app restarts do not drop media.
* **PostgreSQL**: accounts, events, social, history, transcripts, files metadata, and
  `meeting_snapshots` (live rooms saved during a restart).

## Request flow (src/http/routes.js)

```
OPTIONS / rate limits
 -> feature JSON routes     src/features/<id>/routes.js   via src/core/router.js   (/api/... table)
 -> feature raw handlers    src/features/<id>/http.js     (streams, /files/..., older if-chain APIs)
 -> /health (liveness, no DB)   /metrics (Prometheus, METRICS_TOKEN; src/core/metrics.js)
    /ready + /api/health (DB check, 503 when down)
 -> core auth routes        src/core/auth-routes.js       (config, sign-up/in, SSO, /api/me)
 -> core room routes        src/core/room-routes.js       (create, join, meeting, LiveKit token, leave)
 -> static files            src/http/static.js            (+ /features/* browser assets)
```

Route lookup order is fixed by feature `order` (see the table below), then by the order a
feature registers its routes. `test/structure.test.js` fails if two features register the same
method + pattern.

## Room WebSocket flow (src/ws/hub.js)

1. The browser connects to `/` and sends `register` with an HMAC credential from `/api/join`.
2. The hub finds the meeting (restoring it from `meeting_snapshots` after a restart), then runs
   `onRegister` hooks.
3. Every other message type is dispatched to the handlers registered with
   `ctx.onWs(type, handler)` by feature plugins (`src/features/<id>/ws.js`), in feature order.
4. Servers push messages back; in the browser, `public/js/room/wsHandlers.js` handles core room
   messages and hands everything else to the handler a feature registered with
   `onMessage(type, fn)` in `src/features/<id>/client/ws.js`.

Heartbeat: the hub pings every `WS_HEARTBEAT_MS` (30 s) and terminates sockets that miss a round.

## Restarts (deploys) without ending meetings

* `SIGTERM` (Coolify stop/redeploy): stop accepting HTTP, save every live meeting to
  `meeting_snapshots`, tell browsers `server-restarting`, close sockets with code 1012, close
  the DB, exit. Meetings are **not** ended.
* The new process restores a meeting **lazily**, the first time anyone asks for it (WS register,
  `/api/join`, `/api/meeting/:code`, `/api/livekit-token`). Lazy restore matters because Coolify
  starts the new container before the old one stops.
* Browsers show "Reconnecting…" and rejoin automatically with fast, jittered retries.
* Snapshots older than `MEETING_RESTORE_MAX_MINUTES` (30) are ended properly by the cleanup
  timer (history row closed, event marked ended).
* A crash (`SIGKILL`, OOM kill) writes no snapshot; those meetings end, as before.

Memory guards: left participants are pruned after `LEFT_PARTICIPANT_PRUNE_MINUTES`,
whiteboards keep at most `WB_MAX_STROKES` × `WB_MAX_POINTS`, screen timelines are capped, and
inline `data:` chat attachments are off.

## Folders

| Path | What lives there |
|---|---|
| `server.js`, `src/index.js` | boot, timers, graceful shutdown |
| `src/config.js` | every env var, with defaults |
| `src/core/` | shared plumbing: feature discovery, routers, HTTP kit, DB helpers, room helpers, client asset server |
| `src/features/<id>/` | one folder per feature (below) |
| `src/rooms/` | in-memory room store, lifecycle (end, prune), restart snapshots |
| `src/ws/hub.js` | WebSocket server, register/auth, plugin dispatch, heartbeat |
| `src/http/` | request pipeline, static server, `venue.js` compatibility shim |
| `src/venue/` | shared services: AI, STT, Bible, QR, storage (local/S3/R2), PPTX, uploads; `data.js` is a facade over the feature `data.js` files |
| `src/lib/` | auth, permissions, codes, HTTP helpers, WS credentials, attachments |
| `migrations/` | core SQL migrations (`001_…013_` legacy, then UTC timestamps) |
| `public/` | front end: `js/app.js` router, `js/pages/*` pages, `js/room/*` the room UI |
| `test/` | `node --test` suites (DB-backed ones need `DATABASE_URL`) |
| `stt-sidecar/` | optional self-hosted speech-to-text, run on another box |

## Feature folders

```
src/features/<id>/
  index.js        { id, order }                 manifest (id = folder name)
  ws.js           { id, register(ctx) }         WebSocket plugin (FEATURE_<ID>=false turns it off)
  routes.js       (route, kit) => {...}         JSON API routes
  http.js         async (req, res, parsed)      raw HTTP handler, true when handled
  data.js         query functions               (also re-exported by src/venue/data.js)
  migrations/     YYYYMMDDHHMMSS_name.sql
  client/ws.js    onMessage(type, fn)           browser handlers, served as /features/<id>/ws.js
  client/*.css                                  concatenated into /features/features.css
```

Nothing is registered by hand: `src/core/features.js` scans the folder. Folders starting with
`_` (like `_template`) are ignored.

| order | feature | has |
|---|---|---|
| 10 | `chat` | ws, client/ws |
| 20 | `reactions` | ws, client/ws |
| 30 | `mute` | ws |
| 40 | `deviceIcons` | ws |
| 50 | `content` | ws, routes, client/ws, client css |
| 60 | `moderation` | ws, client/ws |
| 70 | `activity` | ws, http, client/ws |
| 80 | `recording` | ws, http, client/ws |
| 90 | `screenTimeline` | ws, client/ws |
| 100 | `privateChat` | ws, http, client/ws |
| 110 | `groupChat` | ws, client/ws |
| 120 | `breakout` | ws, client/ws |
| 130 | `whiteboard` | ws, routes, data, client/ws |
| 140 | `sounds` | ws, client/ws |
| 150 | `stage` | ws, routes, client/ws |
| 160 | `polls` | ws, data, client/ws |
| 170 | `qa` | ws, data, client/ws |
| 180 | `comments` | ws, routes, data, client/ws |
| 190 | `scripture` | ws, routes, data, client/ws, client css |
| 200 | `captions` | ws, routes, client/ws |
| 210 | `wbShare` | ws, client/ws |
| 300 | `sessions` | routes, http, data |
| 310 | `attendance` | http |
| 320 | `schedule` | http |
| 330 | `templates` | http |
| 400 | `events` | routes, data |
| 410 | `materials` | routes, data |
| 420 | `venues` | routes, data |
| 430 | `social` | routes, data |
| 440 | `dashboard` | routes, data |
| 450 | `files` | routes, http, data |
| 460 | `ai` | routes, data |
| 470 | `tts` | routes, data, migrations, client (read-out; see docs/TTS.md) |

Orders 10–210 reproduce the old hand-written plugin list exactly; keep gaps of 10 so new
features can slot in.

## What is still shared (merge-conflict hot spots)

These files are touched by many features; keep changes to them small and reviewed by a lead:

* `public/js/room/room.js`, `panels.js`, `tools.js`, `stage.js`: the room UI. Feature **message
  handling** has moved out, but the panels and tool views are still in these files.
* `public/js/pages/*`: page modules (feed, events, venues, …) are per page, not per feature.
* `public/css/app.css`: the design system plus page styles. Its later "override" sections depend
  on order, so only room styles at the end of `room.css` were moved into features so far.
* `src/core/room-routes.js`: create/join/leave.
* `src/config.js`: add new env vars in your own clearly labelled block.

## Scaling notes

One app container holds all live rooms in memory, so run **one replica** of the app. To run
more than one, rooms must be pinned to an instance (or room state moved to Redis); that is the
next phase. LiveKit already runs separately and can be scaled on its own (see the
`livekit-server` repo README). Postgres can move to a managed service by changing
`DATABASE_URL`.
