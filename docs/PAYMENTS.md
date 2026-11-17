# Credit wallets and Paystack

## What this increment does

Signed-in users have a spending wallet at `/wallet`, also available in the account menu, Settings and the command bar. Buy 10, 30, 60 or 120 credits, or enter a positive whole-credit amount. Every credit costs NGN 500; there are no bundle discounts or expiry dates. Credits are issued only after server verification. The page shows the balance, purchase status and paginated credit history, including negative meeting-usage entries. Signed-in users also see their balance in the navbar and meeting header. A purchase can be checked again after a network interruption, without buying twice.

Host-funded meeting billing is now active for newly opened non-venue meetings. Paid admission, the 80/20 earnings split, proportional meeting refunds, earnings transfers and venue funding rules remain deferred. The agreed rules and remaining scope are recorded in `superpowers/specs/2026-11-16-credit-wallet-design.md`.

## Host-funded live rooms

New ad-hoc, event and scheduled meeting openings require a signed-in host with at least **30 credits**. Scheduling or drafting an event is free. Charging starts at room opening, including time waiting for attendees, at **1 credit per minute**. One billable room per host is enforced in the database. Attendees join host-funded rooms without paying, including guests when allowed.

The host sees a persistent low-credit notice at **10 credits or below**. A top-up above that threshold clears the notice. The room ends when the wallet reaches zero, and the remaining fraction of time is capped at the funded instant. A payment arriving after exhaustion does not revive the ended session. Each posted debit is visible in credit history. The server reconciles balances on reads and periodically (every five seconds, with a one-second deadline check).

Navbar balances refresh every five seconds while the page is visible and on login, wallet refresh, focus and visibility return. In-room wallet links open a separate tab so a top-up does not leave the call. Guests do not see a wallet badge. An unavailable balance is shown as unavailable, rather than zero.

Leaving while other participants remain does not stop billing; use **End for everyone** to close the room. The existing last-participant/inactivity rules also end and settle it. Minimum balance is checked only at opening, not on refresh or reconnect. Permanent venues retain their existing behavior because their billing rules are deferred; only server-resolved, authorized venues qualify.

### Restarts, crashes and media closure

A graceful restart snapshots the application room and resumes the same durable billing session; LiveKit can keep media running, so elapsed restart time is charged. The existing snapshot restore limit remains in effect: an expired snapshot settles to its timestamp plus `MEETING_RESTORE_MAX_MINUTES`. If a process dies without a usable snapshot, recovery closes at its last durable billing checkpoint and does not bill an unavailable-state gap. Workers heartbeat every second; an ungraceful loss may take 15 seconds to be recognized. A room exhausted during downtime cannot restore or receive new media tokens.

Billing and room ownership are locked in the database, including when a restored snapshot is consumed. PostgreSQL rolling-worker overlap cannot double debit a checkpoint or let a stale worker end an adopted session. This preserves the existing single application-room-owner model; it does not add a general multi-server room-routing architecture.

Application closure is followed by deletion of the recorded LiveKit main and breakout rooms. New billable media uses a session-specific opaque namespace and short, funded-lifetime tokens. A short token expiry alone cannot disconnect active participants. Failed deletion is durably retried without further charges, and retired namespaces remain recorded so periodic LiveKit room sweeps can remove media recreated with cached/refreshed self-hosted tokens even after the initial retry window. LiveKit API availability is required for immediate media termination; accounting/joins/token checks remain closed while cleanup retries. Initial unsuccessful cleanup keeps the payer slot reserved until media closure is confirmed.

