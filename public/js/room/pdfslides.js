// Turn a PDF into slide images in the presenter's browser (pdf.js, vendored & lazy-loaded),
// so every viewer only loads plain images — works on every phone, no PDF viewer required.
const MAX_PAGES = 80;
let libP = null;
const lib = () => (libP ||= import('/vendor/pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m; }));

export async function pdfToImages(file, { width = 1600, quality = 0.82, onProgress } = {}) {
  const pdfjs = await lib();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, width / vp0.width);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', quality));
    out.push(new File([blob], `${(file.name || 'slides').replace(/\.pdf$/i, '')}-p${i}.jpg`, { type: 'image/jpeg' }));
    page.cleanup(); onProgress && onProgress(i, n);
  }
  const truncated = doc.numPages > n; doc.destroy();
  return { files: out, total: doc.numPages, truncated };
}
