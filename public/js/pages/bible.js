import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, copy, sheet, md, debounce } from '../ui.js';
import { state, setPrefs, navigate } from '../app.js';
import { registerCommands, unregisterCommands } from '../commands.js';
import { sharePassageToFeed } from '../passage.js';
import { shareLink } from '../components.js';

let TR = null, BOOKS = null;
export async function bibleMeta() {
  if (!TR) [TR, BOOKS] = await Promise.all([api('/api/bible/translations').then((r) => r.translations), api('/api/bible/books').then((r) => r.books)]);
  return { translations: TR, books: BOOKS };
}
export function translationSelect(value, onChange, { compact = false } = {}) {
  const sel = h('select', { class: `input tr-select${compact ? ' sm' : ''}`, 'aria-label': 'Bible translation' });
  bibleMeta().then(({ translations }) => {
    const byLang = {};
    translations.forEach((t) => (byLang[t.language] ||= []).push(t));
    Object.entries(byLang).forEach(([lang, list]) => sel.append(h('optgroup', { label: lang }, list.map((t) => h('option', { value: t.id, selected: t.id === value, title: t.name }, compact ? t.short : `${t.short} — ${t.name}`)))));
    sel.value = value;
  });
  sel.onchange = () => onChange(sel.value);
  return sel;
}
export function versesEl(p, { selectable = true, onSelect } = {}) {
  const sel = new Set(p.selected || []);
  const wrap = h('div', { class: 'verse-wrap', lang: p.translation?.lang || 'en' });
  (p.verses || []).forEach((v) => {
    const el = h('span', { class: `verse${sel.has(v.v) ? ' sel' : ''}`, 'data-v': v.v }, h('sup', null, String(v.v)), ' ', String(v.text).replace(/^¶\s*/, ''), ' ');
    if (selectable) el.onclick = () => { el.classList.toggle('sel'); sel.has(v.v) ? sel.delete(v.v) : sel.add(v.v); onSelect && onSelect([...sel].sort((a, b) => a - b)); };
    wrap.append(el);
  });
  return wrap;
}
export const refLabel = (bookName, ch, vs) => `${bookName} ${ch}${vs && vs.length ? ':' + (vs.length > 1 && vs[vs.length - 1] - vs[0] === vs.length - 1 ? `${vs[0]}-${vs[vs.length - 1]}` : vs.join(',')) : ''}`;

