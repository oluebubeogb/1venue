# Features

One folder per feature. Everything a feature needs (server WebSocket plugin, JSON API, raw HTTP
handlers, SQL queries, migrations, browser message handlers, CSS) lives in its folder and is
discovered automatically by `src/core/features.js`.

Start a new feature by copying `_template/` (see its README). The full contract and the list
of features with their load order are in `docs/ARCHITECTURE.md`; the team workflow is in
`CONTRIBUTING.md`.

Quick reference:

| File | Loaded by | Contract |
|---|---|---|
| `index.js` | `src/core/features.js` | `{ id, order }` |
| `ws.js` | `src/core/plugin-registry.js` | `{ id, register(ctx) }`, `ctx.onWs(type, ({ msg, participantId, meeting, meetingCode, ws }) => {})` |
| `routes.js` | `src/core/router.js` | `(route, kit) => route(method, pattern, async (ctx, params) => result)` |
| `http.js` | `src/http/routes.js` | `async (req, res, parsed) => true` when it answered |
| `data.js` | you (`require('./data')`) | plain async functions using `src/core/db.js` |
| `migrations/*.sql` | `db.js migrate()` | `npm run migration:new -- name --feature <id>` |
| `client/ws.js` | `/features/client.js` | `onMessage(type, (R, m, { roster }) => {})`; `return false` = no re-render |
| `client/*.css` | `/features/features.css` | prefix classes with the feature name |

Turn a feature's WebSocket plugin off with `FEATURE_<UPPER_SNAKE_ID>=false`
(e.g. `FEATURE_GROUP_CHAT=false`). Its HTTP routes stay on.
