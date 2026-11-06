// Isolated, bounded LibreOffice conversion. Never run synchronous processes on the WebSocket server.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MIMES = new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed', '']);
const fail = (status, message) => Object.assign(new Error(message), { status });
let active = 0;
async function convertPptx(buf) {
  if (!buf.length) throw fail(400, 'The presentation is empty');
  if (buf.length > MAX_BYTES) throw fail(413, 'PPTX must be 50 MB or smaller');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw fail(415, 'This is not a PPTX file. Save the presentation as .pptx and try again.');
  if (active >= 2) throw fail(503, 'Presentation conversion is busy. Please try again shortly.');
  active++;
  let tmp;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), '1venue-pptx-'));
    const input = path.join(tmp, 'slides.pptx');
    await fs.writeFile(input, buf);
    await run('libreoffice', ['--headless', '--norestore', '--nolockcheck',
      '-env:UserInstallation=' + pathToFileURL(path.join(tmp, 'profile')).href,
      '--convert-to', 'pdf:impress_pdf_Export', '--outdir', tmp, input],
      { timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, HOME: tmp } });
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
module.exports = { convertPptx, MAX_BYTES, MIMES };
