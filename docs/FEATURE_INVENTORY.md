# 1venue feature inventory

Everything 1venue does today, grouped by area, with where it lives in the code. ✅ means built and
in the codebase (see docs/BLUEPRINT.md for what has been verified on a live deployment).

## A. Platform and infrastructure
| # | Feature | Status and notes |
|---|---|---|
| A1 | Node http server with no framework (`server.js` → `src/index.js`) | ✅ |
| A2 | `/health` and `/api/health` (Docker healthcheck) | ✅ also reports DB, AI, STT and storage status |
| A3 | WebSocket hub, plugin registry with `onWs` and `onRegister` | ✅ `src/ws/hub.js`, `src/features/<id>/ws.js` |
| A4 | HMAC `wsCredential` bound to participant and meeting code (6h TTL) | ✅ |
| A5 | LiveKit SFU, token grants mapped from room permissions to track sources | ✅ with simulcast and bitrate caps on the client, and live permission updates for speaker seats |
| A6 | Feature flags `FEATURE_*` (chat, reactions, mute, deviceIcons, schedule, content, moderation, waitingRoom, raisedHand, activity, recording, templates, diagnostics) | ✅ `content` (presentation mode) is on by default |
| A7 | PostgreSQL via `DATABASE_URL` | ✅ versioned SQL migrations run on start; a SQLite database can be imported with `npm run migrate:sqlite-to-pg` |
| A8 | Cleanup loop that kills meetings idle for 12h | ✅ |
| A9 | Startup warnings for missing secrets and services | ✅ |
| A10 | Dockerfile (Debian slim, multi-stage, LibreOffice + poppler for PPTX) | ✅ |

## B. Accounts and auth
| # | Feature | Status and notes |
|---|---|---|
| B1 | Email + password sign-up and sign-in (`/api/signup`, `/api/login`) | ✅ bcrypt (configurable cost), email confirmation, rate limits (docs/AUTH.md) |
| B2 | Sessions: 15-min access token + rotating refresh token stored hashed | ✅ device list, per-device sign-out, sign out everywhere |
| B3 | Forgot / reset password, change password, change email | ✅ single-use expiring links; reset signs out every device |
| B4 | Continue with Google (OpenID Connect + PKCE) | ✅ links by verified email; hidden when not configured |
| B5 | `Authorization: Bearer` access for API clients | ✅ checked against the session row |
| B6 | `/api/me`, `/api/session`, sign out | ✅ |
| B7 | Guest display-name validation | ✅ |

## C. Meetings core
| # | Feature | Status and notes |
|---|---|---|
| C1 | Create meeting (name, host name, template, advanced settings) | ✅ redesigned create sheet |
| C2 | Codes `ABC-123` (no I/O/0/1), join by split letter/number inputs | ✅ one smart code input that also accepts pasted links |
| C3 | Invite link `/ABC-123?key=` with `inviteAccess` anyone or approval ("Require invitation link") | ✅ |
| C4 | Regenerate the invite key | ✅ |
| C5 | Join rules: invite key, block list, lock, guest access, max participants, rejoin, waiting room, membership | ✅ cap `MAX_PARTICIPANTS` (default 50); stage events add `MAX_AUDIENCE` listeners |
| C6 | Waiting room for guests, with admit, decline, admit-all and decline-all | ✅ |
| C7 | Rejoin after reload (session in localStorage, `/ABC-123` deep link) | ✅ |
| C8 | Leave (meeting ends when empty) and end for everyone | ✅ |
| C9 | Meeting timer and duration clock | ✅ |
| C10 | Templates: blank, research, classroom, team, interview, presentation, talk show, seminar | ✅ |
| C11 | Scheduled events: create, list, delete, start, discover | ✅ |
| C12 | Meeting history list and detail (participants, artifact, recordings) | ✅ dashboard "Past" tab |
| C13 | Session page with chat, activity, participants, personal note, transcripts, AI summary and downloads | ✅ |
| C14 | Breakout rooms: 2–10 rooms, move, close (LiveKit `CODE-bo-N`) | ✅ |
| C15 | Activity log (DB plus live ring buffer) and activity drawer | ✅ |
| C16 | Diagnostics and connection panel (WS state, LiveKit state) | ✅ |
| C17 | Device icons (mobile, tablet, desktop) per participant | ✅ |

## D. Media
| # | Feature | Status and notes |
|---|---|---|
| D1 | Microphone toggle with echo cancellation, noise suppression and AGC | ✅ |
| D2 | Pre-join mic picker, mic picker modal, preferred mic saved, refresh mics | ✅ |
| D3 | Camera | ✅ simulcast, capped at 540p/720p |
| D4 | Screen share with quality presets and a bitrate ladder | ✅ low default caps for modest servers, "text" vs "motion" content hint |
| D5 | Force-stop another person's share (host) | ✅ |
| D6 | Background blur (CSS) | ✅ |
| D7 | Picture-in-picture | ✅ Document PiP with live controls, video PiP as fallback |
| D8 | Fullscreen app or stage | ✅ |
| D9 | Grid, spotlight and speaker views | ✅ |
| D10 | Idle stage with clock and typewriter motivators (fun, faith, motivation) | ✅ |
| D11 | Join cue and ring sounds | ✅ |

