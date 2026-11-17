import { icon } from '../icons.js';
import { h, api, toast, toastErr, avatar, uploadFile, fmtDate, profilePath } from '../ui.js';
import { state, requireLogin, loginUrl } from '../app.js';
import { postCard, empty, personRow, dateLeaf } from '../components.js';
import { passageCard } from '../passage.js';
import { promoInline, promoCompact, loadPromos } from '../promo.js';
import { listenOn, stopListening, isListening } from '../voice.js';
import { createHistory } from '../history.js';

const FILTERS = [
  ['all', 'All'],
  ['following', 'Following'],
  ['events', 'Events'],
  ['verses', 'Verses'],
  ['live', 'Live'],
];
const WIDE_RAIL = '(min-width: 1024px)';

export function composer(onPost, { prefill = '', eventId, passage = null, autofocus = false } = {}) {
  const ta = h('textarea', {
    class: 'feed-compose-input',
    placeholder: 'Share a thought, a verse or an event',
    rows: 2,
    maxlength: 2000,
    'aria-label': 'Write a post',
    'data-voice': 'off', // never listens on focus: voice typing here is tap-to-talk on the mic button only
  });
  ta.value = prefill;
  let media = [];
  const thumbs = h('div', { class: 'row wrap feed-compose-thumbs' });
  const pBox = h('div');
  const paintPassage = () => pBox.replaceChildren(...(passage ? [passageCard(passage, { compact: true, onRemove: () => { passage = null; paintPassage(); } })] : []));
  paintPassage();
  if (autofocus) setTimeout(() => ta.focus(), 120);

  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const r = await uploadFile(f, { purpose: 'post' });
      media.push({ url: r.url, mime: r.mime });
      thumbs.append(h('img', { src: r.url, alt: '', class: 'feed-compose-thumb' }));
    } catch (e) { toastErr(e); }
  };

  const hist = createHistory(12);
  let lastTuned = '';
  let fineLeft = null;
  let showingOriginal = false;

  const btn = h('button', { class: 'btn primary feed-post-btn', type: 'button' }, 'Post');
  const undoBtn = h('button', { class: 'icon-btn sm', type: 'button', 'data-group': 'ai', 'data-tip': 'Undo', 'aria-label': 'Undo', html: icon('undo', { size: 18 }) });
  const redoBtn = h('button', { class: 'icon-btn sm', type: 'button', 'data-group': 'ai', 'data-tip': 'Redo', 'aria-label': 'Redo', html: icon('redo', { size: 18 }) });
  const micBtn = h('button', { class: 'icon-btn sm feed-mic', type: 'button', 'data-group': 'media', 'data-tip': 'Voice typing: tap to start', 'aria-label': 'Start voice typing', 'aria-pressed': 'false', html: icon('mic', { size: 18 }) });
  const micLive = h('span', { class: 'feed-mic-live', role: 'status', 'aria-live': 'polite', hidden: true }, h('i', { class: 'dot' }), 'Listening');
  const tuneBtn = h('button', { class: 'icon-btn sm feed-finetune', type: 'button', 'data-group': 'ai', 'data-tip': 'Fine-tune', 'aria-label': 'Fine-tune wording', html: icon('wand', { size: 18 }) });
  const toggle = h('button', { class: 'chip sm feed-finetune-toggle hidden', type: 'button', 'aria-pressed': 'false' }, 'Original');

  const syncBtns = () => {
    const empty = !ta.value.trim();
    tuneBtn.disabled = empty || fineLeft === 0;
    if (fineLeft === 0) tuneBtn.dataset.tip = 'Daily fine-tune limit reached';
    else if (empty) tuneBtn.dataset.tip = 'Write something first';
    else tuneBtn.dataset.tip = 'Fine-tune';
    undoBtn.disabled = !hist.canUndo();
    redoBtn.disabled = !hist.canRedo();
    const hasHist = hist.canUndo() || hist.canRedo();
    undoBtn.hidden = !hasHist; redoBtn.hidden = !hasHist;
    const hasTune = !!lastTuned && hist.size() > 1;
    toggle.classList.toggle('hidden', !hasTune);
    toggle.textContent = showingOriginal ? 'Fine-tuned' : 'Original';
    toggle.setAttribute('aria-pressed', showingOriginal ? 'true' : 'false');
  };

  const applyText = (text) => {
    ta.value = text;
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, Math.max(44, ta.scrollHeight)) + 'px';
    syncBtns();
  };

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, Math.max(44, ta.scrollHeight)) + 'px';
    showingOriginal = false;
    syncBtns();
  });
  ta.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      const v = hist.undo();
      if (v != null) { showingOriginal = v === hist.original(); applyText(v); }
    } else if (k === 'z' && e.shiftKey || k === 'y') {
      e.preventDefault();
      const v = hist.redo();
      if (v != null) { showingOriginal = false; applyText(v); }
    }
  });

  undoBtn.onclick = () => {
    const v = hist.undo();
    if (v != null) { showingOriginal = v === hist.original(); applyText(v); }
  };
  redoBtn.onclick = () => {
    const v = hist.redo();
    if (v != null) { showingOriginal = false; applyText(v); }
  };
  // Mic = on/off toggle. Off is final: stopped by a second tap, typing, leaving the box, posting,
  // ~12 s of silence or leaving the page; it never turns itself back on.
  const STOP_MSG = { typing: 'Voice typing off — you started typing', silence: 'Voice typing off after a quiet spell', ended: 'Voice typing stopped' };
  const paintMic = (on) => {
    micBtn.classList.toggle('on', on);
    micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    micBtn.setAttribute('aria-label', on ? 'Stop voice typing' : 'Start voice typing');
    micBtn.dataset.tip = on ? 'Listening: tap to stop' : 'Voice typing: tap to start';
    micLive.hidden = !on;
    micLive.textContent = ''; if (on) micLive.append(h('i', { class: 'dot' }), 'Listening');
  };
  micBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the caret in the box
  micBtn.addEventListener('mousedown', (e) => e.preventDefault());
  micBtn.onclick = async () => {
    if (isListening(ta) || micBtn.classList.contains('on')) { stopListening(ta, 'user'); paintMic(false); return; }
    ta.focus();
    await listenOn(ta, {
      manual: true,
      onStart: () => paintMic(true),
      onEnd: (reason) => { paintMic(false); if (STOP_MSG[reason] && ta.isConnected) toast(STOP_MSG[reason], { icon: 'micOff', group: 'media' }); },
    });
  };
  toggle.onclick = () => {
    if (!lastTuned) return;
    if (showingOriginal) { showingOriginal = false; applyText(lastTuned); }
    else { showingOriginal = true; applyText(hist.original() || ta.value); }
  };
  tuneBtn.onclick = async () => {
    const text = ta.value.trim();
    if (!text) return;
    if (!requireLogin('Sign in to fine-tune')) return;
    tuneBtn.disabled = true;
    try {
      const r = await api('/api/ai/finetune', { method: 'POST', body: { text: ta.value } });
      hist.push(ta.value);
      hist.push(r.text);
      lastTuned = r.text;
      showingOriginal = false;
      if (typeof r.left === 'number') fineLeft = r.left;
      applyText(r.text);
      toast('Fine-tuned', { icon: 'wand', group: 'ai' });
    } catch (e) { toastErr(e); } finally { syncBtns(); }
  };

  if (state.user) {
    api('/api/ai/finetune').then((r) => { fineLeft = r.left; syncBtns(); }).catch(() => {});
  }
  syncBtns();

  btn.onclick = async () => {
    if (!requireLogin('Sign in to post')) return;
    stopListening(ta, 'posted');
    if (!ta.value.trim() && !media.length && !passage) return;
    btn.disabled = true;
    try {
      const p = await api('/api/posts', {
        method: 'POST',
        body: { body: ta.value.trim(), media: passage ? [{ type: 'passage', ...passage }, ...media] : media, eventId },
      });
      ta.value = ''; media = []; passage = null; paintPassage(); thumbs.innerHTML = '';
      hist.reset(); lastTuned = ''; showingOriginal = false; applyText('');
      onPost && onPost(p);
      toast('Posted', { icon: 'check', group: 'social' });
    } catch (e) { toastErr(e); } finally { btn.disabled = false; }
  };

  return h('div', { class: 'card feed-compose' },
    h('div', { class: 'feed-compose-top' },
      state.user ? avatar(state.user.displayName, state.user.avatarUrl) : null,
      ta),
    pBox, thumbs,
    h('div', { class: 'feed-compose-bar' },
      h('div', { class: 'feed-compose-tools' },
        h('button', { class: 'icon-btn sm', type: 'button', 'data-group': 'content', 'data-tip': 'Add photo', 'aria-label': 'Add photo', html: icon('image', { size: 18 }), onclick: () => file.click() }),
        file,
        h('a', { class: 'icon-btn sm', href: '/create', 'data-link': '', 'data-group': 'engage', 'data-tip': 'Schedule an event', 'aria-label': 'Schedule an event', html: icon('calendar', { size: 18 }) }),
        micBtn,
        micLive,
        tuneBtn,
        h('span', { class: 'feed-compose-hist' }, undoBtn, redoBtn),
        toggle,
      ),
      btn));
}

