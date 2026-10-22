# Meet → 1venue feature inventory

Source studied: `_meet_original/meet-main` (package `meet` v1.9.1). Server: `server.js`, `src/**`, `db.js`. Client: `public/index.html`, `public/js/core/app.js` (about 12.6k lines), `public/js/features/*`, `public/styles.css`.
The "1venue" column says where each feature lives now. ✅ means kept, sometimes improved. ♻️ means kept but changed on purpose because a requirement said so.

## A. Platform and infrastructure
| # | Meet feature | 1venue |
|---|---|---|
| A1 | Node http server with no framework, `server.js` → `src/index.js` | ✅ same core, `src/index.js` |
| A2 | `/health` and `/api/health` (Docker healthcheck) | ✅ also reports DB, AI, STT and storage status |
| A3 | WebSocket hub at `/ws`, plugin registry with `onWs` and `onRegister` | ✅ `src/ws/hub.js`, `src/plugins/*` |
| A4 | HMAC `wsCredential` bound to participant and meeting code (6h TTL) | ✅ unchanged |
| A5 | LiveKit SFU, token grants mapped from permissions to TrackSource | ✅ plus simulcast and bitrate caps on the client, and live permission updates for speaker seats |
| A6 | Feature flags `FEATURE_*` (chat, reactions, mute, deviceIcons, schedule, content, moderation, waitingRoom, raisedHand, activity, recording, templates, diagnostics) | ✅ all kept. `content` now defaults ON (presentation mode) |
| A7 | Postgres via `DATABASE_URL`, SQLite fallback | ♻️ Postgres is the out-of-the-box DB, with versioned SQL migrations that run on start. Old SQLite data can be imported with `npm run migrate:sqlite-to-pg` |
| A8 | Cleanup loop that kills meetings idle for 12h | ✅ |
| A9 | Startup warnings for missing secrets | ✅ extended |
| A10 | Dockerfile (Debian slim) | ✅ Alpine multi-stage with no native build, lean image |

## B. Accounts and auth
| # | Feature | 1venue |
|---|---|---|
| B1 | Collab Accounts SSO login proxy `/api/accounts/login` and `/api/login` (sends `{email,password}`) | ✅ |
| B2 | Accounts signup proxy `/api/accounts/signup` | ✅ |
| B3 | Local signup and login (bcrypt, JWT 30d) | ✅ kept as fallback |
| B4 | Bearer token check order: local JWT, then Accounts JWT (shared secret), then Accounts `/auth/me` | ✅ also reads the shared `access_token` cookie on `COOKIE_DOMAIN`, can silently refresh, and supports `/auth/session` |
| B5 | Accounts users mapped to local users (`ensureAccountsUser`) | ✅ |
| B6 | `/api/me`, logout | ✅ plus a hosted login redirect `ACCOUNTS_URL/login?next=` and logout `ACCOUNTS_URL/logout?next=` |
| B7 | Guest display-name validation | ✅ |

## C. Meetings core
| # | Feature | 1venue |
|---|---|---|
| C1 | Create meeting (name, host name, template, advanced settings) | ✅ redesigned create sheet |
| C2 | Codes `ABC-123` (no I/O/0/1), join by split letter/number inputs | ✅ one smart code input that also accepts pasted links |
| C3 | Invite link `/ABC-123?key=` with `inviteAccess` anyone or approval ("Require invitation link") | ✅ |
| C4 | Regenerate the invite key | ✅ |
| C5 | Join rules: invite key, block list, lock, guest access, max participants, rejoin, waiting room, membership | ✅ (cap now `MAX_PARTICIPANTS`, default 100) |
| C6 | Waiting room for guests, with admit, decline, admit-all and decline-all | ✅ |
| C7 | Rejoin after reload (session in localStorage, `/ABC-123` deep link) | ✅ |
| C8 | Leave (meeting ends when empty) and end for everyone | ✅ |
| C9 | Meeting timer and duration clock | ✅ |
| C10 | Templates: blank, research, classroom, team, interview, presentation | ✅ plus sermon, talk show and seminar |
| C11 | Scheduled meetings: create, list, delete, start | ✅ these become Events with discovery |
| C12 | Meeting history list and detail (participants, artifact, recordings) | ✅ dashboard "Past" tab |
| C13 | Meeting artifacts page `/m/{code}/{slug}` with chat, activity, recordings, participants, personal note, and restart | ✅ plus transcripts, AI summary and downloads |
| C14 | Breakout rooms: 2–10 rooms, move, close (LiveKit `CODE-bo-N`) | ✅ |
| C15 | Activity log (DB plus live ring buffer) and activity drawer | ✅ |
| C16 | Diagnostics and connection panel (WS state, LiveKit state) | ✅ |
| C17 | Device icons (mobile, tablet, desktop) per participant | ✅ |

