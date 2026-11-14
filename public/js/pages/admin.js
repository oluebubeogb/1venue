// /admin: site admin tools (admins = confirmed emails in ADMIN_EMAILS). Demo data load/remove.
import { icon } from '../icons.js';
import { h, api, toast, toastErr, avatar, confirmDlg } from '../ui.js';
import { state, requireLogin } from '../app.js';

export async function mount(view) {
  if (!requireLogin('Sign in to continue')) return;
  view.append(h('div', { class: 'page-head' }, h('h1', { html: `<span class="ico-tile" data-group="admin">${icon('shield', { size: 20 })}</span> Admin` })));
  if (!state.user.isAdmin) {
    view.append(h('div', { class: 'card pad' }, h('h3', null, 'Admins only'),
      h('p', { class: 'muted small' }, 'Add your email to ADMIN_EMAILS in Coolify, redeploy, and confirm your email (Google sign-in counts).')));
    return;
  }
  const body = h('div', { class: 'col', style: { gap: '.8rem' } });
  const card = h('section', { class: 'card pad col', style: { gap: '.9rem' } },
    h('div', { class: 'row', style: { gap: '.6rem' } }, h('span', { class: 'ico-tile', 'data-group': 'people', html: icon('users', { size: 18 }) }),
      h('div', { class: 'grow' }, h('h3', null, 'Demo data'), h('p', { class: 'muted small' }, '10 sample accounts with events, posts, sessions and more. Remove it all in one click.'))),
    body);
  view.append(card);

  const load = h('button', { class: 'btn primary', type: 'button', html: icon('plus', { size: 16 }) + 'Load demo data' });
  const remove = h('button', { class: 'btn danger', type: 'button', html: icon('trash', { size: 16 }) + 'Remove demo data' });
  const busy = (on) => { load.disabled = on; remove.disabled = on; };
  function paint(s) {
    const stats = h('div', { class: 'row wrap small', style: { gap: '1.2rem' } },
      ...[['Accounts', s.users], ['Events', s.events], ['Posts', s.posts], ['Sessions', s.sessions]].map(([l, n]) => h('span', null, h('strong', null, String(n || 0)), ' ', l.toLowerCase())));
    load.lastChild.textContent = s.loaded ? 'Reload demo data' : 'Load demo data';
    remove.hidden = !s.loaded;
    body.replaceChildren(stats,
      s.loaded ? h('p', { class: 'small' }, 'Sign in as any demo account with password ', h('code', null, s.password), '.') : null,
      s.loaded ? h('div', { class: 'admin-seed-people' }, ...s.accounts.map((a) => h('a', { class: 'list-item', href: `/u/${a.username}`, 'data-link': '' }, avatar(a.name, a.avatarUrl),
        h('div', { class: 'grow' }, h('strong', null, a.name), h('div', { class: 'tiny muted' }, `@${a.username} · ${a.email}`))))) : null,
      h('div', { class: 'row wrap', style: { gap: '.5rem' } }, load, remove));
  }
  const refresh = async () => paint(await api('/api/admin/seed'));
  load.onclick = async () => {
    busy(true);
    try { const r = await api('/api/admin/seed', { method: 'POST' }); paint(r); toast('Demo data loaded', { icon: 'check' }); } catch (e) { toastErr(e); } finally { busy(false); }
  };
  remove.onclick = async () => {
    if (!(await confirmDlg('Remove every demo account and everything they created? Real accounts are not affected.', { ok: 'Remove demo data', danger: true }))) return;
    busy(true);
    try { const r = await api('/api/admin/seed', { method: 'DELETE' }); paint(r); toast('Demo data removed', { icon: 'check' }); } catch (e) { toastErr(e); } finally { busy(false); }
  };
  view.append(ttsCard());
  body.append(h('p', { class: 'tiny muted' }, 'Loading…'));
  await refresh().catch((e) => body.replaceChildren(h('p', { class: 'small' }, e.message || 'Could not load')));
}

// Read-out self-test: which engine each language uses on THIS device, and a real cloud clip.
const SAMPLES = [['ig', 'Igbo', 'Ndewo. Nnọọ na 1venue.'], ['ha', 'Hausa', 'Sannu. Barka da zuwa 1venue.'], ['ar', 'Arabic', 'مرحبا بكم في ون فينيو.'], ['en', 'English', 'Welcome to 1venue.']];
function ttsCard() {
  const out = h('div', { class: 'col', style: { gap: '.4rem' } }, h('p', { class: 'tiny muted' }, 'Checking…'));
  const card = h('section', { class: 'card pad col', style: { gap: '.8rem', marginTop: '1rem' } },
    h('div', { class: 'row', style: { gap: '.6rem' } }, h('span', { class: 'ico-tile', 'data-group': 'media', html: icon('volume', { size: 18 }) }),
      h('div', { class: 'grow' }, h('h3', null, 'Read-out check'), h('p', { class: 'muted small' }, 'Device voice is used when this device has one; otherwise the cloud voice.'))), out);
  (async () => {
    const [cfg, voices] = await Promise.all([api('/api/tts/config').catch(() => ({ enabled: false, languages: [] })), new Promise((r) => {
      const read = () => (window.speechSynthesis?.getVoices() || []).map((v) => v.lang.toLowerCase().replace('_', '-'));
      if (read().length) return r(read());
      window.speechSynthesis?.addEventListener?.('voiceschanged', () => r(read()), { once: true }); setTimeout(() => r(read()), 1500);
    })]);
    out.replaceChildren(h('p', { class: 'small' }, `Cloud: ${cfg.enabled ? `on (${cfg.model}) for ${cfg.languages.join(', ')}` : 'off: REPLICATE_API_TOKEN is not set'}`));
    for (const [code, label, text] of SAMPLES) {
      const local = voices.some((v) => v.split('-')[0] === code);
      const cloud = cfg.enabled && cfg.languages.includes(code);
      const status = h('span', { class: 'tiny muted grow' }, local ? 'device voice' : cloud ? 'cloud voice' : 'no voice (icon hidden)');
      const btn = h('button', { class: 'btn sm', type: 'button', disabled: !cloud }, 'Test cloud');
      btn.onclick = async () => {
        btn.disabled = true; status.textContent = 'Generating…';
        try {
          const t0 = performance.now();
          const r = await api('/api/tts', { method: 'POST', body: { text, lang: code } });
          await new Audio(r.url).play();
          status.textContent = `✓ cloud works (${r.cached ? 'cached' : `${Math.round((performance.now() - t0) / 100) / 10}s`})`;
        } catch (e) { status.textContent = `✗ ${e.message || 'failed'}`; } finally { btn.disabled = false; }
      };
      out.append(h('div', { class: 'row', style: { gap: '.6rem' } }, h('strong', { style: { minWidth: '5.5rem' } }, label), status, btn));
    }
  })();
  return card;
}
