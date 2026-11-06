import { h, api, esc, avatar, fmtDur } from '../ui.js';
import { icon } from '../icons.js';
import { state, navigate } from '../app.js';

function fmtTimeOnly(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch { return ''; }
}

export async function mount(view, params) {
  const token = params.token;
  view.append(h('div', { class: 'skel', style: { height: '400px' } }));
  let data;
  try {
    data = await api(`/api/attendance/${token}`);
  } catch (e) {
    view.innerHTML = '';
    view.append(h('div', { class: 'empty' }, h('h2', null, 'Attendance list unavailable'), h('p', { class: 'muted' }, e.message || 'Not found or private')));
    return;
  }
  view.innerHTML = '';

  const m = data.meeting;
  const isOwner = state.user && state.user.id === m.hostUserId;
  const hostAtt = data.attendees.find(a => a.isHost) || { name: m.hostName, userId: m.hostUserId, signIns: [], signOut: null, durationSec: 0, interruptions: false };
  const others = data.attendees.filter(a => !a.isHost);

  const nameLink = (a) => {
    if (!a.userId) return esc(a.name);
    return h('a', { href: `/u/${a.username || a.userId}`, 'data-link': '' }, esc(a.name));
  };

  const row = (a, role) => h('tr', null,
    h('td', null, h('div', { class: 'row gap-s' }, avatar(a.name, null, 'sm'), h('div', null, nameLink(a), role ? h('div', { class: 'tiny muted' }, role) : null))),
    h('td', null, (a.signIns || []).map(fmtTimeOnly).join(', ') || '—'),
    h('td', null, a.signOut ? fmtTimeOnly(a.signOut) : '—'),
    h('td', null, fmtDur(a.durationSec || 0)),
    h('td', null, a.interruptions ? 'Yes' : '—')
  );

  const table = h('table', { class: 'att-table' },
    h('thead', null, h('tr', null,
      h('th', null, 'Person'),
      h('th', null, 'Sign-in'),
      h('th', null, 'Sign-out'),
      h('th', null, 'Duration'),
      h('th', null, 'Interruptions')
    )),
    h('tbody', null, row(hostAtt, 'Host'), ...others.map(a => row(a, a.isCohost ? 'Co-host' : 'Participant')))
  );

  const actions = h('div', { class: 'row gap-s no-print', style: { marginTop: '1.5rem', flexWrap: 'wrap' } },
    h('button', { class: 'btn primary', onclick: () => window.print(), html: icon('download', { size: 16 }) + ' Export PDF' }),
    isOwner ? h('button', { class: 'btn', onclick: async () => {
      try {
        await api('/api/attendance/toggle', { method: 'POST', body: { token, public: !data.isPublic } });
        location.reload();
      } catch (e) { alert(e.message); }
    } }, data.isPublic ? 'Make private' : 'Make public') : null,
    isOwner && data.isPublic ? h('button', { class: 'btn', onclick: async () => {
      try {
        await api('/api/attendance/share-timeline', { method: 'POST', body: { token } });
        alert('Shared to your timeline');
      } catch (e) { alert(e.message); }
    } }, 'Share to timeline') : null,
    h('a', { class: 'btn ghost', href: '/dashboard', 'data-link': '' }, 'Dashboard')
  );

  const dateLine = fmtDate(m.createdAt) + (m.endedAt && fmtDate(m.endedAt) !== fmtDate(m.createdAt) ? ' – ' + fmtDate(m.endedAt) : '');

  view.append(
    h('div', { class: 'att-page' },
      h('div', { class: 'att-hero' },
        h('div', { class: 'att-brand', html: icon('stage', { size: 28 }) + '<span>1venue</span>' }),
        h('h1', null, esc(m.name)),
        h('div', { class: 'muted' }, `Attendance · ${dateLine}`),
        h('div', { class: 'host-card' },
          avatar(hostAtt.name, null, 'lg ring'),
          h('div', null, h('div', { class: 'tiny muted' }, 'Host'), nameLink(hostAtt))
        )
      ),
      h('div', { class: 'att-body card pad' },
        h('h2', null, 'Attendees'),
        table,
        h('p', { class: 'tiny muted', style: { marginTop: '.8rem' } }, 'Sign-ins are comma-separated when someone left and rejoined. Sign-out shows the final departure. Duration is total time present.')
      ),
      actions
    )
  );
}

export const barPinned = null;
