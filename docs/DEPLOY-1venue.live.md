# Deploying on 1venue.live (Cloudflare DNS + Coolify)

The production names. Nothing in the code is tied to them; they are only env values.

| Name | What | Where it points | Cloudflare proxy |
|---|---|---|---|
| `1venue.live` | the app (`PUBLIC_URL=https://1venue.live`) | app VPS (Coolify) | **Proxied** (orange) OK |
| `www.1venue.live` | 301 → `https://1venue.live` | app VPS | **Proxied** (orange) |
| `rtc.1venue.live` | LiveKit signalling (`LIVEKIT_URL=wss://rtc.1venue.live`) | LiveKit VPS | **DNS only** (grey) |
| `turn.1venue.live` | LiveKit TURN (optional TURN/TLS) | LiveKit VPS | **DNS only** (grey) |
| `files.1venue.live` | R2 public files (`S3_PUBLIC_BASE_URL=https://files.1venue.live`) | R2 bucket custom domain | managed by R2 |

## 1. DNS records (Cloudflare → your zone → DNS → Records)

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `@` (1venue.live) | app VPS IPv4 | Proxied |
| A | `www` | app VPS IPv4 | Proxied |
| A | `rtc` | LiveKit VPS IPv4 | DNS only |
| A | `turn` | LiveKit VPS IPv4 | DNS only |
| (auto) | `files` | created by R2 in step 4 | — |

Add AAAA records too only if the VPS has working IPv6.

Why grey for `rtc` and `turn`: LiveKit needs direct UDP (50000–60000), TCP 7881 and UDP 3478 to
the server, and TURN/TLS is routed by SNI on port 443. Cloudflare's proxy only carries HTTP(S),
so a proxied record would break media. The LiveKit side (firewall, keys, `LIVEKIT_DOMAIN=rtc.1venue.live`,
`TURN_DOMAIN=turn.1venue.live`) is in the `livekit-server` repo README.

## 2. TLS: SSL/TLS mode **Full (strict)**

Cloudflare → SSL/TLS → Overview → **Full (strict)**. Cloudflare then talks HTTPS to Coolify and
checks its certificate, so the origin needs a valid one (Coolify's Let's Encrypt certificate is
fine). Never use *Flexible*: it sends plain HTTP to the origin and causes redirect loops.

Simplest order on a fresh setup: create the `@` and `www` records **grey** first, add the domains
in Coolify and deploy so Let's Encrypt issues the certificates, then switch both records to
**orange**. (Alternatively install a Cloudflare Origin CA certificate in Coolify.)

WebSockets work through the Cloudflare proxy on every plan, so the app's room socket and
`/api` keep working with the orange cloud. Keep `TRUST_PROXY=true`.

## 3. www → apex (pick one, or both)

**A. Cloudflare Redirect Rule (recommended; never reaches the server)**
Rules → Redirect Rules → Create rule (or the "Redirect from WWW to root" template):
* When incoming requests match: Hostname equals `www.1venue.live`
* Then: Dynamic redirect, expression `concat("https://1venue.live", http.request.uri.path)`,
  status **301**, **Preserve query string** on.
The `www` record must be proxied (orange) for the rule to run.

**B. In the app: `CANONICAL_HOST`**
* Coolify → the 1venue app → Domains: `https://1venue.live,https://www.1venue.live`.
* Env: `CANONICAL_HOST=1venue.live`.
* Any request whose host is not `1venue.live` gets a 301 to `https://1venue.live` + the same path
  and query. `/health`, `/ready`, `/api/health` and `/metrics` are never redirected (health checks keep working
  on any host). Unset = off. Behind a proxy the app reads `X-Forwarded-Host` (with
  `TRUST_PROXY=true`).

Using both is fine: the Cloudflare rule answers first, and the app catches anything that slips
past it (e.g. a grey-cloud record).

## 4. R2 public files: `files.1venue.live`

1. Cloudflare → R2 → your bucket (e.g. `1venue-uploads`) → Settings → **Custom Domains** →
   **Connect Domain** → `files.1venue.live`. The zone must be in the same Cloudflare account; R2
   creates the DNS record and certificate itself.
2. Wait until the domain shows **Active**.
3. App env: `S3_PUBLIC_BASE_URL=https://files.1venue.live` (plus the `S3_*` keys described in
   `.env.example`), and redeploy.
4. Keep the `r2.dev` public URL off; the custom domain is the public way in.

## 5. App env for this domain

```
PUBLIC_URL=https://1venue.live
CORS_ORIGINS=                       # empty = https://1venue.live only
CANONICAL_HOST=1venue.live          # optional, see 3B
TRUST_PROXY=true
LIVEKIT_URL=wss://rtc.1venue.live
S3_PUBLIC_BASE_URL=https://files.1venue.live
MAIL_FROM="1venue <no-reply@1venue.live>"
GOOGLE_CLIENT_ID=…  GOOGLE_CLIENT_SECRET=…   # redirect URI https://1venue.live/auth/google/callback
```

## 6. Email DNS

Whichever SMTP provider you pick (docs/AUTH.md), add the records it gives you in Cloudflare DNS:
SPF (TXT on `@`, one SPF record only, merge providers into it), DKIM (TXT or CNAME), and a DMARC
record (`_dmarc`, start with `v=DMARC1; p=none; rua=mailto:you@…`). Add MX records only if you
also receive mail on the domain (e.g. Zoho Mail). Mail records are always **DNS only**.

## 7. Checklist

- [ ] `@` and `www` A records → app VPS; certificates issued; then proxied
- [ ] SSL/TLS mode Full (strict)
- [ ] www → apex: Redirect Rule and/or `CANONICAL_HOST=1venue.live`
- [ ] `rtc` and `turn` A records → LiveKit VPS, **DNS only**; LiveKit redeployed with `LIVEKIT_DOMAIN=rtc.1venue.live`
- [ ] `files.1venue.live` connected to the R2 bucket; `S3_PUBLIC_BASE_URL` set
- [ ] SMTP provider domain verified (SPF/DKIM/DMARC); `MAIL_FROM` on 1venue.live
- [ ] Google OAuth client: origin `https://1venue.live`, redirect `https://1venue.live/auth/google/callback`, authorized domain `1venue.live`
- [ ] Coolify env set (section 5) and app redeployed
- [ ] `https://www.1venue.live/x?y=1` → 301 → `https://1venue.live/x?y=1`
- [ ] `https://1venue.live/api/config` shows `livekitConfigured: true` and `auth.google: true`
- [ ] Sign up, confirm email (check the inbox), sign out, forgot password, Continue with Google
- [ ] Join a room from two devices, one on mobile data
