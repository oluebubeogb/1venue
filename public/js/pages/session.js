import { icon } from '../icons.js';
import { h, api, toast, toastErr, md, timeAgo, fmtDate, fmtDur, copy, hue, debounce, confirmDlg, download } from '../ui.js';
import { pendingSessionRecording, clearSessionRecording } from '../room/recorder.js';
import { requireLogin, navigate } from '../app.js';
import { panel, table, iconBtn, empty, pill } from '../host-kit.js';
import { registerCommands, unregisterCommands } from '../commands.js';
import { certEditor } from '../cert-ui.js';


function liveActions(s, view) {
  const endBtn = h('button', { type: 'button', class: 'btn ev-act sess-end-meeting', 'data-group': 'session', 'data-tip': 'End meeting', 'aria-label': 'End meeting', html: icon('phoneOff', { size: 18 }) + '<span class="ev-act-lbl">End meeting</span>' });
  endBtn.onclick = async () => {
    if (!await confirmDlg('End this meeting for everyone? Billing will close and the room will stop.', { ok: 'End meeting', danger: true })) return;
    try {
      await api(`/api/meeting/${s.code}/end`, { method: 'POST' });
      toast('Meeting ended', { icon: 'phoneOff' });
      navigate(`/session/${s.id}`, { replace: true });
    } catch (e) { toastErr(e); }
  };
  return h('div', { class: 'ev-actionbar sess-live-actions', 'data-group': 'session' },
    h('a', { class: 'btn ev-act', href: `/${String(s.code).toLowerCase()}?rejoin=1`, 'data-link': '', 'data-tip': 'Rejoin', 'aria-label': 'Rejoin', html: icon('login', { size: 18 }) + '<span class="ev-act-lbl">Rejoin</span>' }),
    endBtn);
}