function sectionHead(label) {
  return h('h2', { class: 'feed-rail-head' }, label);
}

function signInBtn(label = 'Sign in') {
  const href = loginUrl('/feed');
  const a = h('a', { class: 'btn primary sm', href }, label);
  if (!/^https?:/i.test(href)) a.setAttribute('data-link', '');
  return a;
}

function youCard() {
  const u = state.user;
  if (!u) {
    return h('div', { class: 'feed-card feed-you' },
      h('p', { class: 'feed-you-copy' }, 'Sign in to post, follow hosts and see your upcoming events'),
      signInBtn());
  }
  const name = u.displayName || u.username || 'You';
  return h('div', { class: 'feed-card feed-you' },
    h('a', { class: 'feed-you-id', href: profilePath(u), 'data-link': '' },
      avatar(name, u.avatarUrl),
      h('div', { class: 'grow min0' },
        h('strong', { class: 'ellipsis' }, name),
        h('div', { class: 'tiny muted ellipsis' }, u.username ? '@' + u.username : ''))),
    h('nav', { class: 'feed-you-links', 'aria-label': 'Your pages' },
      h('a', { href: '/dashboard', 'data-link': '', html: icon('calendar', { size: 16 }) + '<span>My events</span>' }),
      h('a', { href: '/venues', 'data-link': '', html: icon('door', { size: 16 }) + '<span>My venues</span>' })));
}

