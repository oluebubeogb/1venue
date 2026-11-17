# Host credit billing and navbar balance

## Intent and agreed rules

Build the next increment on the spending wallet and verified Paystack purchases already committed on `marvel`. Hosts pay for elapsed live-room time; signed-in people can see their spending balance without opening the wallet. Venue funding rules, paid entry, earnings, and refunds remain deferred.

User-approved rules:

- One credit buys one minute; charge proportionally by elapsed time, rather than rounding each started minute up.
- Require at least 30 credits to open a billable room. Creating a future event or scheduling a meeting does not consume credits.
- Billing starts when the host opens the room, including the period before attendees arrive.
- A host can have only one billable live room at a time.
- Alert the host at 10 minutes of remaining credit. Close the room automatically when the spending balance reaches zero.
- Continue billing through short server restarts while LiveKit keeps the call running (explicitly confirmed in this conversation).
- Show the signed-in user's own balance in the navbar, linked to `/wallet`; update after purchases and during usage.

## Existing behavior and scope

`POST /api/create` opens ad-hoc, event, scheduled, and permanent-venue sessions. It currently permits anonymous hosts. Hosts of billable ad-hoc/event/scheduled meetings must now sign in because the payer must own a wallet. Joining a host-funded meeting remains free, including guest joining where the host allows it.

Permanent venues retain their existing opening and funding behavior in this increment, since venue rules were explicitly deferred. Their exemption must come from a real, authorized server-resolved venue, never a client-supplied flag. This is a scope interpretation, not a new approved venue funding policy.

Room state currently lives in memory, is snapshotted on graceful shutdown, and is restored lazily. A durable billing session must survive independently of the in-memory map. Existing room-end paths include host/admin ending, the last participant leaving, inactivity, and expired restart snapshots. All billable endings must settle the same session exactly once.

## Approaches

Use **server-owned accounting in the shared database**, extending the existing wallet feature and room lifecycle. This was proposed in the conversation and accepted together with the restart behavior. The browser only displays balances and warnings.

Browser-owned timers cannot enforce charges when the host closes or modifies the page. An external billing service would introduce another operational dependency before this application needs it. The shared database is the sensible fit for the existing PostgreSQL production and SQLite development architecture.

Implementation stays in the current Node HTTP/WebSocket server and vanilla browser modules. No new payment provider or frontend framework is needed.

## Durable accounting

Add equivalent PostgreSQL and SQLite migrations for usage sessions, debit ledger entries, and reliable cleanup state. Keep integer wallet units: 60,000 units per credit and 60,000 milliseconds per minute allow exact elapsed-millisecond accounting (one unit per millisecond). The public explanation remains proportionate time billing, including 90 seconds = 1.5 credits.

A durable session records its history identity, room code, payer, start time, accounted-through timestamp, accumulated debit, state, low-credit warning state, and end/cleanup reason. A database uniqueness constraint prevents more than one active billable session per host. The opening transaction locks the account/wallet, checks the minimum, and creates both history and billing ownership before publishing the room. Opening failures release/close the unused session and history; insufficient funds and concurrent opens must leave no live side effects.

A server job settles elapsed time at bounded intervals (target five seconds), and near exhaustion schedules/checks the deadline at least once per second. Balance reads used by the navbar/wallet reconcile current usage first, so the displayed amount includes elapsed time. Monetary writes occur in one transaction: lock payer and session consistently, calculate only the previously unaccounted interval, cap the debit at available units, update the wallet and checkpoint, and append a uniquely attributable usage ledger entry. Retries, simultaneous polls, purchases, and end requests must not double debit or produce a negative wallet.

Usage ledger entries identify the meeting session; retain purchase history and add negative usage rows to credit history. Use a LEFT JOIN or equivalent so usage entries do not disappear when they have no payment reference. Do not alter posted purchase amounts or manufacture credits for local development. Tests may explicitly fund isolated test wallets through fixtures.

Do not trust a client clock or a client-supplied balance, payer, timestamp, rate, exemption, or session state. Prevent account/seed deletion while a billable session is active, even if its last debit has exhausted the wallet but cleanup is unfinished.

## Room lifecycle and recovery

Billing continues while the room remains open, even when the host disconnects or leaves other attendees in it. The current last-participant/inactivity ending rules still apply. Explicit closure stops charges at the server-recorded end instant, including a partial final interval. The session transitions atomically so concurrent closure paths cannot bill past that instant or debit twice.