SDK references: [room deletion](https://docs.livekit.io/reference/other/roomservice-api/) and [token lifetimes and self-hosted revocation limits](https://docs.livekit.io/frontends/reference/tokens-grants/). Media calls have a three-second request timeout and run separately from accounting jobs.

### Deployment and local testing

Equivalent SQLite and PostgreSQL migrations run at startup. Existing payment/ledger entries are preserved. Rooms/snapshots created before billing was introduced remain unmetered for their existing session; no historical usage is charged and no anonymous payer is invented. Newly opened non-venue sessions follow the new rules. This is a temporary deployment compatibility behavior, not a client-selectable exemption.

Use Paystack **test** purchases in an isolated local database to fund your testing wallet; no manual credit-grant endpoint is exposed. Automated tests fund isolated fixtures explicitly and use injected media clients without contacting real LiveKit. Before public collection, verify actual Paystack checkout and LiveKit main/breakout closure against your sandbox/development infrastructure.

## Configure Paystack

1. Use a separate test database for test credentials. Run `npm run dev:sqlite` locally; do not carry test wallet balances into a live database. Production refuses `sk_test_` checkout.
2. Set `PUBLIC_URL` to the app URL. Local test mode accepts `http://localhost:3000`; live mode requires HTTPS.
3. Set `PAYSTACK_SECRET_KEY` to the appropriate test/live secret. The key stays on the server. Hosted checkout does not need a browser public key or SDK.
4. In the Paystack dashboard, enable **Settings → Preferences → Transaction fees → Pass fees to customers**. Then set `PAYSTACK_PASS_FEES_CONFIRMED=true` in 1venue. Purchases are disabled until this is explicitly confirmed. The application sends the credit price once; Paystack adds and displays its processing fee. Do not also mark up the application price.
5. Set the webhook URL to `https://your-domain/payments/paystack/webhook`. For local webhooks, expose the test server through your usual development tunnel. A browser returning to `/wallet?reference=...` also triggers a server verification, so a missed redirect or webhook does not force another purchase.
6. Configure a Paystack signing secret and set `PAYSTACK_WEBHOOK_SECRET=whsec_...` to require the modern `Paystack-Signature` format. The server checks raw bytes, HMAC-SHA512 and a 300-second timestamp tolerance. Without this setting it supports the older `x-paystack-signature` signed by the API secret. When a modern secret is configured, an older signature cannot bypass it. Keep server time synchronized.
7. Test a small purchase with Paystack test credentials before supplying live keys. Check that the gateway's `requested_amount` is the credit price and that the confirmed amount minus fees covers it. If verification data differs, the payment is marked for review and does not issue credits. The actual merchant checkout/fee response must be checked in your account before going live; automated tests use a mock provider.

The callback URL is always generated by the server. A return URL, posted status, screenshot or unsigned notification never grants credits. Webhook processing verifies the transaction through Paystack and durably settles it before acknowledging success; temporary failures produce a retryable response. Unknown references and unrelated signed events receive a harmless acknowledgement. An interrupted initialization remains pending because the provider may have accepted it. If repeated checks cannot find it, support must reconcile the reference with Paystack; there is no automatic cancellation that could race a late payment.

## Money, records and account deletion

Money is integer kobo. Credits are integer units internally (60,000 units per credit). At one credit per minute, elapsed milliseconds map exactly to units, so 90 seconds costs 1.5 credits without rounding up each minute. The wallet row, payment status and purchase ledger update in one transaction. Unique provider transaction IDs, references and one ledger entry per purchase prevent double crediting across retries or simultaneous callbacks. The price, payer email and provider mode are captured at checkout so later account changes do not alter what was purchased.

An account with purchased credits, unresolved purchases or an active/closing billable room cannot be deleted through account settings or seed-data cleanup: this prevents silently discarding funds or orphaning a checkout. The deletion response asks the user to resolve the balance/purchases or contact support. Account deletion with no credit balance or unresolved purchase continues to work. Cash refunds and chargeback handling need their own agreed workflow before public collection is enabled. Retain the payment/ledger history for reconciliation; do not delete payment rows to change balances.

## Endpoints

- `GET /api/wallet`: reconciled private balance, caller-owned active billing status, bundles and purchase availability.
- `POST /api/wallet/quote` with `{ "credits": 30 }`: authoritative price and fee disclosure.
- `POST /api/wallet/checkout`: same body; returns a new reference and Paystack authorization URL.
- `GET /api/wallet/payments?before=<id>`: private purchase attempts, 50 records per page, including unresolved ones.
- `POST /api/wallet/payments/:reference/verify`: owner-only verification/retry.
- `GET /api/wallet/transactions?before=<id>`: private credit history, 30 records per page.
- `POST /payments/paystack/webhook`: raw signed provider notification; outside the general API IP limit.

## Test

`npm run test:sqlite` runs local tests without real payments. `DATABASE_URL=... node --test test/wallet.test.js` runs the same wallet integration tests on PostgreSQL. Tests cover forged/stale/downgraded signatures, pending/failed and mismatched payments, cross-account access, concurrent/repeated settlement, provider transaction reuse, failed initialization, recovery, and funded-account deletion protection. Additional host-billing tests cover concurrency, exact proportional usage, exhaustion, top-ups, ledger consistency, lost/expired/valid snapshots, ownership fencing, media cleanup retry/sweeping, minimum opening funds and free guest joining. Credit-store tests cover failed reads and stale account responses. No production credentials or real charges are used.

Official references (checked 2026-11-16):
- https://paystack.com/docs/payments/accept-payments/
- https://paystack.com/docs/api/transaction/
- https://paystack.com/docs/payments/webhooks/
- https://support.paystack.com/en/articles/2130306

## Testing with a Paystack-compatible sandbox (Bannk)

Set `PAYSTACK_BASE_URL=https://bannk.beuden.com.ng` and use a Bannk `sk_test_...` key as `PAYSTACK_SECRET_KEY`.
A sandbox base URL must be https and is only accepted with an `sk_test_` key, so it also works when `NODE_ENV=production`.
The sandbox's own checkout origin is then accepted as the authorization URL. Leave `PAYSTACK_WEBHOOK_SECRET` empty:
Bannk signs webhooks with the legacy `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key).
For real Paystack, remove `PAYSTACK_BASE_URL` and use your real keys.


## Plans and subscriptions

Plan subscriptions, renewals and short-link add-ons share this Paystack setup and webhook. See `docs/PLANS-BILLING.md`.
