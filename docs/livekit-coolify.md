# LiveKit for 1venue

LiveKit (audio, video, screen share) now lives in **its own repository**, `livekit-server`
(shipped next to this repo in the Phase 1–3 zip). Its `README.md` is the full guide: server size,
DNS, firewall, keys, Coolify setup, TURN, health checks and troubleshooting. This page only
covers how 1venue connects to it and how to move off the old setup.

Why separate: one LiveKit server can serve several apps (each with its own key pair), it can be
moved to a bigger box or scaled without touching 1venue, and pushing 1venue no longer redeploys
LiveKit (which used to drop every call for a few seconds).

## Point 1venue at LiveKit

In the 1venue Coolify app's environment:

```
LIVEKIT_URL=wss://1v.collab.name.ng        # your LiveKit domain
LIVEKIT_API_KEY=APIxxxxxxxx                # one entry of LIVEKIT_KEYS on the LiveKit server
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Redeploy 1venue, then:

* `https://<your 1venue domain>/api/config` shows `"livekitConfigured": true`.
* In the 1venue container terminal: `npm run livekit:check` (signalling, key/secret, WebSocket).
* Join a room from two devices, one on **mobile data**, with cameras on.

## Moving from the old `docs/livekit` resource

The old Coolify resource built LiveKit from this repo (`Base Directory: /docs/livekit`). Move
without downtime for users:

1. Push the `livekit-server` folder to a new Git repository.
2. In Coolify, create a new Docker Compose resource from that repo **on the same server**, but
   do not deploy it yet. Set its env vars (`LIVEKIT_KEYS` with the **same** key/secret 1venue
   uses today, `NODE_IP`, `LIVEKIT_DOMAIN`) and its domain `https://1v.collab.name.ng:7880`.
3. Outside meeting hours: stop the old LiveKit resource, then deploy the new one (both use host
   ports 7880/7881/50000–60000, so they cannot run at the same time on one server).
4. Run `./scripts/check.sh 1v.collab.name.ng <key> <secret>` from the new repo, and join a room.
5. Delete the old resource. `docs/livekit/` stays in this repo for one release only as a
   fallback, then can be deleted.

Same key pair and same domain means 1venue needs no change at all for this move.

## TURN over TLS: correction

The old guide terminated TURN/TLS on port 5349 for the same name as signalling. That does not
work as written: with `external_tls` LiveKit tells browsers to use `turns:<turn domain>:443`,
not 5349. The new guide (livekit-server `README.md`, "TURN over TLS") routes port 443 by SNI for
a **separate** name such as `turn.collab.name.ng` (one level under `collab.name.ng`, A record,
DNS only / grey cloud). TURN over UDP 3478 plus ICE/TCP 7881 is enough for most users, so TURN/TLS
stays optional and off by default.
