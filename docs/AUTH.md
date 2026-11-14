# Accounts and sign-in

1venue has its own accounts: email + password, or Continue with Google. Sessions use host-only
cookies and everything is driven by `PUBLIC_URL`, so the app can live on any domain.

Code: `src/lib/auth.js` (sessions, cookies, password hashing), `src/features/auth/` (routes,
Google sign-in, data, migrations) and `src/features/mail/` (SMTP sender and email templates).
Pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, and
**Settings → Account**.

## How it works

### Sessions and cookies

* Signing in creates a row in `auth_sessions` and sets two cookies:
  * `__Host-1v_at`: a short-lived access token (JWT, `AUTH_ACCESS_TTL_MIN`, default 15 min),
    signed with `JWT_SECRET`. It names its session, and the server checks that the session is
    still live (cached for 30 s), so signing out takes effect right away.
  * `__Host-1v_rt`: a random refresh token (32 bytes). Only its SHA-256 hash is stored.
* Both cookies are `HttpOnly; Secure; SameSite=Lax; Path=/` with **no Domain**, so they belong
  to the exact host only (the `__Host-` prefix makes browsers enforce that). On plain
  `http://` (local development) the names drop the prefix and `Secure`.
* When the access token runs out, the next request uses the refresh token. The refresh token is
  **rotated** every time: the old one keeps working for 60 seconds (two tabs refreshing at once),
  and any later reuse of an old token revokes the whole session, which catches a stolen cookie.
* A session ends after `AUTH_REFRESH_TTL_DAYS` (30) without use, or `AUTH_SESSION_MAX_DAYS`
  (90) after sign-in, whichever comes first.
* To sign **everyone** out (e.g. after a leak), revoke all sessions in Postgres:
  `UPDATE auth_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;`
* API clients may send the access token as `Authorization: Bearer <token>` instead of the cookie.
* Settings → Account lists every signed-in device (browser, OS, masked IP, last active). Each can
  be signed out on its own, or all at once with **Sign out everywhere**
  (`POST /api/auth/logout-all`).

### Passwords

* bcrypt with cost `BCRYPT_COST` (default 12, allowed 4–15). Minimum length `AUTH_PASSWORD_MIN`
  (default 8, never lower). Obvious ones (one repeated character, or starting with `password` / `12345678`) are refused; the maximum is 128.