## D. Media
| # | Feature | 1venue |
|---|---|---|
| D1 | Microphone toggle with echo cancellation, noise suppression and AGC | ✅ |
| D2 | Pre-join mic picker, mic picker modal, preferred mic saved, refresh mics | ✅ |
| D3 | Camera toggle | ✅ simulcast, capped at 540p/720p |
| D4 | Screen share with quality presets (auto, high, medium, low send, plus view quality), bitrate ladder | ✅ default caps reduced for a tight server, and a "text" vs "motion" content hint |
| D5 | Force-stop another person's share (host) | ✅ |
| D6 | Background blur (CSS) | ✅ |
| D7 | Picture-in-picture (video PiP first, Document PiP fallback, auto PiP on tab hide) | ♻️ Document PiP first with live controls, video PiP as fallback |
| D8 | Fullscreen app or stage | ✅ |
| D9 | Big stage view plus cards, spotlight on click | ✅ grid, spotlight and speaker views |
| D10 | Idle stage with clock and typewriter motivators (fun, faith, motivation) | ✅ |
| D11 | Join cue and ring sounds | ✅ |

## E. Moderation and permissions
| # | Feature | 1venue |
|---|---|---|
| E1 | Roles: host, cohost, participant and guest | ✅ plus speaker and audience in events |
| E2 | Set role, transfer host | ✅ |
| E3 | Remove participant, with optional block on rejoin | ✅ |
| E4 | Mute participant, mute all, ask to unmute, allow unmute, ask to choose mic | ✅ |
| E5 | Per-user permission overrides (mic, screen, camera, chat) | ✅ |
| E6 | Security panel: waiting room, guest access, lock, share, mic, cam, chat, reactions, raise hand, invite rights | ✅ |
| E7 | Set max participants | ✅ |
| E8 | Raise or lower hand, lower all, raised-hands panel | ✅ |
| E9 | Ring all and ring a participant (with ring overlay) | ✅ |

## F. Chat and communication
| # | Feature | 1venue |
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
| # | Feature | 1venue |
|---|---|---|
| G1 | Content share: URL, PDF (pdf.js), local video, uniform or free scroll, remote handoff and claim | ✅ presentation mode |
| G2 | Screen timeline: up to 10 images, slideshow and selection (host and cohost) | ✅ |
| G3 | Whiteboard: pens, brush, eraser, text boxes, select and move, undo and redo, multiple boards, follow active board, share as a video track, export and import `.mwb`, autosave | ♻️ now personal per user. Others can only view when you share. Tools, boards and `.mwb` are kept |
| G4 | Live notes (autosave to localStorage), personal note on the artifact (server), export notes, local "summary" box | ✅ server autosave, transcript insertion, AI summary |
| G5 | Recording: host start, pause, resume, stop. Each client captures locally (MediaRecorder) and downloads; options for audio, video, screen and chat | ✅ stays client-side |

## H. UI and UX
| # | Feature | 1venue |
|---|---|---|
| H1 | Light and dark theme toggle | ✅ plus accent themes and a font-size setting |
| H2 | Keyboard shortcuts: M mic, S share, H hand, K shortcuts, C chat, V camera | ✅ (↑/↓ UI scale removed, as requested) |
| H3 | UI scale up/down and zoom banner | ♻️ removed on purpose (requirement 15) and replaced by a font-size setting and a proper viewport |
| H4 | Mobile layout: more menu, people and chat sheets, orientation handling, dynamic panes, nav badges | ✅ rebuilt as native-feeling bottom nav and sheets |
| H5 | Landing page: hero, typewriter demo, create and join cards, steps | ✅ redesigned |
| H6 | Toasts and notifications | ✅ |
| H7 | Copy code, share link, copy invite | ✅ plus a QR code |
