# LiveKit on Coolify for 1venue

This guide covers deploying LiveKit, which carries 1venue's audio, video and screen share.

**Domains**

| What | URL | Notes |
|---|---|---|
| 1venue app | `https://venue.collab.name.ng` | `PUBLIC_URL` / `CORS_ORIGINS` |
| LiveKit signalling | `wss://1v.collab.name.ng` | Coolify domain on port **7880** |
| TURN | `1v.collab.name.ng` | The same name with the same cert. There are no `lk.` or `turn.` sub-subdomains. |

Everything lives one level under `collab.name.ng`, so the normal Coolify/Let's Encrypt certificate works.

Without LiveKit, 1venue still runs chat, polls, Q&A, whiteboards, Bible, captions, YouTube watch-together and slides. Only live audio/video and screen share need it.

---

## 1. What needs to be open

| Port | Proto | Where | Purpose |
|---|---|---|---|
| 443 | TCP | Coolify proxy (already open) | `https://1v.collab.name.ng` → `livekit:7880` (signalling over WebSocket) |
| 7881 | TCP | host firewall | ICE over TCP, used when UDP is blocked |
| 50000–60000 | UDP | host firewall | Media (WebRTC). This is the main path. |
| 3478 | UDP | host firewall | TURN/UDP, a relay for strict NATs |
| 30000–30100 | UDP | host firewall | TURN relay ports |
| 5349 | TCP | host firewall (optional) | TURN/TLS. See §5. |

Ubuntu with `ufw`:

```bash
sudo ufw allow 7881/tcp
sudo ufw allow 50000:60000/udp
sudo ufw allow 3478/udp
sudo ufw allow 30000:30100/udp
# optional TURN/TLS:
sudo ufw allow 5349/tcp
```

If your VPS provider has a cloud firewall (Hetzner, AWS security group, DigitalOcean, Oracle…), open the same ports there too. This is the most common reason that "it connects but nobody sees video".

DNS: `1v.collab.name.ng` needs an **A record** to the server's public IP. Do **not** proxy it through Cloudflare's orange cloud, because UDP can't pass through.

Tested with `livekit-server` **v1.13.10** and the `livekit-client` 2.23 that 1venue bundles. Older servers (v1.8.x) fail with `/rtc/v1 404` and a negotiation timeout. When you upgrade, bump both together.

## 2. Create the keys

```bash
docker run --rm livekit/livekit-server:v1.13.10 generate-keys
# API Key:    APIxxxxxxxx
# API Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

You'll use the same pair in both the LiveKit service and the 1venue app.

## 3. Deploy LiveKit in Coolify

1. **New Resource → Docker Compose** (or "Docker Compose Empty") on the same server.
2. In the resource, set **Base Directory** to `/docs/livekit` and **Docker Compose Location** to `/docker-compose.yml` (not `livekit.yaml`, which is only a reference copy of the config; the compose file already contains it inline as `LIVEKIT_CONFIG`). If you edit settings, edit them in the compose file.
3. **Environment variables** for the resource:
   ```
   LIVEKIT_API_KEY=APIxxxxxxxx
   LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
4. **Domain**: on the `livekit` service, set `https://1v.collab.name.ng:7880`. Coolify's syntax `domain:port` means "proxy this domain to container port 7880". The public URL is still `https://1v.collab.name.ng` on 443.
5. WebSockets work through Coolify's Traefik by default. On the Caddy proxy they also work by default. If you customised labels, make sure nothing strips the `Upgrade` header.
6. Deploy. In the logs you should see `starting LiveKit server … "portHttp": 7880`.

### Why `network_mode: host`

WebRTC needs 10,000 UDP ports. Mapping these through Docker's NAT costs CPU and RAM (one iptables rule and a docker-proxy per port). Host networking gives LiveKit the real ports at zero overhead. This is LiveKit's recommended production setup.

Coolify's proxy reaches it on the host at `:7880`. If your Coolify version refuses a domain on a host-network service, use one of these:

- **Option A:** remove `network_mode: host` and add
  ```yaml
  ports: ["7881:7881", "50000-60000:50000-60000/udp", "3478:3478/udp"]
  ```
  This works but costs more resources. Shrink the range to `50000-50200` in both the yaml and compose for small events (about 2 ports per participant).
- **Option B:** keep host mode and add a Coolify *Dynamic Configuration* (Server → Proxy) that routes `Host(\`1v.collab.name.ng\`)` to `http://host.docker.internal:7880`.

## 4. `livekit.yaml`: what matters

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true      # finds the public IP via STUN
  # node_ip: 203.0.113.10    # set this if use_external_ip picks a wrong/private IP
turn:
  enabled: true
  domain: 1v.collab.name.ng
  udp_port: 3478
