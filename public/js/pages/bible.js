import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, copy, sheet, md, debounce } from '../ui.js';
import { state, setPrefs, navigate } from '../app.js';
import { registerCommands, unregisterCommands } from '../commands.js';
import { sharePassageToFeed } from '../passage.js';
import { shareLink } from '../components.js';
import { speak, stop as ttsStop, isSpeaking, ttsSupported, bestVoice } from '../tts.js';

let TR = null, BOOKS = null;
export async function bibleMeta() {
  if (!TR) [TR, BOOKS] = await Promise.all([api('/api/bible/translations').then((r) => r.translations), api('/api/bible/books').then((r) => r.books)]);
  return { translations: TR, books: BOOKS };
}
export function translationSelect(value, onChange, { compact = false, corpus = 'all' } = {}) {
  const isQuran = (t) => t.corpus === 'quran' || /^quran_/i.test(t.id);
  const label = corpus === 'quran' ? 'Qur’an translation' : corpus === 'bible' ? 'Bible translation' : 'Translation';
  const sel = h('select', { class: `input tr-select${compact ? ' sm' : ''}`, 'aria-label': label });
  bibleMeta().then(({ translations }) => {
    let filtered = translations;
    if (corpus === 'quran') filtered = translations.filter(isQuran);
    else if (corpus === 'bible') filtered = translations.filter((t) => !isQuran(t));
    // When showing all, group Qur’an editions under their own optgroup label
    if (corpus === 'all') {
      const bible = filtered.filter((t) => !isQuran(t));
      const quran = filtered.filter(isQuran);
      const byLang = {};
      bible.forEach((t) => (byLang[t.language] ||= []).push(t));
      Object.entries(byLang).forEach(([lang, list]) => sel.append(h('optgroup', { label: lang }, list.map((t) => h('option', { value: t.id, selected: t.id === value, title: t.name }, compact ? t.short : `${t.short} — ${t.name}`)))));
      if (quran.length) {
        sel.append(h('optgroup', { label: 'Qur’an' }, quran.map((t) => h('option', { value: t.id, selected: t.id === value, title: t.name }, compact ? t.short : `${t.short} — ${t.name}`))));
      }
    } else {
      const byLang = {};
      filtered.forEach((t) => (byLang[t.language] ||= []).push(t));
      Object.entries(byLang).forEach(([lang, list]) => sel.append(h('optgroup', { label: lang }, list.map((t) => h('option', { value: t.id, selected: t.id === value, title: t.name }, compact ? t.short : `${t.short} — ${t.name}`)))));
    }
    if (!filtered.some((t) => t.id === value) && filtered[0]) {
      sel.value = filtered[0].id;
      onChange && onChange(filtered[0].id);
    } else {
      sel.value = value;
    }
  });
  sel.onchange = () => onChange(sel.value);
  return sel;
}
export function versesEl(p, { selectable = true, onSelect, compact = false } = {}) {
  const sel = new Set(p.selected || []);
  const wrap = h('div', { class: `verse-wrap${compact ? ' compact' : ''}`, lang: p.translation?.lang || p.lang || 'en' });
  (p.verses || []).forEach((v) => {
    const el = h('span', { class: `verse${sel.has(v.v) ? ' sel' : ''}`, 'data-v': v.v }, h('sup', null, String(v.v)), ' ', String(v.text).replace(/^¶\s*/, ''), ' ');
    if (selectable) el.onclick = () => { el.classList.toggle('sel'); sel.has(v.v) ? sel.delete(v.v) : sel.add(v.v); onSelect && onSelect([...sel].sort((a, b) => a - b)); };
    wrap.append(el);
  });
  return wrap;
}
/** Listen / Stop control for scripture text (Web Speech API). */
export function makeListenBtn(getPayload) {
  const btn = h('button', {
    class: 'icon-btn has-bg',
    type: 'button',
    'data-tip': 'Listen',
    'aria-label': 'Listen',
    html: icon('volume', { size: 18 }),
  });
  if (!ttsSupported()) {
    btn.disabled = true;
    btn.setAttribute('data-tip', 'Speech not supported in this browser');
    return btn;
  }
  const sync = () => {
    const on = isSpeaking();
    btn.classList.toggle('on', on);
    btn.setAttribute('data-tip', on ? 'Stop' : 'Listen');
    btn.setAttribute('aria-label', on ? 'Stop' : 'Listen');
    btn.innerHTML = icon(on ? 'volumeX' : 'volume', { size: 18 });
  };
  btn.onclick = () => {
    if (isSpeaking()) { ttsStop(); sync(); return; }
    const { verses, text, lang } = getPayload() || {};
    const payload = verses?.length ? verses : text;
    if (!payload || (Array.isArray(payload) && !payload.length)) {
      toast('Nothing to read', { icon: 'info' });
      return;
    }
    const r = speak(payload, { lang: lang || 'en' });
    if (!r.ok) {
      toast(r.reason === 'unsupported' ? 'Speech not supported here' : 'Could not start reading', { icon: 'info' });
      return;
    }
    if (!bestVoice(lang || 'en') && lang && !String(lang).startsWith('en')) {
      toast('No native voice for this language on this device — pronunciation may vary', { icon: 'info' });
    }
    sync();
    const tick = setInterval(() => { if (!isSpeaking()) { clearInterval(tick); sync(); } }, 300);
  };
  return btn;
}

