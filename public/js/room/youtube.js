// YouTube IFrame Player API wrapper for synced watch-together.
// Every viewer streams straight from YouTube; only {paused, t, rate} travels over the room socket.
let apiP = null;
export function loadYT(timeoutMs = 10000) {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiP) return apiP;
  apiP = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch (_) {} resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { apiP = null; reject(new Error('Couldn’t reach YouTube')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) { apiP = null; reject(new Error('YouTube took too long to load')); } }, timeoutMs);
  });
  return apiP;
}

export const ytId = (u) => {
  const s = String(u || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/i);
  return m ? m[1] : null;
};

/**
 * Mount a synced player into `el`.
 * holder: true → controls on, pushes state through onState(media).
 * viewers call api.apply(media) whenever a content-update arrives.
 */
export function mountYouTube(el, { videoId, holder, media, onState, onError, onNeedTap }) {
  let player = null; let ready = false; let dead = false; let lastSent = null; let pollT = null; let pending = media || null;
  const now = () => Date.now();
  const target = (m) => (m.t || 0) + (m.paused ? 0 : ((now() - (m.at || now())) / 1000) * (m.rate || 1));
  const S = () => (window.YT && window.YT.PlayerState) || { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0 };

  const snapshot = () => {
    const st = player.getPlayerState();
    return { paused: !(st === S().PLAYING || st === S().BUFFERING), t: Math.round(player.getCurrentTime() * 100) / 100, rate: player.getPlaybackRate ? player.getPlaybackRate() : 1, at: now() };
  };
  const push = (force) => {
    if (!holder || !ready || dead) return;
    const m = snapshot();
    if (!force && lastSent && lastSent.paused === m.paused && lastSent.rate === m.rate && Math.abs(target(lastSent) - m.t) < 1.5) return;
    lastSent = m; onState && onState(m);
  };
  const apply = (m) => {
    if (!m) return; pending = m;
    if (!ready || holder || dead) return;
    const want = target(m); const cur = player.getCurrentTime();
    if (player.getPlaybackRate && m.rate && player.getPlaybackRate() !== m.rate) player.setPlaybackRate(m.rate);
    if (Math.abs(cur - want) > 1.5) player.seekTo(want, true);
    const st = player.getPlayerState();
    if (m.paused) { if (st === S().PLAYING || st === S().BUFFERING) player.pauseVideo(); }
    else if (st !== S().PLAYING && st !== S().BUFFERING) {
      player.playVideo();
      // Autoplay with sound is often blocked: fall back to muted, then offer a tap to unmute.
      setTimeout(() => {
        if (dead || !ready) return;
        const s2 = player.getPlayerState();
        if (s2 !== S().PLAYING && s2 !== S().BUFFERING && !pending?.paused) { player.mute(); player.playVideo(); onNeedTap && onNeedTap('unmute'); }
      }, 1200);
    }
  };

  const host = document.createElement('div'); el.appendChild(host);
  loadYT().then((YT) => {
    if (dead) return;
    player = new YT.Player(host, {
      videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: holder ? 1 : 0, disablekb: holder ? 0 : 1, origin: location.origin, enablejsapi: 1 },
      events: {
        onReady: () => {
          ready = true;
          if (holder) { if (pending && pending.t) player.seekTo(target(pending), true); pollT = setInterval(() => push(false), 1000); push(true); }
          else apply(pending);
        },
        onStateChange: () => { if (holder) push(true); },
        onPlaybackRateChange: () => { if (holder) push(true); },
        onError: (e) => {
          const code = e && e.data;
          const msg = code === 101 || code === 150 ? 'The owner of this video doesn’t allow it to be played in other sites' : code === 153 ? 'YouTube refused the embed (player configuration)' : code === 100 ? 'This video was removed or is private' : 'YouTube couldn’t play this video';
          onError && onError(msg);
        },
      },
    });
  }).catch((e) => onError && onError(e.message));

  // Viewers drift-correct every few seconds against the last known state.
  const drift = setInterval(() => { if (!holder && ready && pending && !pending.paused) { const d = Math.abs(player.getCurrentTime() - target(pending)); if (d > 2) player.seekTo(target(pending), true); } }, 4000);

  return {
    apply,
    unmute: () => { if (player && ready) { player.unMute(); player.setVolume(100); if (!pending?.paused) player.playVideo(); } },
    destroy: () => { dead = true; clearInterval(pollT); clearInterval(drift); try { player && player.destroy(); } catch (_) {} },
  };
}