function certsPanel(s) {
  const box = h('div', { class: 'card ht-panel sess-certs-panel', hidden: true });
  let editor = null;
  let issued = [];
  const list = h('div', { class: 'sess-cert-list' });
  const names = h('textarea', { class: 'textarea', rows: 3, placeholder: 'One name per line. Add an email if you have one: Ada Lovelace, ada@email.com' });
  const paintList = () => {
    list.replaceChildren();
    if (!issued.length) {
      list.append(h('p', { class: 'muted small', style: { margin: 0 } }, 'No certificates issued yet.'));
      return;
    }
    issued.forEach((c) => {
      const link = c.url || `${location.origin}/cert/${c.code}`;
      list.append(h('div', { class: 'sess-cert-row' },
        h('div', { class: 'grow minw0' },
          h('b', null, c.attendeeName),
          h('span', { class: 'tiny muted' }, [c.code, c.source === 'manual' ? 'added by you' : null, c.recipientEmail || null].filter(Boolean).join(' · '))),
        h('a', { class: 'btn xs', href: `/cert/${c.code}`, 'data-link': '' }, 'Open'),
        h('button', { class: 'btn xs', type: 'button', html: icon('copy', { size: 13 }) + 'Copy link', onclick: () => copy(link, 'Link copied') }),
        h('a', { class: 'btn xs', href: `/api/certs/${c.code}/pdf?download=1` }, 'Download')));
    });
  };
  const load = async () => {
    const r = await api(`/api/sessions/${s.id}/certs`);
    issued = r.issued || [];
    if (!editor) {
      editor = certEditor(r.certs || {}, { eventTitle: s.name, startsAt: s.startedAt, endsAt: s.endedAt });
      editorSlot.replaceWith(editor);
    }
    paintList();
    return r;
  };
  const editorSlot = h('div', { class: 'sess-cert-editor-slot muted small' }, 'Loading certificate settings…');
  const saveBtn = h('button', { class: 'btn sm primary', type: 'button', html: icon('check', { size: 15 }) + 'Save settings' });
  saveBtn.onclick = async () => {
    try {
      await api(`/api/sessions/${s.id}/certs`, { method: 'POST', body: editor.get() });
      toast('Certificate settings saved', { icon: 'check' });
    } catch (e) { toastErr(e); }
  };
  const issueBtn = h('button', { class: 'btn sm', type: 'button', html: icon('send', { size: 15 }) + 'Issue certificates' });
  issueBtn.onclick = async () => {
    if (editor) {
      try { await api(`/api/sessions/${s.id}/certs`, { method: 'POST', body: editor.get() }); } catch (e) { toastErr(e); return; }
    }
    issueBtn.disabled = true;
    try {
      const r = await api(`/api/sessions/${s.id}/certs/issue`, { method: 'POST', body: {} });
      issued = (await api(`/api/sessions/${s.id}/certs`)).issued || [];
      paintList();
      toast(r.count ? `Issued ${r.count} certificate${r.count === 1 ? '' : 's'}` : 'Everyone eligible already has a certificate', { icon: 'graduation' });
    } catch (e) { toastErr(e); } finally { issueBtn.disabled = false; }
  };
  const addBtn = h('button', { class: 'btn sm', type: 'button', html: icon('plus', { size: 15 }) + 'Generate' });
  addBtn.onclick = async () => {
    const text = names.value.trim();
    if (!text) return toast('Add at least one name', { icon: 'info' });
    addBtn.disabled = true;
    try {
      const r = await api(`/api/sessions/${s.id}/certs/manual`, { method: 'POST', body: { names: text } });
      issued = [...(r.issued || []), ...issued];
      paintList();
      names.value = '';
      toast(`Created ${r.count} certificate${r.count === 1 ? '' : 's'}`, { icon: 'graduation' });
    } catch (e) { toastErr(e); } finally { addBtn.disabled = false; }
  };
  box.append(
    h('header', { class: 'ht-panel-head' },
      h('span', { class: 'ico-tile ht-ico', html: icon('graduation', { size: 18 }) }),
      h('div', { class: 'grow ht-panel-title' }, h('h2', null, 'Certificates')),
      h('div', { class: 'ht-panel-actions' }, saveBtn, issueBtn)),
    h('div', { class: 'ht-panel-body sess-certs-body' },
      h('p', { class: 'small muted', style: { margin: '0 0 .6rem' } }, s.live
        ? 'Set the wording and design now. When the meeting ends, everyone who stayed long enough is emailed and notified automatically. You can also issue them from here.'
        : 'Issue certificates to people who attended, or add names for anyone without an account and share their links.'),
      editorSlot,
      h('div', { class: 'sess-cert-manual' },
        h('h3', { class: 'sess-cert-sub' }, 'Add names'),
        h('p', { class: 'tiny muted', style: { margin: '0 0 .35rem' } }, 'For guests without a 1venue account. If you include an email, we send the certificate there.'),
        names, addBtn),
      h('h3', { class: 'sess-cert-sub' }, 'Issued'),
      list));
  let opened = false;
  const toggle = async () => {
    if (box.hidden) {
      box.hidden = false;
      if (!opened) {
        opened = true;
        try { await load(); } catch (e) { toastErr(e); editorSlot.textContent = 'Could not load certificate settings.'; }
      }
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else box.hidden = true;
  };
  return { box, toggle, issue: () => issueBtn.click() };
}

export async function mount(view, params) {
  document.body.dataset.page = params.list ? 'sessions' : 'session';
  view.classList.add('ht-view', 'sess-view');
  if (params.list) return list(view);
  let s, loadError;
  try { s = await api(`/api/sessions/${params.id}`); } catch (err) { loadError = err; }
  const pending = pendingSessionRecording(params.id);
  const recordingButton = pending ? h('button', {
    class: 'btn sm',
    type: 'button',
    disabled: true,
  }, 'Preparing recording…') : null;
  if (pending) pending.then((recording) => {
    if (!recording) {
      recordingButton.remove();
      clearSessionRecording(params.id, pending);
      return;
    }
    recordingButton.disabled = false;
    recordingButton.innerHTML = icon('download', { size: 15 }) + 'Download recording';
    recordingButton.onclick = () => {
      download(recording.name, recording.blob, recording.type);
      clearSessionRecording(params.id, pending);
    };
  });
  if (!s) {
    const dashboard = h('a', { class: 'btn', href: '/dashboard', 'data-link': '' }, 'Dashboard');
    view.append(empty('lock', 'Can’t open this session', loadError?.message || 'The session could not be loaded.',
      recordingButton ? h('div', { class: 'row wrap gap-s' }, dashboard, recordingButton) : dashboard));
    return;
  }
  const lines = [];
  for (const g of s.segments) { const l = lines[lines.length - 1]; if (l && l.name === g.speakerName && new Date(g.at) - l.at < 20000) { l.text += ' ' + g.text; l.at = new Date(g.at); } else lines.push({ name: g.speakerName, text: g.text, at: new Date(g.at), t0: new Date(g.at) }); }
  const start = new Date(s.startedAt);
  const sums = Object.fromEntries((s.summaries || []).map((x) => [x.kind, x]));
  const filter = h('input', { class: 'input sm', placeholder: 'Search transcript…', 'aria-label': 'Search transcript' });
  const tx = h('div', { class: 'transcript sess-transcript' });
  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    tx.innerHTML = '';
    const shown = lines.filter((l) => !q || (l.name + ' ' + l.text).toLowerCase().includes(q));
    if (!shown.length) tx.append(h('p', { class: 'muted small' }, lines.length ? 'No matches' : 'No transcript was captured for this session. Turn on captions in the room to record one.'));
    shown.forEach((l) => tx.append(h('div', { class: 'tline' }, h('span', { class: 'ts' }, fmtDur(Math.max(0, (l.t0 - start) / 1000))), h('div', null, h('strong', { style: { color: `hsl(${hue(l.name)} 70% var(--name-l, 45%))` } }, l.name + ': '), h('span', null, l.text)))));
  };
  filter.addEventListener('input', debounce(paint, 120)); paint();
  const sumBox = (kind, title, ic) => {
    const box = h('div', { class: 'card ht-panel sess-ai', 'data-group': 'ai' });
    const render = () => {
      box.innerHTML = '';
      const cur = sums[kind];
      const btn = h('button', { class: `btn sm${cur ? '' : ' primary'}`, html: icon('sparkles', { size: 15 }) + (cur ? 'Regenerate' : `Generate ${title.toLowerCase()}`) });
      btn.onclick = async () => { btn.disabled = true; btn.innerHTML = icon('loader', { size: 15, cls: 'spin' }) + 'Thinking…'; try { sums[kind] = await api(`/api/sessions/${s.id}/summary`, { method: 'POST', body: { kind } }); render(); toast(`${title} ready`, { icon: 'sparkles', group: 'ai' }); } catch (e) { toastErr(e); render(); } };
      box.append(
        h('header', { class: 'ht-panel-head' },
          h('span', { class: 'ico-tile ht-ico', html: icon(ic, { size: 18 }) }),
          h('div', { class: 'grow ht-panel-title' }, h('h2', null, title)),
          h('div', { class: 'ht-panel-actions' }, btn)),
        h('div', { class: 'ht-panel-body' },
          cur ? h('div', { class: 'prose', html: md(cur.content) }) : h('p', { class: 'small muted', style: { margin: 0 } }, 'One click - AI reads the transcript for you.'),
          cur ? h('div', { class: 'row between tiny faint' }, h('span', null, `${cur.provider || 'ai'} · ${timeAgo(cur.createdAt)}`), h('button', { class: 'btn xs ghost', html: icon('copy', { size: 13 }) + 'Copy', onclick: () => copy(cur.content, 'Copied') })) : null));
    };
    render(); return box;
  };
  const duration = s.endedAt ? fmtDur((new Date(s.endedAt) - start) / 1000) : 'in progress';
  const certs = s.isHost ? certsPanel(s) : null;
  view.append(
    h('div', { class: 'page-head ht-head sess-head' },
      h('div', { class: 'sess-head-row' },
        h('h1', { html: icon('history', { size: 26 }) + (s.name || 'Session') }),
        (s.live && s.isHost) ? liveActions(s, view) : null),
      h('p', { class: 'muted small sess-meta' }, [String(s.code).toLowerCase(), fmtDate(s.startedAt), duration, `${lines.length} transcript line${lines.length === 1 ? '' : 's'}`].join(' · '))),
    h('div', { class: 'sess-toolbar' },
      recordingButton,
      h('a', { class: 'btn sm', href: `/api/sessions/${s.id}/transcript.txt`, download: '', html: icon('download', { size: 15 }) + 'Transcript .txt' }),
      Object.keys(sums).length ? h('a', { class: 'btn sm', href: `/api/sessions/${s.id}/summary.md`, download: '', html: icon('fileText', { size: 15 }) + 'Summary .md' }) : null,
      h('button', { class: 'btn sm', type: 'button', html: icon('users', { size: 15 }) + 'Attendance list', onclick: async () => {
        try {
          const r = await api('/api/attendance/generate', { method: 'POST', body: { historyId: s.id, public: true } });
          navigate(r.url);
        } catch (e) { toastErr(e); }
      } }),
      h('button', { class: 'btn sm', type: 'button', html: icon('copy', { size: 15 }) + 'Copy transcript', onclick: () => copy(lines.map((l) => `${l.name}: ${l.text}`).join('\n'), 'Transcript copied') }),
      certs ? h('button', { class: 'btn sm', type: 'button', html: icon('graduation', { size: 15 }) + 'Certificates', onclick: () => certs.toggle() }) : null),
    ...(certs ? [certs.box] : []),
    h('div', { class: 'sess-split' },
      panel({ icon: 'captions', title: 'Transcript', actions: filter, cls: 'sess-tx-panel' }, tx),
      h('aside', { class: 'col sess-aside' }, sumBox('summary', 'Summary', 'sparkles'), sumBox('action_items', 'Action items', 'listChecks'))));
  registerCommands('page', [
    { id: 's-sum', label: 'Generate AI summary', icon: 'sparkles', group: 'ai', run: () => view.querySelectorAll('[data-group=ai] .btn')[0]?.click() },
    { id: 's-act', label: 'Extract action items', icon: 'listChecks', group: 'ai', run: () => view.querySelectorAll('[data-group=ai] .btn')[1]?.click() },
    { id: 's-dl', label: 'Download transcript', icon: 'download', group: 'content', run: () => { location.href = `/api/sessions/${s.id}/transcript.txt`; } },
    { id: 's-find', label: 'Search in transcript', icon: 'search', group: 'content', run: () => filter.focus() },
    certs ? { id: 's-certs', label: 'Certificates', icon: 'graduation', group: 'content', run: () => certs.toggle() } : null,
  ].filter(Boolean));
  return { unmount: () => { unregisterCommands('page'); if (document.body.dataset.page === 'session') delete document.body.dataset.page; } };
}

