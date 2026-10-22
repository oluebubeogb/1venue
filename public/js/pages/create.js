import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, uploadFile } from '../ui.js';
import { state, navigate, requireLogin, CATS, ACCENTS } from '../app.js';
import { catOf } from '../components.js';

export async function mount(view, params) {
  if (params.instant) return instant(view);
  if (!requireLogin('Sign in to create events')) return;
  const editing = params.edit ? await api(`/api/events/${encodeURIComponent(params.edit)}`).catch(() => null) : null;
  const ev = editing || { category: params.category || 'talk_show', visibility: 'public', speakerSeats: 4, theme: { accent: state.prefs.accent, accent2: state.prefs.accent2 || ACCENTS.find((a) => a[1] === state.prefs.accent)?.[2] || '#7c3aed' }, tags: [] };
  let category = ev.category, visibility = ev.visibility, seats = ev.speakerSeats || 4, coverUrl = ev.coverUrl || null;
  let acc = ev.theme?.accent || '#2563eb', acc2 = ev.theme?.accent2 || '#7c3aed';
  const title = h('input', { class: 'input lg', placeholder: 'Give it a name people will click', value: ev.title || '', maxlength: 120 });
  const desc = h('textarea', { class: 'textarea', rows: 5, placeholder: 'What’s it about? Who should come? Markdown supported.' }); desc.value = ev.description || '';
  const tags = h('input', { class: 'input', placeholder: 'faith, tech, lagos', value: (ev.tags || []).join(', ') });
  const toLocal = (d) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const starts = h('input', { class: 'input', type: 'datetime-local', value: toLocal(ev.startsAt) });
  const ends = h('input', { class: 'input', type: 'datetime-local', value: toLocal(ev.endsAt) });
  const catChips = h('div', { class: 'chips' }, CATS.concat([['other', 'Other', 'sparkle']]).map(([k, l, ic]) => h('button', { type: 'button', class: `chip${category === k ? ' on' : ''}`, style: { '--g': catOf(k)[2] }, 'data-c': k, html: icon(ic, { size: 15 }) + esc(l), onclick: () => { category = k; catChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.c === k)); preview(); } })));
  const visSeg = h('div', { class: 'seg' }, [['public', 'Public', 'globe'], ['unlisted', 'Unlisted', 'link'], ['private', 'Private', 'lock']].map(([v, l, ic]) => h('button', { type: 'button', class: visibility === v ? 'on' : '', 'data-v': v, html: icon(ic, { size: 15 }) + l, onclick: () => { visibility = v; visSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); } })));
  const seatVal = h('strong', { style: { minWidth: '2ch', textAlign: 'center', fontSize: '1.2rem' } }, String(seats));
  const stepper = h('div', { class: 'row' }, h('button', { type: 'button', class: 'icon-btn', 'data-group': 'people', 'aria-label': 'Fewer seats', html: icon('chevronLeft'), onclick: () => { seats = Math.max(1, seats - 1); seatVal.textContent = seats; } }), seatVal,
    h('button', { type: 'button', class: 'icon-btn', 'data-group': 'people', 'aria-label': 'More seats', html: icon('chevronRight'), onclick: () => { seats = Math.min(50, seats + 1); seatVal.textContent = seats; } }));
  const swatches = h('div', { class: 'swatches' }, ACCENTS.map(([n, a, a2]) => h('button', { type: 'button', class: `swatch${acc === a ? ' on' : ''}`, 'data-tip': n, style: { background: `linear-gradient(135deg, ${a}, ${a2})` }, 'aria-label': n, onclick: (e) => { acc = a; acc2 = a2; swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); e.currentTarget.classList.add('on'); preview(); } })));
  const coverIn = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const prev = h('div', { class: 'ev-card card', style: { pointerEvents: 'none' } });
  function preview() {
    const [cl, ci] = catOf(category);
    prev.innerHTML = '';
    prev.append(h('div', { class: 'cover', style: { '--c1': acc, '--c2': acc2 } }, coverUrl ? h('img', { src: coverUrl, alt: '' }) : h('div', { class: 'art', html: '<svg viewBox="0 0 160 160" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M36 54 L62 34 L62 122" stroke-width="16"/><path d="M88 36 L128 62 L128 118 L88 118 L88 98" stroke-width="5.5"/></svg>' })),
      h('div', { class: 'body' }, h('span', { class: 'cat', style: { '--g': catOf(category)[2] }, html: icon(ci, { size: 13 }) + esc(cl) }), h('div', { class: 'title' }, title.value || 'Your event title')));
  }
  title.addEventListener('input', preview); preview();
  coverIn.onchange = async () => {
    const f = coverIn.files[0]; if (!f) return;
    try { const r = await uploadFile(f, { purpose: 'cover' }); coverUrl = r.url; preview(); toast('Cover uploaded', { icon: 'image' }); } catch (e) { toastErr(e); }
  };
  const aiBtn = h('button', { type: 'button', class: 'btn sm', 'data-group': 'ai', html: icon('sparkles', { size: 15 }) + 'Write it for me' });
  aiBtn.onclick = async () => {
    const notes = [title.value, desc.value].filter(Boolean).join('\n') || catOf(category)[0];
    aiBtn.disabled = true;
    try { const r = await api('/api/ai/title', { method: 'POST', body: { notes, category } }); if (r.title) title.value = r.title; if (r.description) desc.value = r.description; preview(); toast(r.mock ? 'AI demo mode — add RunPod keys for real suggestions' : 'Drafted with AI', { icon: 'sparkles', group: 'ai' }); } catch (e) { toastErr(e); } finally { aiBtn.disabled = false; }
  };
  const submit = h('button', { class: 'btn primary lg', type: 'submit', html: icon(editing ? 'check' : 'calendarPlus', { size: 18 }) + (editing ? 'Save changes' : 'Publish event') });
  const liveNow = editing ? null : h('button', { type: 'button', class: 'btn lg', 'data-group': 'engage', html: icon('radio', { size: 18 }) + 'Publish & go live' });
  const field = (label, ic, el, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl', html: icon(ic, { size: 15 }) + esc(label) }), el, hint ? h('span', { class: 'tiny faint' }, hint) : null);
  const body = () => ({ title: title.value, description: desc.value, category, visibility, tags: tags.value, speakerSeats: seats, theme: { accent: acc, accent2: acc2 }, coverUrl, startsAt: starts.value ? new Date(starts.value).toISOString() : null, endsAt: ends.value ? new Date(ends.value).toISOString() : null });
  async function save(goLive) {
    try {
      const r = editing ? await api(`/api/events/${editing.id}`, { method: 'PATCH', body: body() }) : await api('/api/events', { method: 'POST', body: body() });
      toast(editing ? 'Saved' : 'Event published', { icon: 'check', group: 'engage' });
      if (goLive) { sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, eventId: r.id, name: r.title, stage: category !== 'meeting', speakerSeats: seats, code: r.code })); navigate(`/${r.code.slice(0, 3)}-${r.code.slice(3)}`); }
      else navigate(`/e/${r.slug}`);
    } catch (e) { toastErr(e); }
  }
  if (liveNow) liveNow.onclick = () => save(true);
  const form = h('form', { class: 'col', style: { gap: '1.1rem' }, onsubmit: (e) => { e.preventDefault(); save(false); } },
    h('div', { class: 'card pad layer col' }, field('Title', 'type', title), h('div', { class: 'row between' }, h('span', { class: 'lbl', html: icon('notes', { size: 15 }) + 'Description' }), aiBtn), desc),
    h('div', { class: 'card pad layer col' }, h('span', { class: 'lbl', html: icon('tag', { size: 15 }) + 'Category' }), catChips, field('Tags', 'hash', tags, 'Comma separated — helps discovery')),
    h('div', { class: 'card pad layer col' }, h('div', { class: 'grid2' }, field('Starts', 'calendar', starts), field('Ends', 'clock', ends)),
      h('div', { class: 'row between wrap' }, h('span', { class: 'lbl', html: icon('eye', { size: 15 }) + 'Visibility' }), visSeg),
      h('div', { class: 'row between wrap' }, h('div', null, h('span', { class: 'lbl', html: icon('stage', { size: 15 }) + 'Speaker seats' }), h('div', { class: 'tiny faint' }, 'Everyone else watches and can request to speak.')), stepper)),
    h('div', { class: 'card pad layer col' }, h('span', { class: 'lbl', html: icon('palette', { size: 15 }) + 'Event colours (used on cards, QR codes and the room)' }), swatches,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', 'data-group': 'content', html: icon('image', { size: 15 }) + (coverUrl ? 'Change cover' : 'Upload cover'), onclick: () => coverIn.click() }), coverIn)),
    h('div', { class: 'row wrap', style: { gap: '.6rem' } }, submit, liveNow));
  view.append(h('div', { class: 'page-head' }, h('h1', { html: icon(editing ? 'pen' : 'calendarPlus', { size: 28 }) + (editing ? 'Edit event' : 'Create an event') }), h('p', { class: 'muted' }, 'Talk show, seminar, sermon or class — it’ll show up in Discover with a themed QR invite.')),
    h('div', { class: 'split' }, form, h('aside', { class: 'sticky col' }, h('div', { class: 'tiny muted', html: icon('eye', { size: 14 }) + ' Preview' }), prev,
      h('div', { class: 'card pad layer small muted' }, h('strong', null, 'Just need a quick call? '), h('a', { href: '/create?instant=1', 'data-link': '' }, 'Start an instant meeting')))));
}