On startup and periodic recovery, reconcile durable active sessions independently of client reconnects. A graceful restart resumes the same session and checkpoints across the downtime; it must not rerun the 30-credit opening requirement or start a second session. Old and new workers may overlap during deployment; database locking/ownership must make settlement idempotent and stop a stale worker from reopening or extending a closed session.

If balance was exhausted during downtime, charge only through the funded instant, close the session, reject restore/join/new media tokens, and complete room cleanup after startup. Preserve the existing maximum snapshot restore window for abandoned rooms; reconcile expired sessions to their deterministic closure cutoff instead of charging indefinitely for an unrecoverable application session. Unexpected crashes with no usable snapshot require explicit recovery of the billing record and media termination, not silently dropping a charged session or holding the host's active-session slot forever. Document the chosen crash cutoff and test it.

Exhaustion closes both the application room and its LiveKit main/breakout rooms. Sending a WebSocket event alone is insufficient because media can continue independently. Persist failed media cleanup and retry it; an unavailable LiveKit API must not grant new tokens or resume billing a closed room. Reuse SDK room administration patterns already present in the project, and verify current SDK semantics before implementation. New media tokens for billable sessions must respect their funded lifetime and cannot offer an unrestricted six-hour continuation after wallet exhaustion.

Keep permanent-venue room endings separate from billable wallet settlement while retaining their existing cleanup behavior.

## Warnings and UI

The host sees a persistent low-credit notice when remaining balance crosses 10 credits; notify the payer rather than other participants. Reconnecting under the threshold shows the current warning again without repeating a toast on every poll. A successful top-up above the threshold clears/rearms the warning. The closing message explains when credits have run out and provides a route back to the wallet.

Add a compact, accessible credit balance next to the account control in the shared navbar on desktop and mobile. It links to `/wallet`, formats fractional balances without suggesting full-minute rounding, and never exposes anyone else's wallet. Signed-out people do not see a balance; errors display an unavailable state, never a false zero. Refresh on login/logout, wallet purchase verification, page visibility return, and a modest foreground polling interval; prevent overlapping polling and stale results from a previous account.

The meeting UI replaces the shared shell with its own header, so the signed-in user should also have an appropriate balance entry there. Only the paying host receives usage warnings; another signed-in participant may view their own balance without seeing the host's funds. Opening screens explain 1 credit/minute and the 30-credit minimum, with an actionable wallet link for insufficient funds. Do not navigate a live host away from the call merely to view/top up the wallet.

Builder choices: exact badge styling and polling cadence should fit the existing header space, shared components and reduced-motion/accessibility conventions. No broad navigation redesign.

## Verification and rollout

Use meaningful tests with a controllable server clock/accounting timestamp, not minute-long sleeps. Cover opening at 29.999 versus 30 credits, unauthenticated hosts, concurrent starts, event/scheduled starts, venue exemption authorization, exact 90-second debit, partial endings, repeated settlement, wallet top-ups, zero clamping, one-active-session enforcement, warning threshold/rearm, and all termination paths.

Exercise graceful restart, exhaustion during downtime, overlapping workers/checkpoints, expired and absent snapshots, failed database writes, and retryable media deletion. Assert ledger sums agree with balances and charges cease at closure. Test private balance responses and navbar lifecycle behavior. Run SQLite and disposable PostgreSQL suites, meaningful regression checks, syntax checks, and independent code review. Use available browser tools for narrow/desktop layouts if supported; otherwise explicitly record the visual verification limitation. Keep real user balances and credentials out of test fixtures.

This changes who can open non-venue rooms and makes those openings consume credits. Document deployment/migration behavior for pre-existing rooms: do not retrospectively bill historical sessions or silently invent a payer for an anonymous live room. Freshly opened sessions use the new rules; explicitly surface any temporary grandfathering needed for a running deployment. No push or deployment is included.

## Status

Independent builder check completed: no important unanswered questions. User approved the design. Implementation complete. Final verification passed on SQLite (187 passed, 5 skipped) and PostgreSQL (186 passed, 6 skipped). An independent review found two important lifecycle gaps; both were fixed with regression coverage. Browser-based visual inspection was unavailable, so responsive layout was checked statically and through layout assertions.