function filterNav(current, onPick, { chips = false } = {}) {
  const nav = h('nav', {
    class: chips ? 'chips feed-chips-row' : 'feed-filters',
    'aria-label': 'Feed filters',
  });
  const paint = (value) => {
    current = value;
    for (const b of nav.querySelectorAll('button')) {
      const on = b.dataset.filter === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  };
  for (const [value, label] of FILTERS) {
    const b = h('button', {
      class: chips ? 'chip' : 'feed-filter',
      type: 'button',
      'data-filter': value,
      'aria-pressed': value === current ? 'true' : 'false',
    }, label);
    if (value === current) b.classList.add('on');
    b.onclick = () => { if (value === current) return; paint(value); onPick(value); };
    nav.append(b);
  }
  nav.setFilter = paint;
  return nav;
}

function upcomingList(events) {
  if (!events || !events.length) return null;
  return h('section', { class: 'feed-card feed-upcoming', 'aria-label': 'Your upcoming' },
    sectionHead('Your upcoming'),
    ...events.slice(0, 3).map((ev) => {
      const live = ev.status === 'live' || ev.live;
      const time = ev.startsAt ? new Date(ev.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
      return h('a', { class: 'feed-mini', href: `/e/${ev.slug}`, 'data-link': '' },
        dateLeaf(ev, { size: 'sm' }),
        h('div', { class: 'grow min0' },
          h('div', { class: 'feed-mini-title ellipsis' }, ev.title),
          h('div', { class: 'feed-mini-meta ellipsis' }, live ? 'On air now' : (time || 'Scheduled'))));
    }));
}

function liveNow(events) {
  const box = h('section', { class: 'feed-card feed-live', 'aria-label': 'Live now' }, sectionHead('Live now'));
  if (!events || !events.length) {
    box.append(h('p', { class: 'feed-empty-line' }, 'Nothing is live right now'));
    return box;
  }
  for (const ev of events.slice(0, 6)) {
    const viewers = ev.live?.viewers ?? ev.liveViewers ?? 0;
    box.append(h('a', { class: 'feed-mini', href: `/e/${ev.slug}`, 'data-link': '' },
      dateLeaf({ ...ev, status: 'live' }, { size: 'sm' }),
      h('div', { class: 'grow min0' },
        h('div', { class: 'feed-mini-title ellipsis' }, ev.title),
        h('div', { class: 'feed-mini-meta ellipsis' }, viewers ? `${viewers.toLocaleString()} watching` : 'On air now'))));
  }
  return box;
}

function promotedBox(items) {
  const list = (items || []).slice(0, 2).map((it) => promoCompact(it)).filter(Boolean);
  if (!list.length) return null;
  return h('section', { class: 'feed-card feed-promoted', 'aria-label': 'Promoted' },
    sectionHead('Promoted'), ...list);
}

function suggestedBox(people) {
  if (!people || !people.length) return null;
  return h('section', { class: 'feed-card feed-suggested', 'aria-label': 'Suggested hosts' },
    sectionHead('Suggested hosts'),
    ...people.slice(0, 3).map((u) => personRow(u, { follow: true })));
}

function verseBox(verse) {
  if (!verse || !verse.ref) return null;
  const text = String(verse.text || '').trim();
  return h('section', { class: 'feed-card feed-verse', 'aria-label': "Today's verse" },
    sectionHead("Today's verse"),
    h('a', { class: 'feed-verse-link', href: verse.href || ('/books?ref=' + encodeURIComponent(verse.ref)), 'data-link': '' },
      text ? h('p', { class: 'feed-verse-text' }, text) : null,
      h('div', { class: 'feed-verse-ref' }, verse.ref, verse.translation ? h('span', { class: 'feed-verse-tr' }, ' · ' + verse.translation) : null)));
}

function slimScroll(el) {
  let t = 0;
  const on = () => {
    el.classList.add('is-scrolling');
    clearTimeout(t);
    t = setTimeout(() => el.classList.remove('is-scrolling'), 700);
  };
  el.addEventListener('scroll', on, { passive: true });
  return () => { el.removeEventListener('scroll', on); clearTimeout(t); };
}

function syncCmdbar(center) {
  const apply = () => {
    const mq = window.matchMedia(WIDE_RAIL);
    if (!mq.matches || !center.isConnected) {
      document.documentElement.style.removeProperty('--feed-cmd-left');
      document.documentElement.style.removeProperty('--feed-cmd-width');
      return;
    }
    const r = center.getBoundingClientRect();
    if (r.width < 200) return;
    document.documentElement.style.setProperty('--feed-cmd-left', Math.round(r.left) + 'px');
    document.documentElement.style.setProperty('--feed-cmd-width', Math.round(r.width) + 'px');
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
  ro && ro.observe(center);
  window.addEventListener('resize', apply);
  apply();
  requestAnimationFrame(apply);
  return () => {
    ro && ro.disconnect();
    window.removeEventListener('resize', apply);
    document.documentElement.style.removeProperty('--feed-cmd-left');
    document.documentElement.style.removeProperty('--feed-cmd-width');
  };
}

function emptyCopy(filter) {
  if (filter === 'following' && !state.user) {
    return { icon: 'users', title: 'Follow hosts you like', body: 'Sign in to see posts from people you follow', cta: true };
  }
  if (filter === 'following') return { icon: 'users', title: 'Your following feed is quiet', body: 'Follow hosts or post something to get it going' };
  if (filter === 'events') return { icon: 'calendar', title: 'No event posts yet', body: 'When people schedule or go live, those posts show up here' };
  if (filter === 'verses') return { icon: 'book', title: 'No verses in the feed', body: 'Share a passage from Books to start this thread' };
  if (filter === 'live') return { icon: 'radio', title: 'Nothing is live', body: 'Live event posts appear here when a host goes on air' };
  return { icon: 'feed', title: 'The feed is quiet', body: 'Be the first to post, or follow a host to fill it up' };
}

export async function mount(view, params) {
  document.body.dataset.page = 'feed';

  let filter = FILTERS.some(([v]) => v === params.filter) ? params.filter : 'all';
  const prefill = sessionStorage.getItem('venue.compose') || '';
  sessionStorage.removeItem('venue.compose');
  let passage = null;
  try { passage = JSON.parse(sessionStorage.getItem('venue.compose.passage') || 'null'); } catch { /* */ }
  sessionStorage.removeItem('venue.compose.passage');

  const list = h('div', { class: 'feed-stream', 'data-promo-slot': '5' },
    h('div', { class: 'skel', style: { height: '140px' } }),
    h('div', { class: 'skel', style: { height: '180px' } }));

  let comp;
  if (state.user) {
    comp = composer((p) => {
      list.querySelector('.empty')?.remove();
      list.prepend(postCard(p));
    }, { prefill, passage });
  } else {
    comp = h('div', { class: 'card feed-compose feed-compose-guest' },
      h('span', { class: 'feed-compose-guest-copy' }, 'Sign in to post, like and comment'), signInBtn());
  }

  const head = h('div', { class: 'feed-head' },
    h('h1', { class: 'feed-title' }, 'Feed'),
    comp);

  const onFilter = (value) => { filter = value; reload(); };
  const leftFilters = filterNav(filter, onFilter);
  const chipFilters = filterNav(filter, (value) => { leftFilters.setFilter(value); onFilter(value); }, { chips: true });
  const origLeft = leftFilters.setFilter;
  leftFilters.setFilter = (v) => { origLeft(v); chipFilters.setFilter(v); };

  const upcomingSlot = h('div');
  const left = h('aside', { class: 'feed-rail feed-left', 'aria-label': 'Your feed' },
    youCard(),
    h('div', { class: 'feed-card' }, sectionHead('Feed'), leftFilters),
    upcomingSlot);

  const liveSlot = h('div');
  const promoSlot = h('div');
  const verseSlot = h('div');
  const suggestSlot = h('div');
  const right = h('aside', { class: 'feed-rail feed-right', 'aria-label': 'Feed highlights' },
    liveSlot, promoSlot, verseSlot, suggestSlot);

  const center = h('div', { class: 'feed-center' }, head, chipFilters, list);
  const shell = h('div', { class: 'feed-shell page-feed' }, left, center, right);
  view.append(shell);

  if (params.compose && state.user) setTimeout(() => comp.querySelector('textarea')?.focus(), 100);

  const stopScroll = [slimScroll(left), slimScroll(right)];
  const stopCmd = syncCmdbar(shell);

  let before = null, loading = false, done = false;
  const more = h('div', { class: 'feed-sentinel' });
  async function page() {
    if (loading || done) return;
    loading = true;
    try {
      const q = new URLSearchParams({ filter });
      if (before) q.set('before', before);
      const r = await api('/api/feed?' + q.toString());
      if (!before) list.innerHTML = '';
      (r.posts || []).forEach((p) => list.append(postCard(p)));
      if (!(r.posts || []).length && !before) {
        const c = emptyCopy(filter);
        const node = empty(c.icon, c.title, c.body);
        if (c.cta) node.append(h('div', { class: 'feed-empty-cta' }, signInBtn()));
        list.append(node);
      }
      if (!before && (r.posts || []).length) promoInline(list, 'feed', { wide: WIDE_RAIL });
      if ((r.posts || []).length < 20) done = true;
      else before = r.posts[r.posts.length - 1].createdAt;
      list.append(more);
    } catch (e) { toastErr(e); } finally { loading = false; }
  }
  function reload() {
    before = null; done = false;
    list.replaceChildren(h('div', { class: 'skel', style: { height: '140px' } }), h('div', { class: 'skel', style: { height: '180px' } }));
    page();
  }
  const io = new IntersectionObserver((es) => es[0].isIntersecting && page());
  io.observe(more);

  async function loadRails() {
    const [rails, promos] = await Promise.all([
      api('/api/feed/rails').catch(() => ({ upcoming: [], live: [], suggested: [], verse: null })),
      loadPromos('feed'),
    ]);
    if (!view.isConnected) return;
    upcomingSlot.replaceChildren(...(upcomingList(rails.upcoming) ? [upcomingList(rails.upcoming)] : []));
    liveSlot.replaceChildren(liveNow(rails.live));
    const promo = promotedBox(promos);
    promoSlot.replaceChildren(...(promo ? [promo] : []));
    const suggested = suggestedBox(rails.suggested);
    const verse = verseBox(rails.verse);
    verseSlot.replaceChildren(...(verse ? [verse] : []));
    suggestSlot.replaceChildren(...(suggested ? [suggested] : []));
  }

  await Promise.all([page(), loadRails()]);
  return {
    unmount: () => {
      io.disconnect();
      stopScroll.forEach((fn) => fn());
      stopCmd();
      if (document.body.dataset.page === 'feed') delete document.body.dataset.page;
    },
  };
}