## E. Moderation and permissions
| # | Feature | Status and notes |
|---|---|---|
| E1 | Roles: host, co-host, participant, guest, and speaker / audience in stage events | ✅ |
| E2 | Set role, transfer host | ✅ |
| E3 | Remove participant, with optional block on rejoin | ✅ |
| E4 | Mute participant, mute all, ask to unmute, allow unmute, ask to choose mic | ✅ |
| E5 | Per-user permission overrides (mic, screen, camera, chat) | ✅ |
| E6 | Security panel: waiting room, guest access, lock, share, mic, cam, chat, reactions, raise hand, invite rights | ✅ |
| E7 | Set max participants | ✅ |
| E8 | Raise or lower hand, lower all, raised-hands panel | ✅ |
| E9 | Ring all and ring a participant (with ring overlay) | ✅ |

## F. Chat and communication
| # | Feature | Status and notes |
|---|---|---|
| F1 | Meeting chat with @mentions, link detection, history replay and persistence | ✅ |
| F2 | Image attachments (compressed to WebP), files, voice notes with player | ✅ |
| F3 | Private 1:1 chat in a meeting, persisted DM threads across meetings (guest aware) | ✅ |
| F4 | Group chats managed by moderators (create, add, remove) | ✅ |
| F5 | Chat inbox and channels UI, unread badges, notifications tab | ✅ |
| F6 | Chat overlay on fullscreen stage, chat PiP | ✅ |
| F7 | Self chat colour (hash hue) | ✅ |
| F8 | Reactions: thumbs, clap, heart, laugh, wow, celebrate, thanks, with a recent reactions strip | ✅ |

## G. Content, presentation and collaboration
| # | Feature | Status and notes |
|---|---|---|
| G1 | Content share: URL, PDF (pdf.js), local video, uniform or free scroll, remote handoff and claim | ✅ presentation mode |
| G2 | Screen timeline: up to 10 images, slideshow and selection (host and cohost) | ✅ |
| G3 | Personal whiteboards: pens, brush, eraser, text, select and move, undo/redo, multiple boards, export/import `.mwb`, autosave; share to the room as view-only | ✅ |
| G4 | Live notes with server autosave, transcript insertion, export, AI summary | ✅ |
| G5 | Recording: host start, pause, resume, stop; each browser captures locally (MediaRecorder) and saves to the device | ✅ never uploaded |

## H. UI and UX
| # | Feature | Status and notes |
|---|---|---|
| H1 | Light and dark themes, accent colours, font-size setting | ✅ |
| H2 | Keyboard shortcuts: M mic, S share, H hand, K shortcuts, C chat, V camera; command bar (`/`, Ctrl K) | ✅ |
| H4 | Mobile layout: bottom nav, people and chat sheets, orientation handling, nav badges | ✅ |
| H5 | Home page: hero, create and join, live now | ✅ |
| H6 | Toasts and notifications | ✅ |
| H7 | Copy code, share link, copy invite, branded QR code | ✅ |

## I. Events, stage and community
| # | Feature | Status and notes |
|---|---|---|
| I1 | Events with categories (talk show, presentation, seminar, sermon, webinar, workshop, meeting, concert, class), RSVP, speakers, schedule | ✅ `src/features/events` |
| I2 | Discover: live now, upcoming, search | ✅ |
| I3 | Venues: persistent spaces with their own code, plan and admins | ✅ `src/features/venues` |
| I4 | Stage with speaker seats and a request-to-speak queue | ✅ `src/features/stage` |
| I5 | Polls, Q&A and comments | ✅ |
| I6 | Shared materials per event | ✅ `src/features/materials` |
| I7 | Attendance | ✅ `src/features/attendance` |
| I8 | Profiles, follows, feed | ✅ `src/features/social` |
| I9 | Dashboard (your events, sessions, stats) | ✅ `src/features/dashboard` |

## J. Scripture, captions and AI
| # | Feature | Status and notes |
|---|---|---|
| J1 | Host-synced scripture in rooms (Bible and Qur'an translations) | ✅ `src/features/scripture` |
| J2 | Books reader at `/books` | ✅ |
| J3 | Read-out (text-to-speech) only for supported languages | ✅ docs/TTS.md |
| J4 | Live captions: server STT (OpenAI-compatible), browser speech as fallback | ✅ `src/features/captions` |
| J5 | Transcripts as `Name: text`, AI summaries, downloads | ✅ `src/features/sessions`, `src/features/ai` |

## K. Platform
| # | Feature | Status and notes |
|---|---|---|
| K1 | Installable PWA with service worker | ✅ |
| K2 | Restarts without ending meetings (snapshots in Postgres) | ✅ |
| K3 | File storage on disk or S3/R2 with quotas and rate limits | ✅ |
| K4 | `/health`, `/ready`, `/metrics` | ✅ |
| K5 | `CANONICAL_HOST` redirect | ✅ |