export async function mount(view, params) {
  const { books } = await bibleMeta();
  let tr = params.t || state.prefs.bibleTranslation || state.config?.bible?.defaultTranslation || 'eng_kjv';
  let book = 'JHN', chapter = 1, highlight = [];
  const refIn = h('input', { class: 'input', placeholder: 'John 3:16, family, hope, “a man shall leave…”', 'aria-label': 'Reference or topic' });
  const bookSel = h('select', { class: 'input', 'aria-label': 'Book' }, h('optgroup', { label: 'Old Testament' }, books.filter((b) => b.testament === 'OT').map((b) => h('option', { value: b.id }, b.name))), h('optgroup', { label: 'New Testament' }, books.filter((b) => b.testament === 'NT').map((b) => h('option', { value: b.id }, b.name))));
  const chSel = h('select', { class: 'input', 'aria-label': 'Chapter' });
  const trSel = translationSelect(tr, (v) => { tr = v; setPrefs({ bibleTranslation: v }); load(); }, { compact: true });
  const body = h('div', { class: 'card pad-lg bible-page' });
  const selBar = h('div', { class: 'sel-bar hidden' });
  const fillCh = () => { const b = books.find((x) => x.id === book); chSel.innerHTML = ''; for (let i = 1; i <= (b?.chapters || 1); i++) chSel.append(h('option', { value: i }, `Ch ${i}`)); chSel.value = chapter; };
  bookSel.onchange = () => { book = bookSel.value; chapter = 1; highlight = []; fillCh(); load(); };
  chSel.onchange = () => { chapter = Number(chSel.value); highlight = []; load(); };
  const step = (d) => { const b = books.find((x) => x.id === book); let i = books.indexOf(b); chapter += d; if (chapter < 1) { i = Math.max(0, i - 1); book = books[i].id; chapter = books[i].chapters; } else if (chapter > b.chapters) { i = Math.min(books.length - 1, i + 1); book = books[i].id; chapter = 1; } bookSel.value = book; fillCh(); highlight = []; load(); };
  let cur = null;
  async function load() {
    body.innerHTML = '<div class="skel" style="height:300px"></div>'; selBar.classList.add('hidden');
    try {
      cur = await api(`/api/bible/${tr}/${book}/${chapter}`);
      const t = TR.find((x) => x.id === tr);
      history.replaceState({}, '', `/bible?ref=${encodeURIComponent(`${cur.bookName} ${chapter}`)}&t=${tr}`);
      body.innerHTML = '';
      body.append(h('div', { class: 'row between wrap' }, h('h2', { class: 'bible-title' }, `${cur.bookName} ${chapter}`), h('span', { class: 'chip', 'data-group': 'faith', 'data-tip': t?.license || '' }, t?.short || tr)),
        versesEl({ ...cur, selected: highlight, translation: t }, { onSelect: (vs) => { highlight = vs; paintSel(); } }),
        h('div', { class: 'row between', style: { marginTop: '1.5rem' } },
          h('button', { class: 'btn', html: icon('chevronLeft', { size: 18 }) + 'Previous', onclick: () => step(-1) }),
          h('button', { class: 'btn', html: 'Next' + icon('chevronRight', { size: 18 }), onclick: () => step(1) })),
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
    const ref = refLabel(cur.bookName, chapter, highlight);
    const t = TR.find((x) => x.id === tr);
    selBar.innerHTML = '';
    const passage = { reference: ref, text: selectedText(), translation: tr, short: t?.short || '' };
    selBar.append(h('span', { class: 'sel-ref' }, h('strong', null, ref), h('small', null, `${highlight.length} verse${highlight.length > 1 ? 's' : ''}`)),
      h('button', { class: 'btn sm primary', 'data-group': 'social', onclick: () => sharePassageToFeed(passage), html: icon('feed', { size: 15 }) + '<span>Share to feed</span>' }),
      h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Copy', 'aria-label': 'Copy', html: icon('copy'), onclick: () => copy(`“${passage.text}” — ${ref} (${t?.short})`, 'Verse copied') }),
      h('button', { class: 'icon-btn', 'data-group': 'ai', 'data-tip': 'Explain with AI', 'aria-label': 'Explain', html: icon('sparkles'), onclick: () => explain(ref, passage.text) }),
      h('button', { class: 'icon-btn', 'data-tip': 'Clear selection', 'aria-label': 'Clear selection', html: icon('x'), onclick: () => { highlight = []; body.querySelectorAll('.verse.sel').forEach((e) => e.classList.remove('sel')); paintSel(); } }));
  }
  async function explain(ref, text) {
    if (!state.user) return toast('Sign in to use AI', { icon: 'login' });
    const t = TR.find((x) => x.id === tr);
    const passage = { reference: ref, text, translation: tr, short: t?.short || '' };
    // Keep verse display sleek: soft max length so cards stay tidy on small screens
    const MAX_VERSE_CHARS = 320;
    const displayText = text.length > MAX_VERSE_CHARS ? text.slice(0, MAX_VERSE_CHARS).trim() + '…' : text;
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
            const shareUrl = `${location.origin}/bible?ref=${encodeURIComponent(ref)}${tr ? `&t=${encodeURIComponent(tr)}` : ''}`;
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

      s.body.append(
        // Sleek verse “card” (visual block, truncated for device-friendly layout)
        h('figure', { class: 'passage-card ai-verse-card', 'data-group': 'faith' },
          h('figcaption', { class: 'pc-head' },
            h('span', { class: 'pc-ic', html: icon('bookOpen', { size: 14 }) }),
            h('span', { class: 'pc-ref' }, ref),
            t?.short ? h('span', { class: 'pc-tr' }, t.short) : null),
          h('blockquote', { class: 'pc-text' }, displayText)),
        h('div', { class: 'ai-box prose', style: { marginTop: '1rem' }, html: md(explanation) }),
        acts,
        h('p', { class: 'tiny faint', style: { marginTop: '1rem' } }, r.mock ? 'Demo AI response — configure AI_PRIMARY_* for real answers.' : 'Venue AI'),
      );
    } catch (e) { s.body.innerHTML = ''; s.body.append(h('p', { class: 'muted' }, e.message)); }
  }
  function resultCard(item) {
    const text = item.text || item.excerpt || '';
    const passage = {
      reference: item.reference,
      text: text || item.why || '',
      translation: item.translation || tr,
      short: item.short || (TR.find((x) => x.id === (item.translation || tr))?.short) || '',
    };
    const open = () => goRef(item.reference, { forcePassage: true });
    const acts = h('div', { class: 'row gap-s', style: { marginTop: '.55rem', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm primary', type: 'button', onclick: open, html: icon('bookOpen', { size: 14 }) + ' Open' }),
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
          const url = `${location.origin}/bible?ref=${encodeURIComponent(passage.reference)}${passage.translation ? `&t=${encodeURIComponent(passage.translation)}` : ''}`;
          const shareText = `${passage.reference}\n\n“${passage.text}”`;
          if (navigator.share) {
            try { await navigator.share({ title: passage.reference, text: shareText, url }); return; } catch { /* cancelled */ }
          }
          await shareLink(url, passage.reference);
        },
      }),
    );
    return h('article', { class: 'bible-hit card pad layer' },
      h('div', { class: 'row between wrap', style: { gap: '.4rem', alignItems: 'baseline' } },
        h('button', { class: 'bible-hit-ref', type: 'button', onclick: open }, item.reference),
        item.short ? h('span', { class: 'chip', 'data-group': 'faith' }, item.short) : null),
      item.why ? h('p', { class: 'tiny muted', style: { margin: '.2rem 0 .35rem' } }, item.why) : null,
      text ? h('blockquote', { class: 'bible-hit-text' }, text) : null,
      acts);
  }

  async function showSearchResults(query, refs) {
    body.innerHTML = '';
    selBar.classList.add('hidden');
    history.replaceState({}, '', `/bible?q=${encodeURIComponent(query)}&t=${tr}`);
    body.append(
      h('div', { class: 'row between wrap', style: { marginBottom: '.75rem', gap: '.5rem' } },
        h('div', null,
          h('h2', { class: 'bible-title', style: { fontSize: '1.15rem' } }, 'Matches'),
          h('p', { class: 'tiny muted' }, `Topic & phrase suggestions for “${query}”`)),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => load() }, 'Back to reading')),
      h('div', { class: 'bible-hits col', style: { gap: '.75rem' } }, ...refs.map(resultCard)),
    );
  }

  async function goRef(ref, { forcePassage = false } = {}) {
    const q = String(ref || '').trim();
    if (!q) return;
    // Direct chapter load when it looks like a reference, or when forced from a result card
    const looksLikeRef = forcePassage || /^[\w\s.]+\s+\d{1,3}(:[\d,\-–—]+)?$/i.test(q) || /^[1-3]?\s?[A-Za-z]+\.?\s+\d/i.test(q);
    if (looksLikeRef) {
      body.innerHTML = '<div class="skel" style="height:300px"></div>';
      try {
        const p = await api(`/api/bible/passage?ref=${encodeURIComponent(q)}&t=${tr}`);
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
      const r = await api('/api/ai/scripture', { method: 'POST', body: { query: q, translation: tr } });
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
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('bookOpen', { size: 28 }) + 'Bible' })),
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
