import { icon } from '../icons.js';
import { h, api, esc, debounce, frag } from '../ui.js';
import { navigate, CATS } from '../app.js';
import { eventCard, skeletonCards, empty, personRow, catOf } from '../components.js';

export async function mount(view, params) {
  const isSearch = !!params.search;
  let q = params.q || '', category = params.category || '', status = params.status || '', tab = params.tab || 'events';
  const input = h('input', { class: 'input', type: 'search', placeholder: isSearch ? 'Search events, people, scripture…' : 'Search talk shows, seminars, sermons…', value: q, 'aria-label': 'Search' });
  const results = h('div');
  const statusSeg = h('div', { class: 'seg', role: 'tablist' }, [['', 'All', 'sparkle'], ['live', 'Live', 'radio'], ['upcoming', 'Upcoming', 'calendar'], ['past', 'Replays', 'history']].map(([v, l, ic]) =>
    h('button', { class: status === v ? 'on' : '', 'data-v': v, html: icon(ic, { size: 15 }) + l, onclick: () => { status = v; sync(); } })));
  const cats = h('div', { class: 'chips hscroll' }, h('button', { class: `chip${!category ? ' on' : ''}`, 'data-c': '', onclick: () => { category = ''; sync(); } }, 'All'),
    CATS.map(([k, l, ic]) => h('button', { class: `chip${category === k ? ' on' : ''}`, 'data-c': k, style: { '--g': catOf(k)[2] }, html: icon(ic, { size: 15 }) + esc(l), onclick: () => { category = category === k ? '' : k; sync(); } })));
  const tabs = h('div', { class: 'tabs' }, [['events', 'Events', 'calendar'], ['people', 'People', 'users'], ['scripture', 'Scripture', 'bookOpen']].map(([v, l, ic]) =>
    h('button', { class: tab === v ? 'on' : '', html: icon(ic, { size: 16 }) + l, onclick: () => { tab = v; sync(); } })));
  view.append(
    h('div', { class: 'page-head' }, h('h1', { html: icon(isSearch ? 'search' : 'compass', { size: 28 }) + (isSearch ? 'Search' : 'Discover') }),
      h('p', { class: 'muted' }, isSearch ? 'Everything on 1venue in one place.' : 'Live and upcoming public events from hosts across the community.')),
    h('div', { class: 'search-line' }, frag(icon('search', { size: 20 })), input),
    isSearch ? tabs : h('div', { class: 'col', style: { gap: '.8rem', margin: '1rem 0' } }, statusSeg, cats),
    results);
  function sync() {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q); if (!isSearch && category) sp.set('category', category); if (!isSearch && status) sp.set('status', status); if (isSearch && tab !== 'events') sp.set('tab', tab);
    history.replaceState({}, '', location.pathname + (sp.toString() ? '?' + sp : ''));
    statusSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === status));
    cats.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.dataset.c === category));
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', ['events', 'people', 'scripture'][i] === tab));
    load();
  }
  let seq = 0;
  async function load() {
    const my = ++seq;
    results.innerHTML = ''; results.append(skeletonCards(6));
    try {
      let node;
      if (isSearch && tab === 'people') {
        const r = q.length >= 2 ? await api('/api/users/search?q=' + encodeURIComponent(q)) : await api('/api/people/suggested').then((x) => ({ users: x.people }));
        node = r.users.length ? h('div', { class: 'card layer', style: { padding: '.4rem' } }, r.users.map((u) => personRow(u))) : empty('users', 'No people found', 'Try a different name or handle.');
      } else if (isSearch && tab === 'scripture') {
        const r = q.length >= 2 ? await api('/api/search?q=' + encodeURIComponent(q)) : {};
        node = r.scripture ? h('a', { class: 'card hover pad row', href: '/bible?ref=' + encodeURIComponent(r.scripture.reference), 'data-link': '', 'data-group': 'faith' }, h('span', { class: 'ico-tile', html: icon('bookOpen', { size: 22 }) }), h('div', { class: 'grow' }, h('strong', null, r.scripture.reference), h('div', { class: 'muted small' }, 'Open in the Bible reader')), frag(icon('chevronRight')))
          : empty('bookOpen', 'Type a reference', 'Try “John 3:16”, “Psalm 23” or “Rom 8:28-39”.', h('a', { class: 'btn', href: '/bible', 'data-link': '' }, 'Open Bible'));
      } else {
        const sp = new URLSearchParams({ limit: '30' }); if (q) sp.set('q', q); if (category) sp.set('category', category); if (status) sp.set('status', status);
        const r = await api('/api/discover?' + sp);
        node = r.events.length ? h('div', { class: 'grid-cards stagger' }, r.events.map((e) => eventCard(e)))
          : empty('compass', q ? `Nothing matches “${q}”` : 'No events here yet', 'Try another category — or host the first one.', h('a', { class: 'btn primary', href: '/create', 'data-link': '' }, 'Create event'));
      }
      if (my !== seq) return;
      results.innerHTML = ''; results.append(node);
    } catch (e) { if (my === seq) { results.innerHTML = ''; results.append(empty('alert', 'Could not load', e.message)); } }
  }
  input.addEventListener('input', debounce(() => { q = input.value.trim(); sync(); }, 280));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q = input.value.trim(); sync(); } });
  load();
  if (isSearch && !q) setTimeout(() => input.focus(), 50);
}