* A wrong email and a wrong password get the **same** answer ("Email or password is
  incorrect."), and an unknown email still runs one bcrypt compare so the timing matches.
* **Change password** (needs the current one) signs out every other device and keeps this one.
* **Forgot password** always answers "If that email has an account, a link is on its way." The
  link is single-use, expires after `AUTH_RESET_TTL_MIN` (60), and is stored hashed. Using it
  sets the new password, confirms the email, **signs out every device**, and signs in here.

### Email verification

* Sign-up sends a confirmation link (hashed token, `AUTH_VERIFY_TTL_HOURS`, default 48).
* `AUTH_REQUIRE_VERIFIED_EMAIL=false` (default): people can use the app straight away and see a
  "Please confirm your email" banner with a resend button.
* `AUTH_REQUIRE_VERIFIED_EMAIL=true`: no session until the email is confirmed. Sign-up then
  always answers "Check your email", even when the address already has an account (that person
  gets an "you already have an account" email instead), so sign-up reveals nothing.
* **Change email** needs the current password. The link goes to the **new** address and the
  change only happens when it is opened; the old address gets a notice. The answer is the same
  whether or not the new address is taken.

### Rate limits

All sign-in endpoints share `AUTH_RATE_PER_MIN` (default 20) per IP, and some have tighter ones:
sign-up per IP, sign-in per account, forgot-password per IP and per email, resend per user,
change password/email per user. Limits are kept in memory per app process (1venue runs as one
process; restarts reset them).

### Continue with Google

OpenID Connect authorization-code flow with **PKCE (S256)**, `state` and `nonce`:

1. `GET /auth/google/start?next=/dashboard` stores state, nonce and the PKCE verifier in a
   signed, 10-minute, `HttpOnly` cookie (`__Host-1v_oauth`) and redirects to Google
   (scope `openid email profile`).
2. Google returns to `GET /auth/google/callback`. 1venue checks `state`, exchanges the code at
   Google's token endpoint (with the verifier and client secret), and verifies the ID token
   against Google's published keys (JWKS): signature (RS256), issuer `https://accounts.google.com`,
   audience = your client ID, expiry, nonce, and `email_verified`.
3. Endpoints come from Google's discovery document
   `https://accounts.google.com/.well-known/openid-configuration` (authorization
   `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`,
   keys `https://www.googleapis.com/oauth2/v3/certs`) and are cached as Google's headers allow.

Linking rules (table `oauth_identities`, one row per Google account):

* Google account already linked → sign in to that user.
* Otherwise, a user with the **same verified email** → link and sign in. If that user had never
  confirmed the email, their password is cleared and their sessions signed out (so nobody can
  pre-register someone else's address and wait); they can set a password later with
  "Forgot password".
* Otherwise → create a new user (email already verified), unless `GOOGLE_ALLOW_SIGNUP=false`.
* The button is hidden when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set.

### Accounts without a password

Some accounts have no password: Google-only sign-ups, and imported accounts that only had a
random placeholder (migration `20261113230000_local_accounts` clears that placeholder, keeps the
user row, id, profile, follows and events, and marks them `needs_password_setup`). For them:

* Trying to sign in with any password, or using **Forgot password**, emails a
  **"Set a password"** link (at most one per 10 minutes). The sign-in error also says
  "No password yet, or signed up with Google? Use Forgot password, or Continue with Google".
* **Continue with Google** with the same email links automatically.
* Migration `20261113230100_clean_collab_usernames` turns machine usernames (`accounts:…`,
  `acc_…`, `u1a2b3c4_…`) into readable ones, once.
* The `users.accounts_id` column is unused and nullable.
* Users whose stored email is a placeholder ending in `@accounts.local` cannot receive mail; they
  need Google sign-in or an admin to set their real email.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/signup` (`/api/auth/signup`) | `{name, email, password, username?}` → 201 signed in, or 202 "check your email" |
| POST | `/api/login` (`/api/auth/login`) | `{email or username, password}` |
| POST | `/api/logout` (`/api/auth/logout`) | this device |
| POST | `/api/auth/logout-all` | every device |
| GET / DELETE | `/api/auth/sessions`, `/api/auth/sessions/:id` | devices |
| GET | `/api/auth/account` | email status, password set, Google linked |
| POST | `/api/auth/verify-email`, `/api/auth/resend-verification` | |
| POST | `/api/auth/forgot`, `/api/auth/reset` | |
| POST | `/api/auth/change-password`, `/api/auth/change-email` | |
| GET | `/auth/google/start`, `/auth/google/callback` | |
| GET | `/api/session`, `/api/me`, `/api/config` | `config.auth` tells the UI what to show |

## Environment variables

| Variable | Default | |
|---|---|---|
| `PUBLIC_URL` | (required) | e.g. `https://1venue.example.com`. Email links and the Google redirect use it |
| `JWT_SECRET` | (required in production) | `openssl rand -hex 32`. Rotating it is safe: browsers renew from their refresh token |
| `ALLOW_LOCAL_SIGNUP` | `true` | email + password sign-up |
| `AUTH_ACCESS_TTL_MIN` | `15` | access token minutes |
| `AUTH_REFRESH_TTL_DAYS` | `30` | session idle limit |
| `AUTH_SESSION_MAX_DAYS` | `90` | session absolute limit |
| `BCRYPT_COST` | `12` | 4–15 |
| `AUTH_PASSWORD_MIN` | `8` | |
| `AUTH_REQUIRE_VERIFIED_EMAIL` | `false` | `true` = confirm email before using the app |
| `AUTH_VERIFY_TTL_HOURS` | `48` | |
| `AUTH_RESET_TTL_MIN` | `60` | |
| `AUTH_RATE_PER_MIN` | `20` | per IP, sign-in endpoints |
| `AUTH_COOKIE_SECURE` | auto | `true` unless `PUBLIC_URL` is `http://` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | empty = no Google button |
| `GOOGLE_ALLOW_SIGNUP` | `true` | `false` = Google only signs in existing users |
| `SMTP_HOST` | empty | empty = no email sent (links logged outside production) |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `true` only for port 465 | 587 uses STARTTLS |
| `SMTP_USER`, `SMTP_PASS` | empty | |
| `MAIL_FROM` | `1venue <no-reply@PUBLIC_URL host>` | must be a sender your provider allows |
| `MAIL_REPLY_TO` | empty | |
| `MAIL_LOG_LINKS` | on outside production | print links to the log when SMTP is unset |
| `CANONICAL_HOST` | empty | e.g. `1venue.live`: 301 every other host to it |

## Set up Continue with Google (Google Cloud Console)

1. Open <https://console.cloud.google.com/>, create (or pick) a project, e.g. "1venue".
2. Go to **Google Auth Platform** (APIs & Services → OAuth consent screen opens the same place).
   If asked, click **Get started**: app name `1venue`, a support email, audience **External**,
   a contact email, accept the policy, **Create**.
3. **Branding**: app logo (optional), home page `https://1venue.live`, privacy policy
   `https://1venue.live/privacy`, terms of service `https://1venue.live/terms`, and under
   **Authorized domains** add `1venue.live`.
4. **Data access**: the default `openid`, `email` and `profile` scopes are all 1venue needs
   (these are non-sensitive scopes).
5. **Audience**: while the app is in *Testing*, only the test users you list can sign in. Click
   **Publish app** to move it *In production* so anyone with a Google account can.
6. **Clients → Create client → Web application**, name `1venue web`:
   * Authorized JavaScript origins: `https://1venue.example.com` (your `PUBLIC_URL`).
   * Authorized redirect URIs: `${PUBLIC_URL}/auth/google/callback`, e.g.
     `https://1venue.example.com/auth/google/callback`. It must match exactly (scheme, host, no
     trailing slash). For local testing add `http://localhost:3000/auth/google/callback` too.
7. Copy the client ID and secret (the secret is only shown in full at creation) into the app's
   environment as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then redeploy.
8. Check: `/api/config` shows `"google": true` and the login page shows **Continue with Google**.
   Changes in the console can take a few minutes to apply. `redirect_uri_mismatch` means the
   URI in step 6 differs from `PUBLIC_URL`.

## Email (any SMTP provider)

1venue sends: confirm email, reset password, set password (accounts without one), welcome (Google
sign-ups), "you already have an account", and "your email was changed". Templates are in
`src/features/mail/templates.js` (HTML + plain text, branded with `APP_NAME`).

Whatever provider you choose, verify your sending domain with it (SPF and DKIM records in
Cloudflare DNS, and a DMARC record), or messages will land in spam. Port 25 is not used.
Check your provider's current plans and sending limits yourself; they change.

**Zoho Mail** (a mailbox such as `no-reply@1venue.live` on your domain):
```
SMTP_HOST=smtppro.zoho.com      # paid organisation plans; free/personal accounts use smtp.zoho.com
SMTP_PORT=465                   # or 587 (STARTTLS)
SMTP_USER=no-reply@1venue.live
SMTP_PASS=<app-specific password if two-factor is on, otherwise the mailbox password>
MAIL_FROM="1venue <no-reply@1venue.live>"
```
Accounts in other Zoho data centres use a regional host (e.g. `.eu`, `.in`); Zoho shows the exact
one under Settings → Mail Accounts.

**Gmail / Google Workspace with an app password** (fine for testing and small volumes):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465                   # or 587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-character app password; needs 2-Step Verification on the account>
MAIL_FROM="1venue <you@gmail.com>"   # Gmail rewrites other From addresses unless they are a verified alias
```

**Brevo** (transactional relay):
```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587                   # 465 for SSL, 2525 if 587 is blocked
SMTP_USER=<the SMTP login shown in Settings → SMTP & API, e.g. 1234567@smtp-brevo.com>
SMTP_PASS=<an SMTP key, not an API key>
MAIL_FROM="1venue <no-reply@1venue.live>"   # a sender/domain verified in Brevo
```

**Mailgun**:
```
SMTP_HOST=smtp.mailgun.org      # smtp.eu.mailgun.org for EU-region domains
SMTP_PORT=587
SMTP_USER=<SMTP login from Sending → Domain settings → SMTP credentials, e.g. postmaster@mg.1venue.live>
SMTP_PASS=<that SMTP password>
MAIL_FROM="1venue <no-reply@mg.1venue.live>"
```

At boot the log says `[mail] SMTP ready (host:port)` or shows why the connection failed. With no
`SMTP_HOST` outside production, every email is printed as
`[mail] (SMTP not configured) to=… subject="…" link=…`, which is handy for local testing.

## Domain-move checklist

Moving 1venue to a new domain (for 1venue.live specifics, DNS and Cloudflare, see
[DEPLOY-1venue.live.md](DEPLOY-1venue.live.md)):

1. DNS: point the new name at the app server (and `www` if used). Lower the TTL a day before.
2. Coolify: add the new domain to the app (keep the old one for a while if you want it to
   redirect), redeploy so the certificate is issued.
3. Env: `PUBLIC_URL=https://<new domain>`, `CORS_ORIGINS` (empty = `PUBLIC_URL` only),
   optionally `CANONICAL_HOST=<new domain>` so the old names and `www` 301 to it, and
   `MAIL_FROM` on the new domain.
4. Email: verify the new sending domain with your SMTP provider (SPF, DKIM, DMARC).
5. Google: add `https://<new domain>` to Authorized JavaScript origins and
   `https://<new domain>/auth/google/callback` to Authorized redirect URIs, and the domain to
   Branding → Authorized domains. Keep the old entries until the move is done.
6. LiveKit is independent of the app domain: `LIVEKIT_URL` only changes if you rename the
   LiveKit server too (e.g. `wss://rtc.1venue.live`; update `LIVEKIT_DOMAIN` in livekit-server).
7. Files: if you use R2 with a public domain, set `S3_PUBLIC_BASE_URL` (e.g.
   `https://files.1venue.live`). Files already uploaded keep working.
8. Everyone signs in again: cookies are host-only and the cookie names are new, so no session
   carries over from the old domain. Saved room links and QR codes that used the old domain keep
   working only while the old domain still points at (or redirects to) the app.
9. Tell existing users: "Sign in with Continue with Google, or use Forgot password to set a
   password."
