# Host Credit Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter host-funded live meetings and show a private, current credit balance throughout navigation and meetings.
**Architecture:** Durable billing sessions and atomic wallet debits extend the existing wallet feature. Database account/session locks and unique active payer constraints enforce ownership; lifecycle jobs reconcile usage and retry media cleanup. Browser displays server values.
**Tech Stack:** Existing Node HTTP/WebSocket, PostgreSQL production, SQLite local, LiveKit server SDK, vanilla browser modules.
**Spec:** `docs/superpowers/specs/2026-11-15-host-credit-billing-design.md` (approved).

## Global Constraints

- One credit per minute, exact integer units (one wallet unit per elapsed millisecond); 30-credit opening minimum; 10-credit warning; one active billable room per host.
- Continue through short restarts. Venues, entry fees, earnings and refunds remain deferred. No production test credit grants.
- Keep this work on the existing `marvel` branch; no push/deployment. Execute inline, continuing within the approved scope.

## Review Focus

- Concurrent end/read/top-up calls must preserve ledger sums and stop exactly at exhaustion/closure.
- A stale process or expired snapshot must not revive a closed session or debit twice.
- Closed main and breakout rooms must be removed from LiveKit, with retries and rejection of tokens.
- Failures during room opening must not leave an active payer slot or history behind.
- Navbar requests finishing after account changes must not expose the previous account's balance.

### Task 1: Durable usage accounting

Files: create `src/features/wallet/billing-data.js`, PG migration `20261116150000_host_billing.sql` (sort after existing wallet schema), SQLite migration `008_host_billing.sql`, `test/host-billing.test.js`; modify wallet data/history/deletion checks.
Interfaces: `open({userId,code,name,hostName,now?}) -> {historyId,session}` atomically; `settle(historyId,{now?,endReason?}) -> session` idempotent debit and closure; `current(userId,now?) -> {balanceCredits,billing}`; `get(historyId)`, `pendingCleanup()`, `markCleaned(historyId)`.
- [x] Write failing accounting tests: 29.999/30 minimum, 90s=1.5, partial close, duplicate/concurrent settles, balance zero clamp, top-up/threshold rearm, second open, account deletion, usage history.
- [x] Run red: `DB_DRIVER=sqlite node --test test/host-billing.test.js`.
- [x] Implement migrations and APIs with account-before-session lock order. Usage ledger has null payment and non-null session, negative delta; purchase entries preserved. Session retains room/media names, checkpoint, total debit, closing/cleanup state. Opening history and claim share transaction.
- [x] Run focused SQLite tests green; commit accounting task.

### Task 2: Room lifecycle and media enforcement

Files: create `src/features/wallet/billing.js`, `src/livekit/cleanup.js`; modify room routes/lifecycle/snapshot/startup/tokens and wallet routes; tests `test/host-billing.test.js`, new `test/host-billing-http.test.js`; adapt existing room test fixtures to explicitly fund signed-in isolated hosts.
Interfaces: `billing.start({user,code,name,hostName})`, `billing.check(meeting)`, `billing.end(meeting,reason,now?)`, `billing.tick()`, `billing.recover()`, `billing.stop()`; wallet summary includes only caller's billing status. Native server timer every second, settlement every five seconds plus exact deadline checks.
- [x] Write failing HTTP/recovery tests: anonymous/insufficient/concurrent create, free guest join, trusted venue exemption, explicit end, restart under minimum, exhaustion during restart, orphan/expired cleanup and LiveKit retries.
- [x] Run red; implement room hooks, durable cleanup queue and token lifetime cap. Media room names use session-specific suffix for billable sessions so cached tokens cannot recreate a later session. Persist breakout names or derive from session namespace.
- [x] Recovery: active heartbeat per process permits overlap without treating a healthy old worker as crashed. A dead owner with no usable snapshot closes at its last durable checkpoint (no charges for unavailable state); graceful snapshots bill through restoration, with max restore window cutoff. Startup reconciles old records before accepting new opens; no retroactive billing of old unmetered rooms.
- [x] Run focused SQLite/PG tests and adjusted existing lifecycle tests green; commit integration task.

### Task 3: Navbar, meeting warning and opening UI

Files: create `public/js/credits.js`; modify app shell, wallet history, instant/new/room opening paths, meeting header/end notice, CSS and service worker.
Interfaces: credit module `subscribeCredits(fn) -> unsubscribe`, `refreshCredits()`, `setCreditUser(id|null)`; foreground polling with bounded overlap and generation guard; warning shown only for caller's active payer session.
- [x] Write tests for stale-account results, polling concurrency and warning/rearm transitions using injected fetch/timers where meaningful.
- [x] Implement shared navbar and meeting-header badges, accessible persistent low-credit notice and top-up links opening separate tabs in-room. Refresh on purchase confirmation, session changes, visibility and foreground polling. Format signed usage ledger entries and label meeting usage.
- [x] Opening UI discloses minimum/rate, preserves free venue path, offers wallet/sign-in on errors. Ending for exhaustion explains cause.
- [x] Verify syntax and available browser layouts; commit UI task.

### Task 4: Verification and delivery

Files: update `docs/PAYMENTS.md`, README, approved spec status and this plan; isolated test fixture helpers as needed.
- [x] Run `npm run test:sqlite` and temporary PostgreSQL full suite serially; inspect failures and run focused fixes.
- [x] Dispatch one fresh independent reviewer of the whole change. Address important findings with regression coverage.
- [x] Record limitations for actual LiveKit/Paystack credentials and unavailable browser tools, if applicable. Run `git diff --check`; commit final changes; report commit/test outcomes. No push.

Visual verification: browser inventory returned no apps/browsers. UI implementation and syntax/store behavior are checked; desktop/mobile visual inspection remains unavailable in this session.
