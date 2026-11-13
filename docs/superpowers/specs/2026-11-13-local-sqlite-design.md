# Local SQLite support for 1venue

## Intent

Let a developer run and test the complete 1venue application locally without installing or connecting to PostgreSQL. The local database starts empty. PostgreSQL remains the deployment database and keeps its existing migrations and behavior.

## Goals

- One explicit local setting selects SQLite; the deployment default remains PostgreSQL.
- Local startup creates a persistent SQLite file and all tables needed by current features.
- The same HTTP, WebSocket, room, and client flows work with either database: accounts, events and discovery, venues, social features, moderation artifacts, chat and DMs, polls and Q&A, transcripts, AI summaries, scripture cache, whiteboards, materials, attendance, and history.
- Both drivers preserve the data API used by routes and plugins, including transactions, returned rows, and affected row counts.
- Local tests run without an external database; tests exercise representative reads and writes across each feature family and both direct database calls and HTTP flows.
- Local setup is documented with a single command and a clear reset procedure.

## Constraints and non-goals

- No existing PostgreSQL data must be imported. The SQLite database may start empty.
- This does not change production to SQLite or replace the production Docker Compose PostgreSQL service.
- SQLite is intended for one local app process and a local file. Multi-instance SQLite deployment is out of scope.
- LiveKit, Collab Accounts, external AI/STT, and presentation conversion remain separate dependencies. The database switch must not pretend those integrations have been tested when they are absent.
- Do not alter the three pre-existing edits in `scripts/livekit-check.js`, `scripts/migrate-sqlite-to-pg.js`, or `scripts/migrate.js` unless a later implementation step truly requires it; inspect their diffs first.

## Approaches considered

1. **Full local SQLite backend (chosen).** Keep the application API and PostgreSQL production path, add a SQLite schema and driver, and adapt PostgreSQL-only queries. More work, but local feature tests have meaningful coverage.
2. **Limited SQLite smoke mode.** Implement only a few tables and routes. Faster, but it fails the requirement to test every aspect locally.
3. **PostgreSQL container for local work.** Least code change, but conflicts with the request to avoid a local PostgreSQL database.

## Proposed design

### Selecting and opening the database

Use `DB_DRIVER=sqlite` only when selected explicitly; otherwise retain `postgres`. For local SQLite, use `SQLITE_PATH` with a default such as `./data/venue.sqlite`. The app creates the parent directory. Keep the file under ignored `data/`. Configure foreign keys, a busy timeout, and WAL mode. Report the selected driver and file path on startup without exposing secrets. If SQLite is selected with a missing driver, fail clearly instead of falling back to PostgreSQL.

The local SQLite package can be a development dependency because production Docker installs production dependencies only and keeps the PostgreSQL path. Do not require the SQLite package unless SQLite mode is selected.

### Data layer and schema

Preserve the exported `db.js` API. Keep the PostgreSQL implementation and numbered SQL migrations unchanged. Add a SQLite implementation with its own versioned schema/migrations and a small adapter that returns `{ rows, rowCount }` and supports `tx(fn)` with a `query` method. Transactions must remain atomic; nested or async calls must be designed so they cannot silently escape a transaction.

Port the complete schema, including the latest venue, materials, attendance, and speaker fields. Convert PostgreSQL types and operations deliberately: timestamps to ISO-compatible text, booleans to 0/1, arrays and JSONB to JSON text, and identity columns to SQLite integer primary keys. Enable foreign keys. Normalize SQLite rows at the data boundary so existing callers receive JavaScript booleans, objects, arrays, and timestamps in the same shapes as PostgreSQL.

Do not rely on a blanket SQL regex rewrite. Share straightforward parameterized statements where SQLite supports their syntax, and use explicit SQLite variants for PostgreSQL-only queries. Key examples already found: `ILIKE`, `ANY(tags)`, `pg_trgm`, `tsvector` search, JSONB update functions, casts, `generate_series`, date arithmetic, and `IS DISTINCT FROM`. Preserve event discovery with SQLite FTS5 or another indexed search strategy and a documented fuzzy-search approximation. Preserve Q&A answer editing and dashboard counts through SQLite-specific queries.

### App and developer workflow

Add a local script such as `npm run dev:sqlite` that sets the driver and starts the app. Update `.env.example` and the README with the SQLite path, how to reset the empty local database, and the fact that PostgreSQL remains production. Continue to use `AI_MOCK=true` for deterministic AI checks. Local account signup should work without Collab Accounts; document how to use it. Keep uploads in local storage and document that LiveKit is still needed for actual audio/video.

### Verification

Run a SQLite test process with a temporary database. Cover schema creation and upgrade, local signup/login, event creation/discovery/RSVP, venue opening, room create/join/leave, chat and history, polls/Q&A, transcript and summary storage, scripture cache, whiteboards, materials, uploads, and attendance. Exercise the existing HTTP tests against SQLite instead of allowing them to skip. Run existing unit/presentation tests. Run a production-path PostgreSQL test when a reachable PostgreSQL service is available; otherwise report that as unverified. Check the final git diff to ensure unrelated pre-existing edits are untouched.

## Important behavior to preserve

Active room state is in memory and ends on server restart. SQLite changes lasting data only. Browser service-worker caches and external LiveKit/AI/STT services remain separate from the database. A test of local database parity is not proof of those external integrations.