export const refLabel = (bookName, ch, vs, { quran = false } = {}) => {
  const range = vs && vs.length
    ? (vs.length > 1 && vs[vs.length - 1] - vs[0] === vs.length - 1 ? `${vs[0]}-${vs[vs.length - 1]}` : vs.join(','))
    : '';
  if (quran) return range ? `${bookName} ${range}` : bookName;
  return `${bookName} ${ch}${range ? ':' + range : ''}`;
};

export async function mount(view, params) {
  // Canonical path is /books (legacy /bible still works and is rewritten)
  if (location.pathname.startsWith('/bible')) {
    const qs = location.search || '';
    history.replaceState({}, '', `/books${qs}`);
  }
  const { books } = await bibleMeta();
  const corpus = (params.corpus || '').toLowerCase() === 'quran' ? 'quran' : 'bible';
  let tr = params.t
    || (corpus === 'quran' ? (state.prefs.quranTranslation || 'quran_en_sahih') : null)
    || state.prefs.bibleTranslation
    || state.config?.bible?.defaultTranslation
    || 'eng_kjv';
  if (corpus === 'quran' && !/^quran_/i.test(tr)) tr = 'quran_en_sahih';
  if (corpus === 'bible' && /^quran_/i.test(tr)) tr = state.config?.bible?.defaultTranslation || 'eng_kjv';
  let book = corpus === 'quran' ? 'Q001' : 'JHN', chapter = 1, highlight = [];
  const refIn = h('input', {
    class: 'input',
    placeholder: corpus === 'quran' ? 'Al-Ikhlas, Al-Fatihah 1, 2:255, family…' : 'John 3:16, family, hope, “a man shall leave…”',
    'aria-label': 'Reference or topic',
  });
  const isQuranTr = (id) => /^(quran_)/i.test(id || '');
  const bookGroups = corpus === 'quran'
    ? [h('optgroup', { label: 'Surahs' }, books.filter((b) => b.testament === 'Quran').map((b) =>
        h('option', { value: b.id }, `${b.surah} ${b.name}`)))]
    : [
      h('optgroup', { label: 'Old Testament' }, books.filter((b) => b.testament === 'OT').map((b) => h('option', { value: b.id }, b.name))),
      h('optgroup', { label: 'Deuterocanonical' }, books.filter((b) => b.testament === 'DC').map((b) => h('option', { value: b.id }, b.name))),
      h('optgroup', { label: 'New Testament' }, books.filter((b) => b.testament === 'NT').map((b) => h('option', { value: b.id }, b.name))),
    ];
  const bookSel = h('select', { class: 'input', 'aria-label': corpus === 'quran' ? 'Surah' : 'Book' }, ...bookGroups);
  const chSel = h('select', { class: 'input', 'aria-label': 'Chapter' });
  if (corpus === 'quran') chSel.hidden = true;
  const trSel = translationSelect(tr, (v) => {
    tr = v;
    setPrefs({ bibleTranslation: v, ...(isQuranTr(v) ? { quranTranslation: v } : {}) });
    load();
  }, { compact: true, corpus });
  const body = h('div', { class: 'card pad-lg bible-page' });
  const selBar = h('div', { class: 'sel-bar hidden' });
  const defaultBibleTr = () => state.prefs.bibleTranslation && !isQuranTr(state.prefs.bibleTranslation)
    ? state.prefs.bibleTranslation
    : (state.config?.bible?.defaultTranslation || 'eng_kjv');
  const defaultQuranTr = () => state.prefs.quranTranslation || 'quran_en_sahih';
  const ensureCorpus = (b) => {
    const meta = books.find((x) => x.id === b) || {};
    if (meta.testament === 'Quran' && !isQuranTr(tr)) {
      tr = defaultQuranTr(); trSel.value = tr; setPrefs({ bibleTranslation: tr, quranTranslation: tr });
    } else if (meta.testament !== 'Quran' && isQuranTr(tr)) {
      tr = defaultBibleTr(); trSel.value = tr; setPrefs({ bibleTranslation: tr });
    }
  };
  const fillCh = () => {
    const b = books.find((x) => x.id === book);
    const isQ = b?.testament === 'Quran';
    chSel.innerHTML = '';
    for (let i = 1; i <= (b?.chapters || 1); i++) chSel.append(h('option', { value: i }, isQ ? (b.chapters === 1 ? 'Full surah' : `Ayah set ${i}`) : `Ch ${i}`));
    chSel.value = chapter;
  };
  bookSel.onchange = () => { book = bookSel.value; chapter = 1; highlight = []; ensureCorpus(book); fillCh(); load(); };
  chSel.onchange = () => { chapter = Number(chSel.value); highlight = []; load(); };
  const step = (d) => {
    const pool = corpus === 'quran'
      ? books.filter((x) => x.testament === 'Quran')
      : books.filter((x) => x.testament !== 'Quran');
    const b = pool.find((x) => x.id === book) || pool[0];
    let i = pool.indexOf(b);
    if (corpus === 'quran') {
      // Surahs have no multi-chapter structure — step moves to neighbouring surah
      i = Math.max(0, Math.min(pool.length - 1, i + d));
      book = pool[i].id;
      chapter = 1;
    } else {
      chapter += d;
      if (chapter < 1) { i = Math.max(0, i - 1); book = pool[i].id; chapter = pool[i].chapters; }
      else if (chapter > b.chapters) { i = Math.min(pool.length - 1, i + 1); book = pool[i].id; chapter = 1; }
      else book = b.id;
    }
    bookSel.value = book; ensureCorpus(book); fillCh(); highlight = []; load();
  };
  let cur = null;
  async function load() {
    body.innerHTML = '<div class="skel" style="height:300px"></div>'; selBar.classList.add('hidden');
    try {
      ensureCorpus(book);
      cur = await api(`/api/bible/${tr}/${book}/${chapter}`);
      const t = TR.find((x) => x.id === tr);
      const meta = books.find((x) => x.id === book) || {};
      const isQuran = corpus === 'quran' || meta.testament === 'Quran' || !!cur.surah;
      const meaning = cur.meaning || cur.headings?.[0] || meta.meaning || '';
      const titleMain = isQuran
        ? (cur.surah ? `${cur.surah}. ${cur.bookName}` : cur.bookName)
        : `${cur.bookName} ${chapter}`;
      const histRef = isQuran ? cur.bookName : `${cur.bookName} ${chapter}`;
      history.replaceState({}, '', `/books?ref=${encodeURIComponent(histRef)}&t=${tr}${corpus === 'quran' ? '&corpus=quran' : ''}`);
      body.innerHTML = '';
      const titleBlock = h('div', { class: 'bible-title-block' },
        h('h2', { class: 'bible-title' }, titleMain),
        isQuran && meaning
          ? h('div', { class: 'surah-meaning' }, meaning)
          : null);
      const listenBtn = makeListenBtn(() => {
        const lang = t?.lang || 'en';
        const vs = highlight.length
          ? cur.verses.filter((v) => highlight.includes(v.v))
          : cur.verses;
        return { verses: vs, lang };
      });
      body.append(
        h('div', { class: 'row between wrap', style: { alignItems: 'flex-start' } },
          titleBlock,
          h('div', { class: 'row', style: { gap: '.35rem', alignItems: 'center' } },
            listenBtn,
            h('span', { class: 'chip', 'data-group': 'faith', 'data-tip': t?.license || '' }, t?.short || tr))),
        versesEl({ ...cur, selected: highlight, translation: t }, { onSelect: (vs) => { highlight = vs; paintSel(); } }),
        h('div', { class: 'row between', style: { marginTop: '1.5rem' } },
          h('button', { class: 'btn', html: icon('chevronLeft', { size: 18 }) + (isQuran ? 'Previous surah' : 'Previous'), onclick: () => step(-1) }),
          h('button', { class: 'btn', html: (isQuran ? 'Next surah' : 'Next') + icon('chevronRight', { size: 18 }), onclick: () => step(1) })),
        h('p', { class: 'tiny faint', style: { marginTop: '1rem' } }, `${t?.name || tr} · ${t?.license || ''}`));
      paintSel();
      if (highlight.length) setTimeout(() => body.querySelector('.verse.sel')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    } catch (e) { body.innerHTML = ''; body.append(h('p', { class: 'muted' }, e.message || 'Could not load this chapter')); }
  }
  /** Plain text with inline verse numbers, e.g. "1 In the beginning… 2 And the earth…" */
  function numberedText(verses) {
    return (verses || []).map((v) => `${v.v} ${String(v.text).replace(/^¶\s*/, '').trim()}`).join(' ');
  }
  function selectedText() {
    const vs = cur.verses.filter((v) => highlight.includes(v.v));
    return numberedText(vs);
  }
  function paintSel() {
    selBar.classList.toggle('hidden', !highlight.length);
    if (!highlight.length) return;
    const ref = refLabel(cur.bookName, chapter, highlight, { quran: corpus === 'quran' || !!cur.surah });
    const t = TR.find((x) => x.id === tr);
    selBar.innerHTML = '';
    const selVerses = cur.verses.filter((v) => highlight.includes(v.v)).map((v) => ({ v: v.v, text: String(v.text).replace(/^¶\s*/, '').trim() }));
    const passage = { reference: ref, text: selectedText(), translation: tr, short: t?.short || '' };
    selBar.append(h('span', { class: 'sel-ref' }, h('strong', null, ref), h('small', null, `${highlight.length} verse${highlight.length > 1 ? 's' : ''}`)),
      makeListenBtn(() => ({ verses: selVerses, lang: t?.lang || 'en' })),
      h('button', { class: 'btn sm primary', 'data-group': 'social', onclick: () => sharePassageToFeed(passage), html: icon('feed', { size: 15 }) + '<span>Share to feed</span>' }),
      h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Copy', 'aria-label': 'Copy', html: icon('copy'), onclick: () => copy(`“${passage.text}” — ${ref} (${t?.short})`, 'Verse copied') }),
      h('button', { class: 'icon-btn', 'data-group': 'ai', 'data-tip': 'Explain with AI', 'aria-label': 'Explain', html: icon('sparkles'), onclick: () => explain(ref, passage.text, selVerses) }),
      h('button', { class: 'icon-btn', 'data-tip': 'Clear selection', 'aria-label': 'Clear selection', html: icon('x'), onclick: () => { highlight = []; body.querySelectorAll('.verse.sel').forEach((e) => e.classList.remove('sel')); paintSel(); } }));
  }
  async function explain(ref, text, verseList) {
    if (!state.user) return toast('Sign in to use AI', { icon: 'login' });
    const t = TR.find((x) => x.id === tr);
    const passage = { reference: ref, text, translation: tr, short: t?.short || '' };
    const s = sheet({ title: ref, icon: 'sparkles', group: 'ai' });
    s.body.append(h('div', { class: 'skel', style: { height: '120px' } }));
    try {
      const r = await api('/api/ai/ask', { method: 'POST', body: { question: `Briefly explain the meaning and context of ${ref}: "${text}"` } });
      s.body.innerHTML = '';
      const explanation = r.text || '';
      const fullShare = `${ref}\n\n“${text}”\n\n${explanation}`.trim();
      const postBody = `${ref}\n\n${explanation}`.trim();

      const acts = h('div', { class: 'row gap-s ai-explain-acts', style: { marginTop: '1.1rem', flexWrap: 'wrap' } },
        h('button', {
          class: 'icon-btn has-bg', type: 'button',
          'data-tip': 'Copy', 'aria-label': 'Copy',
          'data-group': 'content',
          html: icon('copy', { size: 18 }),
          onclick: () => copy(fullShare, 'Explanation copied'),
        }),
        h('button', {
          class: 'icon-btn has-bg', type: 'button',
          'data-tip': 'Post to feed', 'aria-label': 'Post to feed',
          'data-group': 'social',
          html: icon('feed', { size: 18 }),
          onclick: async () => {
            try {
              const { composer } = await import('../pages/feed.js');
              const ps = sheet({ title: 'Post to feed', icon: 'feed', group: 'social' });
              // Start with the reference only — never "Explain …"
              ps.body.append(composer(() => ps.close(), { autofocus: true, prefill: postBody, passage }));
            } catch (e) { toastErr(e); }
          },
        }),
        h('button', {
          class: 'icon-btn has-bg', type: 'button',
          'data-tip': 'Share', 'aria-label': 'Share externally',
          'data-group': 'social',
          html: icon('share', { size: 18 }),
          onclick: async () => {
            const shareUrl = `${location.origin}/books?ref=${encodeURIComponent(ref)}${tr ? `&t=${encodeURIComponent(tr)}` : ''}${corpus === 'quran' || isQuranTr(tr) ? '&corpus=quran' : ''}`;
            if (navigator.share) {
              try {
                await navigator.share({ title: ref, text: fullShare, url: shareUrl });
                return;
              } catch { /* cancelled or unsupported payload */ }
            }
            await shareLink(shareUrl, ref);
          },
        }),
      );

      // Same superscript verse styling as the reader
      const verseBlock = verseList?.length
        ? versesEl({ verses: verseList, translation: t }, { selectable: false, compact: true })
        : h('div', { class: 'verse-wrap compact' }, text);

      s.body.append(
        h('figure', { class: 'passage-card ai-verse-card', 'data-group': 'faith' },
          h('figcaption', { class: 'pc-head' },
            h('span', { class: 'pc-ic', html: icon('bookOpen', { size: 14 }) }),
            h('span', { class: 'pc-ref' }, ref),
            t?.short ? h('span', { class: 'pc-tr' }, t.short) : null),
          verseBlock),
        h('div', { class: 'ai-box prose', style: { marginTop: '1rem' }, html: md(explanation) }),
        acts,
        h('p', { class: 'tiny faint', style: { marginTop: '1rem' } }, r.mock ? 'Demo AI response — configure AI_PRIMARY_* for real answers.' : 'Venue AI'),
      );
    } catch (e) { s.body.innerHTML = ''; s.body.append(h('p', { class: 'muted' }, e.message)); }
  }
  function resultCard(item) {
    const text = item.text || item.excerpt || '';
    const verses = item.verses || [];
    const passage = {
      reference: item.reference,
      text: text || item.why || '',
      translation: item.translation || tr,
      short: item.short || (TR.find((x) => x.id === (item.translation || tr))?.short) || '',
    };
    const open = () => goRef(item.reference, { forcePassage: true });
    const hitLang = TR.find((x) => x.id === (item.translation || tr))?.lang || 'en';
    const acts = h('div', { class: 'row gap-s', style: { marginTop: '.55rem', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm primary', type: 'button', onclick: open, html: icon('bookOpen', { size: 14 }) + ' Open' }),
      makeListenBtn(() => ({
        verses: verses.length ? verses : null,
        text: text || null,
        lang: hitLang,
      })),
      h('button', {
        class: 'icon-btn has-bg sm', type: 'button',
        'data-tip': 'Copy', 'aria-label': 'Copy',
        'data-group': 'content',
        html: icon('copy', { size: 16 }),
        onclick: () => copy(`“${passage.text}” — ${passage.reference}${passage.short ? ` (${passage.short})` : ''}`, 'Verse copied'),
      }),
      h('button', {
        class: 'icon-btn has-bg sm', type: 'button',
        'data-tip': 'Post to feed', 'aria-label': 'Post to feed',
        'data-group': 'social',
        html: icon('feed', { size: 16 }),
        onclick: () => sharePassageToFeed(passage),
      }),
      h('button', {
        class: 'icon-btn has-bg sm', type: 'button',
        'data-tip': 'Share', 'aria-label': 'Share externally',
        'data-group': 'social',
        html: icon('share', { size: 16 }),
        onclick: async () => {
          const url = `${location.origin}/books?ref=${encodeURIComponent(passage.reference)}${passage.translation ? `&t=${encodeURIComponent(passage.translation)}` : ''}${/^quran_/i.test(passage.translation || '') || corpus === 'quran' ? '&corpus=quran' : ''}`;
          const shareText = `${passage.reference}\n\n“${passage.text}”`;
          if (navigator.share) {
            try { await navigator.share({ title: passage.reference, text: shareText, url }); return; } catch { /* cancelled */ }
          }
          await shareLink(url, passage.reference);
        },
      }),
    );
    // Same superscript numbering as the reader (gold/faith-coloured <sup>)
    const bodyEl = verses.length
      ? versesEl({ verses, translation: { lang: TR.find((x) => x.id === (item.translation || tr))?.lang || 'en' } }, { selectable: false, compact: true })
      : (text ? h('div', { class: 'verse-wrap compact' }, text) : null);
    return h('article', { class: 'bible-hit card pad layer' },
      h('div', { class: 'row between wrap', style: { gap: '.4rem', alignItems: 'baseline' } },
        h('button', { class: 'bible-hit-ref', type: 'button', onclick: open }, item.reference),
        h('div', { class: 'row', style: { gap: '.35rem' } },
          item.deuterocanon ? h('span', { class: 'chip', 'data-group': 'faith', 'data-tip': 'Deuterocanonical' }, 'Deut.') : null,
          item.short ? h('span', { class: 'chip', 'data-group': 'faith' }, item.short) : null)),
      item.why ? h('p', { class: 'tiny muted', style: { margin: '.2rem 0 .35rem' } }, item.why) : null,
      bodyEl,
      acts);
  }

  async function showSearchResults(query, refs) {
    body.innerHTML = '';
    selBar.classList.add('hidden');
    history.replaceState({}, '', `/books?q=${encodeURIComponent(query)}&t=${tr}${corpus === 'quran' ? '&corpus=quran' : ''}`);
    body.append(
      h('div', { class: 'row between wrap', style: { marginBottom: '.75rem', gap: '.5rem' } },
        h('div', null,
          h('h2', { class: 'bible-title', style: { fontSize: '1.15rem' } }, 'Matches'),
          h('p', { class: 'tiny muted' }, `${corpus === 'quran' ? 'Qur’an' : 'Bible'} suggestions for “${query}”`)),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => load() }, 'Back to reading')),
      h('div', { class: 'bible-hits col', style: { gap: '.75rem' } }, ...refs.map(resultCard)),
    );
  }

  async function goRef(ref, { forcePassage = false } = {}) {
    const q = String(ref || '').trim();
    if (!q) return;
    // Direct chapter load when it looks like a reference, or when forced from a result card
    // Allow hyphens / apostrophes (Al-Ikhlas, Ali 'Imran, Song of Songs)
    const looksQuranic = /^(surah|sura|soorah)\s+/i.test(q)
      || /^al[- ]?[a-z]/i.test(q)
      || /^q\d{1,3}\b/i.test(q)
      || /\b(ayah|ayat)\b/i.test(q);
    const looksLikeRef = forcePassage
      || looksQuranic
      || /^[\w\s.'\u2019\-–—]+\s+\d{1,3}(:[\d,\-–—]+)?$/i.test(q)
      || /^[1-3]?\s?[A-Za-z][\w.'\u2019\-]*\.?\s+\d/i.test(q);
    if (looksLikeRef) {
      body.innerHTML = '<div class="skel" style="height:300px"></div>';
      try {
        // Stay inside the active corpus. Never blind-retry the other library —
        // that caused “Unknown surah” / “Unknown chapter” cross-contamination.
        let tryTr = tr;
        if (corpus === 'quran' && !isQuranTr(tr)) tryTr = defaultQuranTr();
        if (corpus === 'bible' && isQuranTr(tr)) tryTr = defaultBibleTr();
        // Explicit Qur’anic query while on the Bible page → use a Qur’an edition
        if (corpus === 'bible' && looksQuranic && !isQuranTr(tryTr)) tryTr = defaultQuranTr();

        const p = await api(`/api/bible/passage?ref=${encodeURIComponent(q)}&t=${tryTr}`);
        tr = tryTr; trSel.value = tr; setPrefs({ bibleTranslation: tr, ...(isQuranTr(tr) ? { quranTranslation: tr } : {}) });
        book = p.book; chapter = p.chapter; highlight = p.selected || [];
        bookSel.value = book; fillCh(); load();
        return;
      } catch (e) {
        if (forcePassage) { toastErr(e); return; }
        // fall through to smart search
      }
    }
    body.innerHTML = '<div class="skel" style="height:180px"></div>';
    selBar.classList.add('hidden');
    try {
      const r = await api('/api/ai/scripture', { method: 'POST', body: { query: q, translation: tr, corpus } });
      if (r.refs?.length) {
        // Single high-confidence direct match → open it; otherwise show the guide
        if (r.refs.length === 1 && looksLikeRef) return goRef(r.refs[0].reference, { forcePassage: true });
        return showSearchResults(q, r.refs);
      }
      body.innerHTML = '';
      body.append(h('p', { class: 'muted' }, 'No matching passages found. Try a reference like “John 3:16” or a topic like “family”, “hope”, “peace”.'));
    } catch (e) { toastErr(e); body.innerHTML = ''; body.append(h('p', { class: 'muted' }, e.message || 'Search failed')); }
  }
  refIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && refIn.value.trim()) goRef(refIn.value.trim()); });
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('bookOpen', { size: 28 }) + (corpus === 'quran' ? 'Qur’an' : 'Bible') })),
    h('div', { class: 'bible-tools card layer' }, h('span', { class: 'bt-ic', html: icon('search', { size: 16 }) }), refIn, bookSel, chSel, trSel), body, selBar);
  bookSel.value = book; fillCh();
  if (params.ref) goRef(params.ref);
  else if (params.q) { refIn.value = params.q; goRef(params.q); }
  else load();
  registerCommands('page', [
    { id: 'bible-next', label: 'Next chapter', icon: 'chevronRight', group: 'faith', run: () => step(1) },
    { id: 'bible-prev', label: 'Previous chapter', icon: 'chevronLeft', group: 'faith', run: () => step(-1) },
    { id: 'bible-goto', label: 'Go to reference', icon: 'search', group: 'faith', keywords: ['verse', 'passage'], run: () => refIn.focus() },
    ...(TR || []).map((t) => ({ id: 'tr-' + t.id, label: `Read in ${t.short} (${t.language})`, icon: 'languages', group: 'faith', keywords: [t.name, t.language, 'translation', 'version'], run: () => { tr = t.id; trSel.value = t.id; setPrefs({ bibleTranslation: t.id }); load(); } })),
  ]);
  return { unmount: () => unregisterCommands('page') };
}
