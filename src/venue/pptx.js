// PPTX → slide images on the server.
// LibreOffice renders the deck to PDF, then pdftoppm rasterizes pages to JPEG.
// Clients receive image URLs only — no second PDF.js hop.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 80;
const JPEG_DPI = 144; // ~1600px-wide slides on standard landscape decks
const MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  '',
]);
const fail = (status, message) => Object.assign(new Error(message), { status });
let active = 0;

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

    // 1) Office → PDF
    await run('libreoffice', [
      '--headless', '--norestore', '--nolockcheck',
      '-env:UserInstallation=' + pathToFileURL(path.join(tmp, 'profile')).href,
      '--convert-to', 'pdf:impress_pdf_Export', '--outdir', tmp, input,
    ], { timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, HOME: tmp } });

    const pdfPath = path.join(tmp, 'slides.pdf');
    const pdfStat = await fs.stat(pdfPath).catch(() => null);
    if (!pdfStat || pdfStat.size < 8) throw fail(422, 'The presentation could not be converted to a supported PDF');
    const pdfHead = Buffer.alloc(5);
    const fh = await fs.open(pdfPath, 'r');
    try { await fh.read(pdfHead, 0, 5, 0); } finally { await fh.close(); }
    if (pdfHead.toString() !== '%PDF-') throw fail(422, 'Conversion did not produce a PDF');

    // 2) PDF → JPEG pages
    const prefix = path.join(tmp, 'page');
    await run('pdftoppm', [
      '-jpeg', '-r', String(JPEG_DPI),
      '-f', '1', '-l', String(MAX_PAGES),
      pdfPath, prefix,
    ], { timeout: 60000, maxBuffer: 1024 * 1024 });

    const entries = (await fs.readdir(tmp))
      .filter((n) => /^page-\d+\.jpg$/i.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0], 10);
        const nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });
    if (!entries.length) throw fail(422, 'No slides could be rendered from this presentation');

    // Approximate total pages: if we hit the cap, assume truncation
    let total = entries.length;
    try {
      const info = await run('pdfinfo', [pdfPath], { timeout: 10000, encoding: 'utf8' });
      const m = String(info.stdout || '').match(/Pages:\s+(\d+)/i);
      if (m) total = parseInt(m[1], 10) || total;
    } catch (_) { /* pdfinfo optional */ }

    const storage = require('./storage');
    const pages = [];
    for (let i = 0; i < entries.length; i++) {
      const jpeg = await fs.readFile(path.join(tmp, entries[i]));
      const saved = await storage.save(jpeg, {
        filename: `${String(title || 'slides').replace(/[^\w.\- ]+/g, '_').slice(0, 40)}-p${i + 1}.jpg`,
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
    if (e.code === 'ENOENT') {
      const missing = /pdftoppm/i.test(String(e.message || e.path || ''))
        ? 'poppler-utils (pdftoppm)'
        : 'LibreOffice';
      throw fail(503, `PPTX conversion needs ${missing} installed on the server. Rebuild the app image.`);
    }
    if (e.killed) throw fail(422, 'This presentation took too long to convert. Try a smaller deck.');
    throw fail(422, 'Could not convert this presentation. Try saving it again as PPTX.');
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}

/** @deprecated Prefer convertPptxToSlides — kept for tests that only need the PDF step. */
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
    await run('libreoffice', [
      '--headless', '--norestore', '--nolockcheck',
      '-env:UserInstallation=' + pathToFileURL(path.join(tmp, 'profile')).href,
      '--convert-to', 'pdf:impress_pdf_Export', '--outdir', tmp, input,
    ], { timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, HOME: tmp } });
    const pdfPath = path.join(tmp, 'slides.pdf');
    const stat = await fs.stat(pdfPath).catch(() => null);
    if (!stat || stat.size > MAX_BYTES) throw fail(422, 'The presentation could not be converted to a supported PDF');
    const pdf = await fs.readFile(pdfPath);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw fail(422, 'Conversion did not produce a PDF');
    return pdf;
  } catch (e) {
    if (e.status) throw e;
    console.error('[pptx]', e.code || e.message);
    if (e.code === 'ENOENT') throw fail(503, 'PPTX conversion needs LibreOffice installed on the server. Rebuild the app image.');
    if (e.killed) throw fail(422, 'This presentation took too long to convert. Try a smaller deck.');
    throw fail(422, 'Could not convert this presentation. Try saving it again as PPTX.');
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    active--;
  }
}

module.exports = { convertPptxToSlides, convertPptx, MAX_BYTES, MAX_PAGES, MIMES };
