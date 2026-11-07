// PPTX → slide images on the server (aligned with the working teams converter).
// LibreOffice (soffice preferred) → PDF, then pdftoppm → JPEGs → storage URLs.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 80;
const JPEG_DPI = 144;
const MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  '',
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
let active = 0;

/** Resolve soffice/libreoffice once (teams tries soffice first). */
let loBin = null;
function officeBin() {
  if (loBin) return loBin;
  for (const b of ['soffice', 'libreoffice']) {
    const r = spawnSync(b, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (!r.error && r.status === 0) { loBin = b; return b; }
  }
  loBin = 'soffice'; // will surface ENOENT with a clear message
  return loBin;
}

async function officeToPdf(inputPath, outDir) {
  const profile = path.join(outDir, 'lo-profile');
  await fs.mkdir(profile, { recursive: true });
  const bin = officeBin();
  // Match teams: plain --convert-to pdf (no impress_pdf_Export filter — that breaks on some builds).
  const args = [
    '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    '--convert-to', 'pdf',
    '--outdir', outDir,
    inputPath,
  ];
  try {
    const { stderr } = await run(bin, args, {
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, HOME: outDir, TMPDIR: outDir },
    });
    if (stderr && /error|fail/i.test(String(stderr))) console.warn('[pptx] lo stderr:', String(stderr).slice(0, 500));
  } catch (e) {
    if (e.code === 'ENOENT') throw fail(503, 'PPTX conversion needs LibreOffice (soffice) on the server. Rebuild the app image.');
    if (e.killed) throw fail(422, 'This presentation took too long to convert. Try a smaller deck.');
    const detail = String(e.stderr || e.message || '').slice(0, 300);
    console.error('[pptx] convert failed', detail);
    throw fail(422, 'Could not convert this presentation. Try saving it again as PPTX.');
  }
  const stem = path.basename(inputPath, path.extname(inputPath));
  const pdfPath = path.join(outDir, `${stem}.pdf`);
  const stat = await fs.stat(pdfPath).catch(() => null);
  if (!stat || stat.size < 8) throw fail(422, 'The presentation could not be converted to a supported PDF');
  const head = Buffer.alloc(5);
  const fh = await fs.open(pdfPath, 'r');
  try { await fh.read(head, 0, 5, 0); } finally { await fh.close(); }
  if (head.toString() !== '%PDF-') throw fail(422, 'Conversion did not produce a PDF');
  return pdfPath;
}

async function pdfToJpegs(pdfPath, outDir, maxPages) {
  const prefix = path.join(outDir, 'page');
  try {
    await run('pdftoppm', [
      '-jpeg', '-r', String(JPEG_DPI),
      '-f', '1', '-l', String(maxPages),
      pdfPath, prefix,
    ], { timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  } catch (e) {
    if (e.code === 'ENOENT') throw fail(503, 'PPTX conversion needs poppler-utils (pdftoppm). Rebuild the app image.');
    if (e.killed) throw fail(422, 'Rendering slides timed out. Try a smaller deck.');
    console.error('[pptx] pdftoppm', e.stderr || e.message);
    throw fail(422, 'Could not render slides from this presentation.');
  }
  const entries = (await fs.readdir(outDir))
    .filter((n) => /^page-?\d+\.jpg$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0], 10);
      const nb = parseInt(b.match(/\d+/)[0], 10);
      return na - nb;
    });
  return entries.map((n) => path.join(outDir, n));
}

/**
 * Convert a PPTX buffer into uploaded slide image URLs.
 * @returns {{ pages: string[], total: number, truncated: boolean, title: string }}
 */
async function convertPptxToSlides(buf, { ownerUserId = null, ownerKey = null, roomCode = null, title = 'Slides' } = {}) {
  if (!buf.length) throw fail(400, 'The presentation is empty');
  if (buf.length > MAX_BYTES) throw fail(413, 'PPTX must be 50 MB or smaller');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw fail(415, 'This is not a PPTX file. Save the presentation as .pptx and try again.');
  }
  if (active >= 2) throw fail(503, 'Presentation conversion is busy. Please try again shortly.');
  active++;
  let tmp;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), '1venue-pptx-'));
    const input = path.join(tmp, 'slides.pptx');
    await fs.writeFile(input, buf);

    const pdfPath = await officeToPdf(input, tmp);
    const jpegPaths = await pdfToJpegs(pdfPath, tmp, MAX_PAGES);
    if (!jpegPaths.length) throw fail(422, 'No slides could be rendered from this presentation');

    let total = jpegPaths.length;
    try {
      const info = await run('pdfinfo', [pdfPath], { timeout: 15000, encoding: 'utf8' });
      const m = String(info.stdout || '').match(/Pages:\s+(\d+)/i);
      if (m) total = parseInt(m[1], 10) || total;
    } catch (_) { /* optional */ }

    const storage = require('./storage');
    const safeTitle = String(title || 'slides').replace(/[^\w.\- ]+/g, '_').slice(0, 40) || 'slides';
    const pages = [];
    for (let i = 0; i < jpegPaths.length; i++) {
      const jpeg = await fs.readFile(jpegPaths[i]);
      const saved = await storage.save(jpeg, {
        filename: `${safeTitle}-p${i + 1}.jpg`,
        mime: 'image/jpeg',
        ownerUserId,
        ownerKey,
        purpose: 'content',
        roomCode,
      });
      pages.push(saved.url);
    }

    return {
      pages,
      total,
      truncated: total > pages.length,
      title: String(title || 'Slides').slice(0, 80),
    };
  } catch (e) {
    if (e.status) throw e;
    console.error('[pptx]', e.code || e.message);
    throw fail(422, 'Could not convert this presentation. Try saving it again as PPTX.');
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}

/** PDF-only step (tests / diagnostics). */
async function convertPptx(buf) {
  if (!buf.length) throw fail(400, 'The presentation is empty');
  if (buf.length > MAX_BYTES) throw fail(413, 'PPTX must be 50 MB or smaller');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw fail(415, 'This is not a PPTX file. Save the presentation as .pptx and try again.');
  }
  if (active >= 2) throw fail(503, 'Presentation conversion is busy. Please try again shortly.');
  active++;
  let tmp;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), '1venue-pptx-'));
    const input = path.join(tmp, 'slides.pptx');
    await fs.writeFile(input, buf);
    const pdfPath = await officeToPdf(input, tmp);
    return await fs.readFile(pdfPath);
  } catch (e) {
    if (e.status) throw e;
    console.error('[pptx]', e.code || e.message);
    throw fail(422, 'Could not convert this presentation. Try saving it again as PPTX.');
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}

module.exports = { convertPptxToSlides, convertPptx, MAX_BYTES, MAX_PAGES, MIMES };
