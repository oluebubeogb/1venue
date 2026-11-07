import { icon } from '../icons.js';
import { h, api, esc, toast, toastErr, uploadFile } from '../ui.js';
import { state, navigate, requireLogin } from '../app.js';
import { ytId } from '../room/youtube.js';

const kindLabel = (k) => ({ slides: 'Slides', image: 'Image', youtube: 'YouTube', pdf: 'PDF', pptx: 'PPTX' }[k] || k);

export async function mount(view) {
  if (!requireLogin('Sign in to manage materials')) return;
  view.append(h('div', { class: 'page-head' },
    h('h1', { html: icon('folder', { size: 28 }) + ' Materials' }),
    h('p', { class: 'muted' }, 'Preload PDFs, PPTX, images and YouTube links. Present them instantly in any meeting — including instant calls from Tools → Present.')));

  const listEl = h('div', { class: 'stack', style: { gap: '.75rem' } });
  const formCard = h('div', { class: 'card pad layer col', style: { gap: '.75rem' } });

  async function reload() {
    listEl.replaceChildren(h('div', { class: 'tiny muted' }, 'Loading…'));
    try {
      const r = await api('/api/materials');
      const items = r.materials || [];
      if (!items.length) {
        listEl.replaceChildren(h('div', { class: 'empty sm' }, h('p', null, 'No materials yet. Add a deck or link above.')));
        return;
      }
      listEl.replaceChildren();
      items.forEach((m) => {
        const pages = m.payload?.pages || [];
        const sub = m.kind === 'youtube'
          ? (m.payload?.videoId || 'YouTube')
          : m.kind === 'image'
            ? '1 image'
            : `${pages.length} page${pages.length === 1 ? '' : 's'}`;
        listEl.append(h('div', { class: 'card pad layer row between wrap', style: { gap: '.6rem', alignItems: 'center' } },
          h('div', { class: 'row gap-s grow', style: { minWidth: 0 } },
            h('span', { class: 'ico-tile', 'data-group': 'content', html: icon(m.kind === 'youtube' ? 'youtube' : m.kind === 'image' ? 'image' : 'presentation', { size: 18 }) }),
            h('div', { class: 'grow', style: { minWidth: 0 } },
              h('b', { class: 'ellipsis' }, m.title),
              h('div', { class: 'tiny muted' }, `${kindLabel(m.kind)} · ${sub}`),
            ),
          ),
          h('div', { class: 'row gap-xs' },
            h('button', { class: 'btn sm danger', type: 'button', html: icon('trash', { size: 14 }) + 'Remove', onclick: async () => {
              try {
                await api(`/api/materials/${m.id}`, { method: 'DELETE' });
                toast('Removed', { icon: 'check' });
                reload();
              } catch (e) { toastErr(e); }
            } }),
          ),
        ));
      });
    } catch (e) {
      listEl.replaceChildren(h('div', { class: 'tiny muted' }, e.message || 'Failed to load'));
    }
  }

  const title = h('input', { class: 'input', placeholder: 'Title', maxlength: 120 });
  const yt = h('input', { class: 'input', placeholder: 'YouTube URL (optional)', type: 'url' });
  const fileIn = h('input', { type: 'file', accept: 'application/pdf,image/*,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', multiple: true, class: 'hidden' });
  let busy = false;
  const status = h('div', { class: 'tiny muted' });

  async function saveFromFiles(files) {
    if (!files.length || busy) return;
    busy = true;
    status.textContent = 'Working…';
    try {
      const t = title.value.trim() || files[0].name.replace(/\.[^.]+$/, '').slice(0, 80);
      if (files.length > 1 || files.every((f) => f.type.startsWith('image/'))) {
        if (!files.every((f) => f.type.startsWith('image/'))) throw new Error('Multi-select only works for images');
        const pages = [];
        for (let i = 0; i < files.length; i++) {
          status.textContent = `Uploading ${i + 1}/${files.length}…`;
          pages.push((await uploadFile(files[i], { purpose: 'content' })).url);
        }
        await api('/api/materials', { method: 'POST', body: { title: t, kind: 'slides', payload: { pages } } });
      } else {
        const f = files[0];
        const name = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          status.textContent = 'Rendering PDF…';
          const { pdfToImages } = await import('../room/pdfslides.js');
          const { files: imgs, truncated, total } = await pdfToImages(f, { onProgress: (i, n) => { status.textContent = `Page ${i}/${n}…`; } });
          const pages = [];
          for (let i = 0; i < imgs.length; i++) {
            status.textContent = `Uploading ${i + 1}/${imgs.length}…`;
            pages.push((await uploadFile(imgs[i], { purpose: 'content' })).url);
          }
          await api('/api/materials', { method: 'POST', body: { title: t || name, kind: 'pdf', payload: { pages, sourceName: f.name, sourceMime: f.type } } });
          if (truncated) toast(`Only first ${imgs.length} of ${total} pages saved`, { icon: 'alert' });
        } else if (/\.pptx$/i.test(f.name) || f.type.includes('presentationml')) {
          status.textContent = 'Converting PPTX…';
          const res = await fetch('/api/convert/pptx?title=' + encodeURIComponent(t || name), {
            method: 'POST', body: f, credentials: 'include',
            headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'PPTX conversion failed');
          await api('/api/materials', { method: 'POST', body: { title: data.title || t || name, kind: 'pptx', payload: { pages: data.pages, sourceName: f.name, sourceMime: f.type } } });
          if (data.truncated) toast(`Only first ${data.pages.length} of ${data.total} pages saved`, { icon: 'alert' });
        } else if (f.type.startsWith('image/')) {
          status.textContent = 'Uploading…';
          const r = await uploadFile(f, { purpose: 'content' });
          await api('/api/materials', { method: 'POST', body: { title: t || name, kind: 'image', payload: { url: r.url } } });
        } else throw new Error('Use PDF, PPTX, or images');
      }
      title.value = '';
      toast('Material saved', { icon: 'check', group: 'content' });
      reload();
    } catch (e) { toastErr(e); }
    finally { busy = false; status.textContent = ''; fileIn.value = ''; }
  }

  fileIn.onchange = () => saveFromFiles(Array.from(fileIn.files || []));

  formCard.append(
    h('span', { class: 'lbl', html: icon('plus', { size: 15 }) + ' Add material' }),
    h('div', { class: 'grid2' }, title, yt),
    h('div', { class: 'row gap-s wrap' },
      h('button', { class: 'btn primary', type: 'button', html: icon('upload', { size: 16 }) + ' Upload PDF / PPTX / images', onclick: () => fileIn.click() }),
      h('button', { class: 'btn', type: 'button', html: icon('youtube', { size: 16 }) + ' Save YouTube link', onclick: async () => {
        const id = ytId(yt.value);
        if (!id) return toast('Paste a valid YouTube URL', { icon: 'alert' });
        try {
          await api('/api/materials', { method: 'POST', body: { title: title.value.trim() || 'YouTube video', kind: 'youtube', payload: { videoId: id } } });
          yt.value = ''; title.value = '';
          toast('Saved', { icon: 'check' });
          reload();
        } catch (e) { toastErr(e); }
      } }),
      fileIn,
    ),
    status,
  );

  view.append(formCard, h('div', { class: 'sec-sub', style: { marginTop: '1.25rem' } }, 'Your library'), listEl);
  reload();
}