async function list(view) {
  if (!requireLogin('Sign in to see your sessions')) return;
  const r = await api('/api/history?limit=100');
  const rows = (r.history || []).map((x) => {
    const dur = x.endedAt ? fmtDur((new Date(x.endedAt) - new Date(x.createdAt)) / 1000) : 'Live';
    return [
      h('a', { href: `/session/${x.id}`, 'data-link': '', class: 'ht-strong sess-name' },
        h('span', null, x.name || String(x.code).toLowerCase()),
        h('span', { class: 'tiny faint' }, String(x.code).toLowerCase())),
      fmtDate(x.createdAt),
      pill(x.wasHost ? 'Hosted' : 'Joined', x.wasHost ? 'accent' : 'muted', x.wasHost ? 'radio' : 'users'),
      x.maxParticipants ? String(x.maxParticipants) : '-',
      dur,
      iconBtn('chevronRight', 'Open session', { href: `/session/${x.id}` }),
    ];
  });
  view.append(
    h('div', { class: 'page-head ht-head' },
      h('h1', { html: icon('history', { size: 26 }) + 'Sessions' })),
    panel({ icon: 'history', title: 'Your sessions', desc: r.history.length ? `${r.history.length} session${r.history.length === 1 ? '' : 's'}` : 'None yet.' },
      r.history.length
        ? table(
          [{ label: 'Session' }, { label: 'When' }, { label: 'Role' }, { label: 'People', num: true }, { label: 'Duration' }, { label: '', cls: 'ht-act' }],
          rows,
          { caption: 'Your sessions' },
        )
        : empty('history', 'No sessions yet', 'Join or host a meeting and it’ll show up here with its transcript.', h('a', { class: 'btn primary sm', href: '/create?instant=1', 'data-link': '' }, 'Start a meeting'))));
  return { unmount() { if (document.body.dataset.page === 'sessions') delete document.body.dataset.page; } };
}