```

- **`use_external_ip` / `node_ip`:** LiveKit must advertise the **public** IP in its ICE candidates.
  - On most VPSs `use_external_ip: true` is enough.
  - If the server sits behind a NAT or has several IPs, comment it out and set `node_ip:` to the public IPv4.
  - Symptom of a wrong IP: people join, but video stays black or freezes after about 10s.
- **Lean settings already in the file:**
  - `empty_timeout: 300` frees empty rooms.
  - Congestion control pauses video for weak links instead of stalling.
  - There is no Redis (single node).
  - The memory limit is 1 GB.
  - 1venue itself caps video bitrate (`VIDEO_MAX_BITRATE`, `VIDEO_MAX_FPS`, `SCREEN_MAX_BITRATE` in the app env).
  - 1 vCPU / 1 GB comfortably serves a few small rooms. Large webinars need more CPU, not RAM.

## 5. TURN, only on `1v.collab.name.ng`

TURN relays media for people on strict corporate Wi-Fi or carrier NAT. You have two options.

**Default: TURN over UDP 3478 (already enabled).**
- It needs no certificate. It works for most mobile networks and home routers.
- It does not help on networks that block all UDP; those still fall back to ICE/TCP 7881.
- Open `3478/udp` and `30000-30100/udp` (§1).

**Optional: TURN over TLS with the same 1v.collab.name.ng certificate.**
- This helps on networks that only allow HTTPS-looking traffic.
- Port 443 is already used by Coolify's proxy, so let the proxy terminate TLS on **5349** with the Let's Encrypt cert it already holds for `1v.collab.name.ng`, and forward plain TCP to LiveKit.

1. In `livekit.yaml` uncomment:
   ```yaml
   turn:
     tls_port: 5350        # plain TCP; the proxy terminates TLS in front of it
     external_tls: true
   ```
2. In Coolify, go to **Servers → Proxy → Configuration**. Add an entrypoint to Traefik's command:
   ```
   - '--entrypoints.turntls.address=:5349'
   ```
   Then add `- '5349:5349'` to the proxy's ports and restart the proxy.
3. Add a **Dynamic Configuration** file (`turn.yaml`):
   ```yaml
   tcp:
     routers:
       livekit-turn:
         entryPoints: [turntls]
         rule: "HostSNI(`1v.collab.name.ng`)"
         service: livekit-turn
         tls:
           certResolver: letsencrypt
     services:
       livekit-turn:
         loadBalancer:
           servers:
             - address: "host.docker.internal:5350"
   ```
4. Open `5349/tcp` on the firewall.

If editing the proxy feels risky, skip TURN/TLS. UDP TURN plus ICE/TCP 7881 covers almost everyone.

> We deliberately do **not** use `turn.1v.collab.name.ng` or `lk.1v.collab.name.ng`. Deeper subdomains need a separate certificate, which is the HTTPS limitation you hit.

## 6. Point 1venue at LiveKit

In the 1venue Coolify app's environment:

```
PUBLIC_URL=https://venue.collab.name.ng
CORS_ORIGINS=https://venue.collab.name.ng
LIVEKIT_URL=wss://1v.collab.name.ng
LIVEKIT_API_KEY=APIxxxxxxxx          # same pair as §2
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxx
```

Redeploy 1venue. Then check `https://venue.collab.name.ng/api/config`: it should show `"livekitConfigured": true` and `"livekitUrl": "wss://1v.collab.name.ng"`.

## 7. Connection test

**From the 1venue container** (Coolify → 1venue → Terminal):

```bash
npm run livekit:check
# LiveKit check → wss://1v.collab.name.ng
#   ✓ signalling reachable (200 OK)
#   ✓ API key/secret accepted by the server
#   ✓ WebSocket upgrade works through the proxy   (Node 22+; skipped on older Node)
```

**From your laptop:**

```bash
curl -s https://1v.collab.name.ng      # → OK
```

**Media (UDP/TCP/TURN), from a browser:**
1. Open <https://livekit.io/connection-test>.
2. Enter `wss://1v.collab.name.ng` and a token. Generate one with ``lk token create --api-key … --api-secret … --join --room test --identity me` (LiveKit CLI)`, or just open a 1venue room.
3. Green on "UDP" and "TCP" means you're done.
4. Then join a 1venue room from two devices, one of them on **mobile data**, and turn the camera on.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Room shows "Audio/video unavailable" | `LIVEKIT_*` not set on 1venue | §6, redeploy |
| `livekit:check` → cannot reach | DNS or Coolify domain wrong | A record for `1v.collab.name.ng`; domain `https://1v.collab.name.ng:7880` |
| `livekit:check` → 401 token rejected | Key/secret differ | Make both services use the same `LIVEKIT_API_KEY/SECRET` |
| `livekit:check` → WebSocket error | Proxy not forwarding Upgrade, or wrong port | Domain must target 7880; remove custom middlewares |
| Joins, but video black for everyone | UDP 50000-60000 / TCP 7881 closed, or wrong advertised IP | Open ports in **both** ufw and the provider firewall; set `node_ip` |
| Works on Wi-Fi, not on mobile data (or vice versa) | Strict NAT | Make sure TURN/UDP 3478 + 30000-30100 are open; optionally TURN/TLS (§5) |
| Works for 10s, then drops | Wrong `node_ip` / private IP advertised | Set `node_ip` to the public IP |
| Mixed-content / "insecure WebSocket" | `LIVEKIT_URL` uses `ws://` | Use `wss://1v.collab.name.ng` |
| Browser console: `/rtc/v1 … 404`, then `NegotiationError: negotiation timed out` | LiveKit server too old for the bundled client (livekit-client 2.23) | Use the pinned `livekit/livekit-server:v1.13.10` or newer. v1.8.x was tested and fails. |
| Signalling OK, but participants are dropped with `removing participant without connection` in the LiveKit logs | ICE never connected: the advertised IP is unreachable (loopback/private), or the UDP/TCP ports are closed | Set `node_ip` to the public IP, and open the §1 ports |
| High CPU | Many video publishers | Lower `VIDEO_MAX_BITRATE` / `VIDEO_MAX_FPS`, or ask attendees to keep cameras off in webinars |

Logs: Coolify → LiveKit resource → Logs. Look for `starting RTC session` (a join) and `participant closing … reason` (why someone left).
