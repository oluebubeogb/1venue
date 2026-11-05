# 1venue call fixes (2026-11-02)

## Screen share / spotlight
- Each viewer picks what fills the spotlight: a switcher chip row above the stage lists every active share ("Ada's screen", "Your screen") plus "Cameras". The choice is local to that viewer.
- No more lock to the first share. A new share does NOT steal the view — you stay on your pick (or the current screen); if your picked share ends you fall back to another active share.
- Double-click a screen, or the "Sharing" badge on a sharer's tile, to watch that screen. Pinning a camera while screens are shared switches you to "Cameras".
- Screens no longer add filmstrip tiles. The sharer keeps one camera/avatar tile with a blue "Sharing" badge, so a 2-person call with one share shows the screen + 2 people tiles.
- Presented screens are fitted (object-fit: contain) on a dark background.
- Files: public/js/room/stage.js (presentation, renderSwitch, setPick, paintTile, render), room.js (pin), room.css.

## Captions / transcript
- Always-on: when the room's "Save transcript" is on (server default), every speaker's captioner auto-starts on join, on transcript-state changes and on mic toggles — the panel no longer needs to be opened.
- Per-user opt-out: turning off "Caption me / Caption my voice" while the transcript is on is remembered (localStorage venue.captionOptOut); turning it on clears it.
- Mute pauses instead of tearing down (Web Speech stops/resumes; server STT loop idles).
- One AudioContext + analyser reused for the whole session (source rebuilt only when the mic track changes).
- Files: public/js/room/captions.js (autoSync, setMine, onMic), room.js, wsHandlers.js, tools.js.

## Other
- Service worker cache bumped (v3-2026-11-02) so clients load the new JS/CSS.
- LiveKit server config unchanged; CPU tuning waits for docker stats.

## Verify
- Two browsers both share → each can switch independently via chips; a third joining share doesn't move anyone.
- 2-person call, one share → screen in spotlight + 2 people tiles, sharer has "Sharing" badge.
- Transcript on, nobody opens the panel → lines from both speakers land in the transcript; muting pauses.

## Screen-share CPU caps (pass 2)
ICE was srflx↔host (no TURN), so SFU CPU came from forwarding a VP8 screen share with two simulcast layers (q+h, L1T3) at a high start bitrate.
- Screen share now publishes ONE encoding: no simulcast (`simulcast: false`, `screenShareSimulcastLayers: []`), `scalabilityMode: 'L1T1'`, max 1280×720.
- Defaults: 12 fps, 1.2 Mbps (hard ceilings 15 fps / 1.5 Mbps even if env is higher). "low" quality = 960×540 @ 5 fps, ≤0.6 Mbps.
- `degradationPreference: 'maintain-resolution'` keeps text sharp; frames drop first.
- Env defaults: `SCREEN_MAX_BITRATE=1200000`, `SCREEN_MAX_FPS=12` (src/config.js, .env.example). Override on Coolify if you set the old 2500000/15.
- Camera unchanged (simulcast h180/h360 + 720p top, 1.2 Mbps). Mic and optional screen/tab audio unchanged.
- Where: `public/js/room/media.js` — `connect()` → `publishDefaults` (room-wide VideoPublishOptions) and `setShare()` → `setScreenShareEnabled(on, ScreenShareCaptureOptions, TrackPublishOptions)`.
- Service worker cache bumped to v4-2026-11-02.

Retest: `docker stats <livekit>` idle, 2-person camera-only, then with one share and with two shares; in chrome://webrtc-internals the screen outbound-rtp should show one stream (no q/h rids), ~720p, ≤12 fps, ≤1.2 Mbps.

## 2026-11 UX pack

- **F fullscreen**: fullscreens the whole document (`html.room-fs`) so the soft site background, 1v rail, head rail and the search/cmd footer all stay visible with generous padding. No more black.
- **S stop-share confirm**: pressing S (or the share button) while sharing opens a light-blur "End screenshare?" overlay. Esc/Keep sharing cancels, Enter/End stops.
- **Multi-screenshare**: the "user's screen / cameras" chip row is gone. Sharers' cards show a screenshare badge; click one to put that screen on the big stage. A Cameras icon on the head rail (next to People) switches to the camera grid.
- **Bible**: one control line (verse · translation · Preview · Show · placement · Clear), icon-only with hover labels. Show/Clear/placement only for users allowed to share (mods, or speakers when stage is on, matching the server). Chapter prev/next and translation changes by the sharer re-broadcast to everyone; viewers follow the sharer's translation unless they pick their own. Shared verses open in the sidebar by default; the sharer can move them to the big screen and back. "Shown by" moved to a tooltip on the header dot. Passages are cached client-side.
- **Small cards**: square, site-background (not black) card with blurred avatar backdrop, centred round avatar, mute badge top-left, ⋯ menu (show screen on stage, view camera in sidebar, pin). Several sidebar cameras show as a responsive grid.
- **Permanent venues**: `/venues` (list/create, unlimited per signed-in user), `/v/{slug}` (7-char lowercase, case-insensitive; also `/{slug}` at root). Each venue owns a fixed room code; the owner opens it with a per-meeting name; waiting room is forced on and cannot be turned off. Guests arriving before the host see "This venue isn't open yet — wait a little" and are auto-forwarded into the waiting room when the host is in. Ending the meeting kicks everyone as usual; when the host reopens, guests wait again. Owners see the list of meetings held at the venue. Home has a Venue button; "Venues" is in the command palette/search.
  - API: `GET/POST /api/venues`, `GET/PATCH /api/venues/:slug`, `GET /api/venues/:slug/meetings`; `/api/create` accepts `venue: slug`.
  - Migration: `migrations/004_venues.sql` (applied automatically by `db.migrate`). No new env vars.
- **Typography**: smaller, near-uniform headings, weight 600 max, in `app.css` and `room.css`.

## Permanent venue open/handoff (no forked codes)
- `venue.js` Open now navigates to `/{venue.code}` with intent (not `/new`); guest door polls every 3s and enters as soon as the venue is open ("Entering …").
- `room.js` create sends `venue` + `code`; venue owner hitting join 404 on their code falls back to create-with-venue. New `GET /api/venues/by-code/:code`.
- `/api/create` resolves venue by slug or venue-bound code, requires owner, forces `code = venue.code` (never generateCode for venues); 409 returns venue.code.
- Migration `005_venue_open.sql`: `venues.opened_at`, `active_history_id`; set on open, cleared in `endMeeting`. `venueLive` = in-memory meeting OR recent DB open flag.
