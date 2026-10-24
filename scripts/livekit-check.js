#!/usr/bin/env node
/* LiveKit connection test: `npm run livekit:check` (uses LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET).
 * 1. HTTPS reachability of the signalling endpoint (Coolify proxy → livekit:7880)
 * 2. Token validation via /rtc/validate (proves key/secret match the server)
 * 3. WebSocket upgrade through the proxy (websockets enabled)
 * Media (UDP 50000-60000 / TCP 7881 / TURN) can only be proven from a browser — see docs/livekit-coolify.md §7. */
const { createLiveKitToken } = require('../src/livekit/tokens');
const config = require('../src/config');
const url = (process.argv[2] || config.LIVEKIT_URL || '').replace(/\/$/, '');
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => { console.log('  ✗ ' + m); process.exitCode = 1; };
(async () => {
  if (!url) { bad('LIVEKIT_URL is not set'); return; }
  const http = url.replace(/^ws/, 'http');
  console.log('LiveKit check →', url);
  try { const r = await fetch(http + '/', { signal: AbortSignal.timeout(8000) }); r.ok ? ok(`signalling reachable (${r.status} ${(await r.text()).trim().slice(0, 20)})`) : bad(`signalling answered ${r.status} — is the Coolify domain pointing at port 7880?`); }
  catch (e) { bad('cannot reach ' + http + ' — ' + (e.cause?.code || e.message) + ' (DNS, proxy or certificate)'); return; }
  let token;
  try { token = await createLiveKitToken('livekit-check', 'Connection test', 'livekit-check'); } catch (e) { bad(e.message); return; }
  try {
    const r = await fetch(`${http}/rtc/validate?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
    const t = (await r.text()).trim();
    if (r.ok) ok('API key/secret accepted by the server');
    else { bad(`token rejected (${r.status}: ${t.replace(/ey[\w-]+\.[\w.-]*/g, '<token>').slice(0, 80)}) — LIVEKIT_API_KEY/SECRET must equal LIVEKIT_KEYS on the LiveKit service`); return; }
  } catch (e) { bad('validate failed — ' + e.message); return; }
  if (typeof WebSocket === 'function') {
    await new Promise((res) => {
      const ws = new WebSocket(`${url}/rtc?access_token=${encodeURIComponent(token)}&auto_subscribe=1&protocol=9`);
      const t = setTimeout(() => { bad('WebSocket did not open in 8s — enable websockets on the Coolify proxy'); try { ws.close(); } catch {} res(); }, 8000);
      ws.onopen = () => { clearTimeout(t); ok('WebSocket upgrade works through the proxy'); ws.close(); res(); };
      ws.onerror = () => { clearTimeout(t); bad('WebSocket error — check proxy websocket support and that the domain targets port 7880'); res(); };
    });
  } else console.log('  · skipped WebSocket test (needs Node 22+)');
  console.log(process.exitCode ? '\nSome checks failed — see docs/livekit-coolify.md §8 (Troubleshooting).' : '\nSignalling OK. Now test media from a browser: https://livekit.io/connection-test or open a 1venue room on mobile data.');
})();
