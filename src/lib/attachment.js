/**
 * Validate a chat attachment coming over WS. Preferred form is a stored upload
 * ({ url: '/files/<id>/<name>' or the S3 public URL }); small legacy data: URLs are
 * still accepted up to CHAT_INLINE_MAX_MB so old clients keep working.
 */
const config = require('../config');

function allowedUrl(u) {
  if (/^\/files\/[\w-]{10,40}\/[^/?#]+$/.test(u)) return true;
  const base = config.STORAGE.s3 && config.STORAGE.s3.publicBaseUrl;
  return !!(base && u.startsWith(base + '/') && !/[<>"']/.test(u));
}

function normalizeAttachment(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.kind === 'passage') { // Bible passage card — text only, no file behind it
    const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    const reference = clip(a.reference, 80), text = clip(a.text, 1500);
    if (!reference || !text) return null;
    return { kind: 'passage', reference, text, translation: clip(a.translation, 40).replace(/[^\w-]/g, ''), short: clip(a.short, 16) };
  }
  const kind = a.kind === 'image' ? 'image' : a.kind === 'voice' ? 'voice' : 'file';
  const name = String(a.name || (kind === 'voice' ? 'voice.webm' : 'file')).slice(0, 120);
  const mime = String(a.mime || (kind === 'voice' ? 'audio/webm' : 'application/octet-stream')).slice(0, 120);
  const size = Math.max(0, Number(a.size) || 0);
  const url = String(a.url || '');
  if (url) return allowedUrl(url) ? { kind, name, mime, size, url } : null;
  const dataUrl = String(a.dataUrl || '');
  const max = Math.ceil(config.UPLOADS.chatInlineBytes * 1.37) + 64; // base64 overhead
  if (dataUrl.startsWith('data:') && dataUrl.length <= max) return { kind, name, mime, size: size || dataUrl.length, dataUrl };
  return null;
}

module.exports = { normalizeAttachment };
