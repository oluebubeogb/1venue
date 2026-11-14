# Feature template

Copy this folder to start a feature:

```bash
cp -r src/features/_template src/features/myFeature
```

Then edit `index.js` (`id` must match the folder name) and delete the files you do not need.
Folders whose names start with `_` are ignored, so this template never loads.

| File | What it is | Contract |
|---|---|---|
| `index.js` | manifest | `{ id, order }` |
| `ws.js` | WebSocket plugin (server) | `{ id, register({ onWs, onRegister, ... }) }`, see `src/core/plugin-registry.js` |
| `routes.js` | JSON API | `(route, kit) => { route('GET', '/api/...', async (ctx, params) => result) }`, see `src/core/router.js` |
| `http.js` | raw HTTP (streams, non-/api paths) | `async (req, res, parsed) => true` when handled |
| `data.js` | SQL queries | plain functions using `src/core/db.js` (`q`, `tx`, `one`, `many`) |
| `migrations/` | schema | `npm run migration:new -- add_my_table --feature myFeature` |
| `client/ws.js` | browser handlers for room messages | `onMessage(type, (R, m, { roster }) => {})` |
| `client/*.css` | styles | prefixed class names only |

Run `npm test` before opening a PR; `test/structure.test.js` checks the folder conventions.