function instant(view) {
  const name = h('input', { class: 'input lg', placeholder: 'Meeting name', value: state.user ? `${state.user.displayName.split(' ')[0]}’s meeting` : 'Quick meeting', maxlength: 60 });
  let stage = false, waiting = false;
  const sw = (label, ic, g, get, set, hint) => { const t = h('input', { type: 'checkbox', checked: get() }); t.onchange = () => set(t.checked); return h('label', { class: 'set-row' }, h('span', { class: 'ico', style: { '--g': `var(--g-${g})` }, html: icon(ic) }), h('div', { class: 'grow' }, h('div', null, label), h('div', { class: 'tiny faint' }, hint)), h('span', { class: 'switch' }, t, h('span'))); };
  const go = () => { sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, name: name.value.trim() || 'Meeting', stage, waitingRoom: waiting })); navigate('/new'); };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  view.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card pad-lg auth-card col', style: { gap: '1rem' } },
    h('div', { class: 'ico-tile big', 'data-group': 'media', html: icon('zap', { size: 30 }) }),
    h('h1', { style: { fontSize: '1.5rem', textAlign: 'center' } }, 'Instant meeting'),
    name,
    h('div', { class: 'layer', style: { borderRadius: '16px' } },
      sw('Stage mode', 'stage', 'people', () => stage, (v) => { stage = v; }, 'Limited speaker seats, audience requests to speak'),
      sw('Waiting room', 'door', 'admin', () => waiting, (v) => { waiting = v; }, 'You admit people before they enter')),
    h('button', { class: 'btn primary lg block', onclick: go, html: icon('video', { size: 20 }) + 'Start now' }),
    h('p', { class: 'tiny faint', style: { textAlign: 'center' } }, 'You’ll check your camera and mic first.'))));
}
