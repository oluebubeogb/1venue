import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, uploadFile, avatar, debounce } from '../ui.js';
import { state, navigate, requireLogin, CATS, ACCENTS } from '../app.js';
import { catOf } from '../components.js';

const field = (label, ic, el, actions) => h('div', { class: 'field-row' },
  h('div', { class: 'field-lab' },
    h('span', { class: 'ico-lab', html: icon(ic, { size: 15 }) }),
    h('span', null, label),
    actions ? h('span', { class: 'lab-actions' }, actions) : null),
  el);

export async function mount(view, params) {
  if (params.instant) return instant(view);
  if (!requireLogin('Sign in to create events')) return;
  const editing = params.edit ? await api(`/api/events/${encodeURIComponent(params.edit)}`).catch(() => null) : null;
  const ev = editing || { category: params.category || 'talk_show', visibility: 'public', speakerSeats: 4, theme: { accent: state.prefs.accent, accent2: state.prefs.accent2 || ACCENTS.find((a) => a[1] === state.prefs.accent)?.[2] || '#7c3aed' }, tags: [] };
  let category = ev.category, visibility = ev.visibility, seats = ev.speakerSeats || 4, coverUrl = ev.coverUrl || null;
  let acc = ev.theme?.accent || '#2563eb', acc2 = ev.theme?.accent2 || '#7c3aed';
  let materialIds = [];
  let speakers = []; // { userId?, name, email?, headline?, avatarUrl? }

  if (editing) {
    try {
      const r = await api(`/api/events/${editing.id}/materials`);
      materialIds = (r.materials || []).map((m) => m.id);
    } catch { /* */ }
    try {
      const sp = await api(`/api/events/${editing.id}`);
      if (Array.isArray(sp.speakers)) speakers = sp.speakers.map((s) => ({ userId: s.userId, name: s.name, headline: s.headline || '', avatarUrl: s.avatarUrl || null, email: s.email || '' }));
    } catch { /* */ }
  }

  const title = h('input', { class: 'input lg', placeholder: 'Give it a name people will click', value: ev.title || '', maxlength: 120 });
  const desc = h('textarea', { class: 'textarea', rows: 5, placeholder: 'What’s it about? Who should come? Markdown supported.' }); desc.value = ev.description || '';
  const tags = h('input', { class: 'input', placeholder: 'faith, tech, lagos', value: (ev.tags || []).join(', ') });
  const toLocal = (d) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const starts = h('input', { class: 'input', type: 'datetime-local', value: toLocal(ev.startsAt) });
  const ends = h('input', { class: 'input', type: 'datetime-local', value: toLocal(ev.endsAt) });

  const catSel = h('select', { class: 'cat-select', 'aria-label': 'Category' });
  CATS.concat([['other', 'Other', 'sparkle']]).forEach(([k, l]) => {
    const o = h('option', { value: k }, l);
    if (k === category) o.selected = true;
    catSel.append(o);
  });
  catSel.onchange = () => { category = catSel.value; preview(); };

  const visSeg = h('div', { class: 'seg' }, [['public', 'Public', 'globe'], ['unlisted', 'Unlisted', 'link'], ['private', 'Private', 'lock']].map(([v, l, ic]) =>
    h('button', { type: 'button', class: visibility === v ? 'on' : '', 'data-v': v, html: icon(ic, { size: 15 }) + l, onclick: () => { visibility = v; visSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); } })));

  const seatVal = h('strong', { style: { minWidth: '2ch', textAlign: 'center', fontSize: '1.2rem' } }, String(seats));
  const stepper = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'icon-btn', 'data-group': 'people', 'aria-label': 'Fewer seats', html: icon('chevronLeft'), onclick: () => { seats = Math.max(1, seats - 1); seatVal.textContent = seats; } }),
    seatVal,
    h('button', { type: 'button', class: 'icon-btn', 'data-group': 'people', 'aria-label': 'More seats', html: icon('chevronRight'), onclick: () => { seats = Math.min(50, seats + 1); seatVal.textContent = seats; } }));

  // Speakers picker
  const speakerChips = h('div', { class: 'row wrap', style: { gap: '.4rem' } });
  const speakerInput = h('input', { class: 'input', placeholder: 'Name, @username or email…', autocomplete: 'off' });
  const speakerSug = h('div', { class: 'suggest-list', hidden: true });
  const paintSpeakers = () => {
    speakerChips.replaceChildren(...speakers.map((s, i) => h('span', { class: 'chip-mat' },
      s.avatarUrl || s.userId ? avatar(s.name, s.avatarUrl, 'xs') : null,
      s.name + (s.email && !s.userId ? ` · ${s.email}` : ''),
      h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onclick: () => { speakers.splice(i, 1); paintSpeakers(); } }, '−'))));
  };
  paintSpeakers();
  const searchSpeakers = debounce(async () => {
    const q = speakerInput.value.trim();
    if (q.length < 2) { speakerSug.hidden = true; return; }
    try {
      const r = await api('/api/users/search?q=' + encodeURIComponent(q));
      const users = r.users || [];
      speakerSug.replaceChildren();
      users.forEach((u) => {
        speakerSug.append(h('button', { type: 'button', onclick: () => {
          if (speakers.some((s) => s.userId === u.id)) return toast('Already added', { icon: 'info' });
          speakers.push({ userId: u.id, name: u.name, avatarUrl: u.avatarUrl || null, headline: u.handle ? '@' + u.handle : '' });
          speakerInput.value = ''; speakerSug.hidden = true; paintSpeakers();
        } }, avatar(u.name, u.avatarUrl, 'sm'), h('div', { class: 'grow' }, h('b', null, u.name), h('div', { class: 'tiny muted' }, u.handle ? '@' + u.handle : (u.email || '')))));
      });
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
      if (isEmail && !users.some((u) => (u.email || '').toLowerCase() === q.toLowerCase())) {
        speakerSug.append(h('button', { type: 'button', onclick: () => {
          speakers.push({ name: q.split('@')[0], email: q.toLowerCase(), headline: 'Invited by email' });
          speakerInput.value = ''; speakerSug.hidden = true; paintSpeakers();
        } }, h('span', { class: 'ico-tile sm', html: icon('mail', { size: 16 }) }), h('div', { class: 'grow' }, h('b', null, 'Invite ' + q), h('div', { class: 'tiny muted' }, 'Will sync when they sign up'))));
      }
      if (!users.length && !isEmail) {
        speakerSug.append(h('button', { type: 'button', onclick: () => {
          speakers.push({ name: q, headline: '' });
          speakerInput.value = ''; speakerSug.hidden = true; paintSpeakers();
        } }, h('span', { class: 'ico-tile sm', html: icon('userPlus', { size: 16 }) }), h('div', { class: 'grow' }, h('b', null, 'Add “' + q + '”'), h('div', { class: 'tiny muted' }, 'Guest speaker'))));
      }
      speakerSug.hidden = !speakerSug.childNodes.length;
    } catch { speakerSug.hidden = true; }
  }, 220);
  speakerInput.addEventListener('input', searchSpeakers);
  speakerInput.addEventListener('blur', () => setTimeout(() => { speakerSug.hidden = true; }, 180));

  // Materials autosuggest
  const matChips = h('div', { class: 'row wrap', style: { gap: '.4rem' } });
  const matInput = h('input', { class: 'input', placeholder: 'Search your materials…', autocomplete: 'off' });
  const matSug = h('div', { class: 'suggest-list', hidden: true });
  let allMats = [];
  const paintMats = () => {
    const selected = allMats.filter((m) => materialIds.includes(m.id));
    matChips.replaceChildren(...selected.map((m) => {
      const th = m.kind === 'youtube' && m.payload?.videoId ? `https://i.ytimg.com/vi/${m.payload.videoId}/mqdefault.jpg`
        : m.kind === 'image' && m.payload?.url ? m.payload.url
        : (m.payload?.pages && m.payload.pages[0]) || null;
      return h('span', { class: 'chip-mat' },
        th ? h('img', { src: th, alt: '', style: { width: '22px', height: '22px', borderRadius: '5px', objectFit: 'cover' } }) : null,
        m.title,
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Remove', onclick: () => { materialIds = materialIds.filter((id) => id !== m.id); paintMats(); } }, '−'));
    }));
  };
  api('/api/materials').then((r) => { allMats = r.materials || []; paintMats(); }).catch(() => {});
  matInput.addEventListener('input', debounce(() => {
    const q = matInput.value.trim().toLowerCase();
    const list = allMats.filter((m) => !materialIds.includes(m.id) && (!q || m.title.toLowerCase().includes(q))).slice(0, 8);
    matSug.replaceChildren(...list.map((m) => {
      const th = m.kind === 'youtube' && m.payload?.videoId ? `https://i.ytimg.com/vi/${m.payload.videoId}/mqdefault.jpg`
        : m.kind === 'image' && m.payload?.url ? m.payload.url
        : (m.payload?.pages && m.payload.pages[0]) || null;
      return h('button', { type: 'button', onclick: () => {
        materialIds.push(m.id); matInput.value = ''; matSug.hidden = true; paintMats();
      } }, th ? h('img', { class: 'sug-thumb', src: th, alt: '' }) : h('span', { class: 'ico-tile sm', html: icon(m.kind === 'youtube' ? 'youtube' : 'presentation', { size: 14 }) }), h('b', { class: 'grow' }, m.title));
    }));
    matSug.hidden = !list.length;
  }, 180));
  matInput.addEventListener('blur', () => setTimeout(() => { matSug.hidden = true; }, 180));

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
    try {
      const r = await api('/api/ai/title', { method: 'POST', body: { notes, category } });
      if (r.title) title.value = r.title;
      if (r.description) desc.value = r.description;
      if (Array.isArray(r.tags) && r.tags.length) tags.value = r.tags.join(', ');
      preview();
      toast(r.mock ? 'AI demo mode — add RunPod keys for real suggestions' : 'Drafted with AI', { icon: 'sparkles', group: 'ai' });
    } catch (e) { toastErr(e); } finally { aiBtn.disabled = false; }
  };

  const submit = h('button', { class: 'btn primary lg', type: 'submit', html: icon(editing ? 'check' : 'calendarPlus', { size: 18 }) + (editing ? 'Save changes' : 'Publish event') });
  const liveNow = editing ? null : h('button', { type: 'button', class: 'btn lg', 'data-group': 'engage', html: icon('radio', { size: 18 }) + 'Publish & go live' });

  const body = () => ({
    title: title.value, description: desc.value, category, visibility, tags: tags.value,
    speakerSeats: seats, theme: { accent: acc, accent2: acc2 }, coverUrl,
    startsAt: starts.value ? new Date(starts.value).toISOString() : null,
    endsAt: ends.value ? new Date(ends.value).toISOString() : null,
    speakers: speakers.map((s) => ({ userId: s.userId || null, name: s.name, headline: s.headline || null, avatarUrl: s.avatarUrl || null, email: s.email || null })),
  });

  async function save(goLive) {
    try {
      const r = editing
        ? await api(`/api/events/${editing.id}`, { method: 'PATCH', body: body() })
        : await api('/api/events', { method: 'POST', body: body() });
      if (materialIds.length) {
        await api(`/api/events/${r.id}/materials`, { method: 'PUT', body: { materialIds } }).catch(() => {});
      }
      if (speakers.length && !editing) {
        await api(`/api/events/${r.id}/speakers`, { method: 'PUT', body: { speakers: body().speakers } }).catch(() => {});
      }
      toast(editing ? 'Saved' : 'Event published', { icon: 'check', group: 'engage' });
      if (goLive) {
        sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, eventId: r.id, name: r.title, stage: category !== 'meeting', speakerSeats: seats, code: r.code }));
        navigate('/' + String(r.code).toLowerCase());
      } else navigate(`/e/${r.slug}`);
    } catch (e) { toastErr(e); }
  }
  if (liveNow) liveNow.onclick = () => save(true);

  const form = h('form', { class: 'col', style: { gap: '1.1rem' }, onsubmit: (e) => { e.preventDefault(); save(false); } },
    h('div', { class: 'card pad layer col', style: { gap: '1rem' } },
      field('Title', 'type', title, aiBtn),
      field('Description', 'notes', desc),
      field('Category', 'tag', catSel),
      field('Tags', 'hash', tags)),
    h('div', { class: 'card pad layer col has-suggest', style: { gap: '1rem' } },
      h('div', { class: 'grid2' }, field('Starts', 'calendar', starts), field('Ends', 'clock', ends)),
      field('Visibility', 'eye', visSeg),
      field('Speaker seats', 'stage', h('div', { class: 'col has-suggest', style: { gap: '.6rem' } },
        h('div', { class: 'row between wrap' }, h('div', { class: 'tiny faint' }, 'Everyone else watches and can request to speak.'), stepper),
        h('div', { class: 'suggest-box' }, speakerInput, speakerSug),
        speakerChips,
      ))),
    h('div', { class: 'card pad layer col has-suggest', style: { gap: '1rem' } },
      field('Event colours', 'palette', swatches),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', 'data-group': 'content', html: icon('image', { size: 15 }) + (coverUrl ? 'Change cover' : 'Upload cover'), onclick: () => coverIn.click() }), coverIn),
      field('Materials', 'folder', h('div', { class: 'col', style: { gap: '.5rem' } },
        h('div', { class: 'suggest-box' }, matInput, matSug),
        matChips,
        h('a', { class: 'btn sm', href: '/materials', target: '_blank', rel: 'noopener', html: icon('folder', { size: 14 }) + 'Open materials library' }),
      ))),
    h('div', { class: 'row wrap', style: { gap: '.6rem' } }, submit, liveNow));

  view.append(
    h('div', { class: 'page-head' }, h('h1', { html: icon(editing ? 'pen' : 'calendarPlus', { size: 28 }) + (editing ? 'Edit event' : 'Create an event') })),
    h('div', { class: 'split' }, form, h('aside', { class: 'sticky col' },
      h('div', { class: 'preview-label' },
        h('span', { class: 'preview-eye', html: icon('eye', { size: 14 }) }),
        h('span', null, 'Preview')),
      prev,
      h('div', { class: 'card pad layer small muted' }, h('strong', null, 'Just need a quick call? '), h('a', { href: '/create?instant=1', 'data-link': '', style: { color: '#2563eb', fontWeight: '700' } }, 'Start an instant meeting')))));
}

