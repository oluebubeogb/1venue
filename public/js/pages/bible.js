import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, copy, sheet, md, debounce } from '../ui.js';
import { state, setPrefs, navigate } from '../app.js';
import { registerCommands, unregisterCommands } from '../commands.js';

let TR = null, BOOKS = null;
export async function bibleMeta() {
  if (!TR) [TR, BOOKS] = await Promise.all([api('/api/bible/translations').then((r) => r.translations), api('/api/bible/books').then((r) => r.books)]);
  return { translations: TR, books: BOOKS };
}
export function translationSelect(value, onChange, { compact = false } = {}) {
  const sel = h('select', { class: `input${compact ? ' sm' : ''}`, 'aria-label': 'Bible translation' });
  bibleMeta().then(({ translations }) => {
    const byLang = {};
    translations.forEach((t) => (byLang[t.language] ||= []).push(t));
    Object.entries(byLang).forEach(([lang, list]) => sel.append(h('optgroup', { label: lang }, list.map((t) => h('option', { value: t.id, selected: t.id === value }, `${t.short} — ${t.name}`)))));
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
  const refIn = h('input', { class: 'input', placeholder: 'Go to… John 3:16, Ps 23, Rom 8:28-39', 'aria-label': 'Reference' });
  const bookSel = h('select', { class: 'input', 'aria-label': 'Book' }, h('optgroup', { label: 'Old Testament' }, books.filter((b) => b.testament === 'OT').map((b) => h('option', { value: b.id }, b.name))), h('optgroup', { label: 'New Testament' }, books.filter((b) => b.testament === 'NT').map((b) => h('option', { value: b.id }, b.name))));
  const chSel = h('select', { class: 'input', 'aria-label': 'Chapter', style: { maxWidth: '6.5rem' } });
  const trSel = translationSelect(tr, (v) => { tr = v; setPrefs({ bibleTranslation: v }); load(); });
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
  function selectedText() { return cur.verses.filter((v) => highlight.includes(v.v)).map((v) => String(v.text).replace(/^¶\s*/, '')).join(' '); }
  function paintSel() {
    selBar.classList.toggle('hidden', !highlight.length);
    if (!highlight.length) return;
    const ref = refLabel(cur.bookName, chapter, highlight);
    const t = TR.find((x) => x.id === tr);
    selBar.innerHTML = '';
    selBar.append(h('strong', null, ref),
      h('button', { class: 'icon-btn', 'data-group': 'content', 'data-tip': 'Copy', 'aria-label': 'Copy', html: icon('copy'), onclick: () => copy(`“${selectedText()}” — ${ref} (${t?.short})`, 'Verse copied') }),
      h('button', { class: 'icon-btn', 'data-group': 'social', 'data-tip': 'Post to feed', 'aria-label': 'Post', html: icon('feed'), onclick: () => { sessionStorage.setItem('venue.compose', `“${selectedText()}” — ${ref} (${t?.short})`); navigate('/feed?compose=1'); } }),
      h('button', { class: 'icon-btn', 'data-group': 'ai', 'data-tip': 'Explain with AI', 'aria-label': 'Explain', html: icon('sparkles'), onclick: () => explain(ref, selectedText()) }),
      h('button', { class: 'icon-btn', 'data-tip': 'Clear', 'aria-label': 'Clear', html: icon('x'), onclick: () => { highlight = []; body.querySelectorAll('.verse.sel').forEach((e) => e.classList.remove('sel')); paintSel(); } }));
  }
  async function explain(ref, text) {
    if (!state.user) return toast('Sign in to use AI', { icon: 'login' });
    const s = sheet({ title: `Explain ${ref}`, icon: 'sparkles', group: 'ai' });
    s.body.append(h('div', { class: 'skel', style: { height: '120px' } }));
    try { const r = await api('/api/ai/ask', { method: 'POST', body: { question: `Briefly explain the meaning and context of ${ref}: "${text}"` } }); s.body.innerHTML = ''; s.body.append(h('div', { class: 'ai-box prose', html: md(r.text) }), h('p', { class: 'tiny faint' }, r.mock ? 'Demo AI response — configure AI_PRIMARY_* for real answers.' : `via ${r.provider}`)); } catch (e) { s.body.innerHTML = ''; s.body.append(h('p', { class: 'muted' }, e.message)); }
  }
  async function goRef(ref) {
    try { const p = await api(`/api/bible/passage?ref=${encodeURIComponent(ref)}&t=${tr}`); book = p.book; chapter = p.chapter; highlight = p.selected || []; bookSel.value = book; fillCh(); load(); }
    catch (e) {
      try { const r = await api('/api/ai/scripture', { method: 'POST', body: { query: ref, translation: tr } }); if (r.refs?.length) return goRef(r.refs[0].reference); } catch { /* ignore */ }
      toastErr(e);
    }
  }
  refIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && refIn.value.trim()) goRef(refIn.value.trim()); });
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon('bookOpen', { size: 28 }) + 'Bible' }), h('p', { class: 'muted' }, 'Open-licence translations in English, Yorùbá, Igbo, Hausa, French, Spanish and more.')),
    h('div', { class: 'bible-tools card pad layer' }, refIn, h('div', { class: 'row wrap', style: { gap: '.5rem' } }, bookSel, chSel, trSel)), selBar, body);
  bookSel.value = book; fillCh();
  if (params.ref) goRef(params.ref); else load();
  registerCommands('page', [
    { id: 'bible-next', label: 'Next chapter', icon: 'chevronRight', group: 'faith', run: () => step(1) },
    { id: 'bible-prev', label: 'Previous chapter', icon: 'chevronLeft', group: 'faith', run: () => step(-1) },
    { id: 'bible-goto', label: 'Go to reference', icon: 'search', group: 'faith', keywords: ['verse', 'passage'], run: () => refIn.focus() },
    ...(TR || []).map((t) => ({ id: 'tr-' + t.id, label: `Read in ${t.short} (${t.language})`, icon: 'languages', group: 'faith', keywords: [t.name, t.language, 'translation', 'version'], run: () => { tr = t.id; trSel.value = t.id; setPrefs({ bibleTranslation: t.id }); load(); } })),
  ]);
  return { unmount: () => unregisterCommands('page') };
}
