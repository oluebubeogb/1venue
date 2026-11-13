# Local SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run and test every database-backed 1venue feature locally with SQLite while retaining PostgreSQL for deployment.

**Architecture:** Select a database backend explicitly. Keep PostgreSQL queries and migrations as the production source, and add a SQLite schema, adapter, and explicit dialect variants for incompatible queries. Exercise all feature families with SQLite integration tests.

**Tech Stack:** Node 22, CommonJS, `pg`, `better-sqlite3`, Node test runner, SQLite JSON1/FTS5.

**Spec:** `docs/superpowers/specs/2026-11-13-local-sqlite-design.md`

## Global Constraints

- PostgreSQL remains the default and production database.
- SQLite starts empty in an ignored local file and requires no external service.
- Keep the public `db.js` interface and application response shapes stable.
- Do not touch the three pre-existing modified scripts unless essential.
- External LiveKit, Accounts, AI, STT, and LibreOffice still require separate verification.

## Review Focus

- Repeated `$n` placeholders: bind the same value at every use without shifting later parameters.
- JSON and arrays: read back as objects/arrays, including empty values and edited Q&A answers.
- Timestamps and booleans: keep API shapes and ordering consistent across backends.
- Transaction failure: roll back all writes and release the connection state.
- Startup with an invalid SQLite path or absent driver: fail clearly without touching PostgreSQL.

---

### Task 1: SQLite driver and full schema

**Files:** Create `src/db/sqlite.js`, `migrations/sqlite/*.sql`, `test/sqlite-db.test.js`; modify `db.js`, `package.json`, `package-lock.json`.

**Interfaces:** `db.js` exports the existing functions plus backend selection; SQLite `q(sql, params)` returns `{rows,rowCount}` and `tx(fn)` passes a query-capable transaction client.

- [ ] Add failing tests for empty-file migration, latest tables, repeated placeholders, JSON/boolean/timestamp row shapes, transaction rollback, and invalid path.
- [ ] Run `node --test test/sqlite-db.test.js` and confirm the failures.
- [ ] Add the SQLite development dependency, versioned schema, and driver; dispatch from `db.js` when `DB_DRIVER=sqlite`.
- [ ] Run the SQLite driver tests and existing unit tests; fix until passing.
- [ ] Commit this self-contained database layer.

### Task 2: PostgreSQL-specific data queries

**Files:** Modify `db.js`, `src/venue/data.js`, and any other file containing PostgreSQL-only SQL; test `test/sqlite-features.test.js`.

**Interfaces:** Public data functions and their returned object shapes remain unchanged; dialect-specific SQL is explicit and parameterized.

- [ ] Add failing tests for account, event/discovery, venue, social, poll/Q&A, transcript, dashboard, whiteboard, materials, scripture cache, and attendance data operations.
- [ ] Run `node --test test/sqlite-features.test.js` and confirm feature failures.
- [ ] Replace incompatible SQL with explicit SQLite variants or shared portable SQL; preserve indexed event search and result ordering.
- [ ] Run database feature tests and existing unit tests; fix until passing.
- [ ] Commit query parity changes.

### Task 3: Local workflow and HTTP/room verification

**Files:** Modify `package.json`, `.env.example`, `README.md`, `test/http.test.js`; add targeted SQLite integration tests where HTTP coverage is missing.

**Interfaces:** `npm run dev:sqlite` starts with an ignored local database; HTTP tests can boot a temporary SQLite server.

- [ ] Add failing HTTP tests for local signup, event and venue flow, room create/join/leave, chat/history, files, transcripts, materials, and attendance.
- [ ] Run the HTTP suite in SQLite mode and record failures.
- [ ] Finish configuration and local documentation, including reset steps and external-service limits.
- [ ] Run all tests in SQLite mode, run the app against a fresh file, and check PostgreSQL startup selection without a PostgreSQL service.
- [ ] Commit verified local workflow and tests.

### Task 4: Final verification

**Files:** Any implementation files needed to fix failures only.

- [ ] Run `npm test` in the standard environment and in SQLite mode; count passes, failures, skips.
- [ ] Verify the production Docker path still installs without the SQLite development dependency.
- [ ] Review diff and status for unrelated changes; report any PostgreSQL integration tests that could not run.
