# Contributing to 1venue

The codebase is split so that each developer can own a feature folder and rarely touch the same
files as anyone else. Read `docs/ARCHITECTURE.md` once; this page is the day-to-day workflow.

## Setup

```bash
npm install
# a local Postgres (Docker is easiest)
docker run -d --name venue-pg -e POSTGRES_USER=venue -e POSTGRES_PASSWORD=venue -e POSTGRES_DB=venue -p 5432:5432 postgres:16-alpine
cp .env.example .env            # never commit .env
DATABASE_URL=postgres://venue:venue@localhost:5432/venue AI_MOCK=true npm run dev
```

Tests: `DATABASE_URL=postgres://venue:venue@localhost:5432/venue npm test`
(without `DATABASE_URL` the DB-backed suites are skipped, not failed). CI runs the same thing
against a fresh Postgres on every pull request.

## Branches and pull requests

* `main` deploys to production (Coolify builds on every push). Never push to it directly:
  open a pull request and get it reviewed and green.
* Branch names: `feat/<feature>-<what>`, `fix/<feature>-<what>`, `chore/<what>`.
* Keep PRs small and inside your feature folder where possible. A PR that touches
  `src/core/`, `src/ws/`, `src/rooms/`, `db.js`, `public/js/room/room.js` or `public/css/app.css`
  needs a lead review (see `.github/CODEOWNERS`).
* Rebase on `main` before asking for review (`git pull --rebase origin main`).

## Working on a feature

Everything for a feature lives in `src/features/<feature>/`:

| You want to… | Edit |
|---|---|
| handle a room WebSocket message on the server | `ws.js` |
| add a JSON API endpoint | `routes.js` |
| stream a file or serve a non-`/api` path | `http.js` |
| add a query | `data.js` |
| change the schema | `npm run migration:new -- <name> --feature <feature>` |
| react to a room message in the browser | `client/ws.js` (`onMessage`) |
| style it | `client/<name>.css`, class names prefixed with the feature |

New feature: `cp -r src/features/_template src/features/<feature>`, set `id` in `index.js` to the
folder name, pick an `order`, and delete the files you do not need. It is picked up
automatically; there is no list to edit.

## Rules that keep merges painless

1. **Migrations are append-only.** Never edit a migration that has been merged; add a new one.
   Always create it with `npm run migration:new` (UTC timestamp, so two branches never clash).
   Write migrations that are safe on a database that already has data
   (`IF NOT EXISTS`, defaults for new `NOT NULL` columns).
2. **Message types and API paths are owned by one feature.** Prefix new ones with the feature
   (`poll-…`, `/api/polls/…`). `test/structure.test.js` fails if two features claim the same
   browser message type or the same route.
3. **Don't reach into another feature's files.** Use its `data.js` exports, or ask its owner to
   expose what you need.
4. **New env vars** go in `src/config.js` (with a safe default) and `.env.example` (documented).
   Never commit secrets; `.env` is git-ignored.
5. **Behaviour flags:** a risky change can ship behind an env var defaulting to the old
   behaviour.
6. **Keep room state small.** Everything in a live meeting is held in memory and saved on
   restart. Cap any list you add (see `MEMORY` in `src/config.js`) and make it JSON-friendly
   (Maps and Sets are fine; functions and timers are dropped on restart).
7. **Front end:** no build step. Use ES modules and import shared code by absolute path
   (`/js/ui.js`, `/js/room/registry.js`) so every module shares one instance.

## Before you open a PR

```bash
npm test                         # with DATABASE_URL set
node --check path/to/changed.js
```

and click through the feature in two browsers (one host, one guest) if it touches a room.