function instant(view) {
  const name = h('input', { class: 'input lg', placeholder: 'Meeting name', value: state.user ? `${state.user.displayName.split(' ')[0]}’s meeting` : 'Quick meeting', maxlength: 120 });
  let stage = false, waiting = false;
  const sw = (label, ic, g, get, set, hint) => { const t = h('input', { type: 'checkbox', checked: get() }); t.onchange = () => set(t.checked); return h('label', { class: 'set-row' }, h('span', { class: 'ico', style: { '--g': `var(--g-${g})` }, html: icon(ic) }), h('div', { class: 'grow' }, h('div', null, label), h('div', { class: 'tiny faint' }, hint)), h('span', { class: 'switch' }, t, h('span'))); };
  const go = () => { sessionStorage.setItem('venue.intent', JSON.stringify({ create: true, name: name.value.trim() || 'Meeting', stage, waitingRoom: waiting })); navigate('/new'); };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  view.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'card pad-lg auth-card col', style: { gap: '1rem' } },
    h('h1', null, 'Instant meeting'),
    field('Name', 'type', name),
    sw('Stage mode', 'stage', 'people', () => stage, (v) => { stage = v; }, 'Audience watches; limited speaker seats'),
    sw('Waiting room', 'door', 'admin', () => waiting, (v) => { waiting = v; }, 'Admit people one by one'),
    h('button', { class: 'btn primary lg', type: 'button', onclick: go, html: icon('zap', { size: 18 }) + 'Start now' }))));
}
