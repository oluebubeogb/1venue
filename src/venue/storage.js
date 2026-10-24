/**
 * File storage: VPS disk by default (STORAGE_DIR, mount it as a volume) or any
 * S3-compatible bucket (AWS, R2, Wasabi, MinIO, Backblaze) when STORAGE_DRIVER=s3.
 * S3 requests are signed with SigV4 by hand, so there is no heavy SDK.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const S = config.STORAGE;
const driver = () => (S.driver === 's3' && S.s3.bucket && S.s3.accessKeyId ? 's3' : 'local');

function newId() { return crypto.randomBytes(16).toString('base64url'); }
function safeName(n) { return String(n || 'file').replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file'; }

// ---------------- local
function localPath(key) {
  const p = path.join(S.localDir, key);
  if (!p.startsWith(path.resolve(S.localDir))) throw new Error('bad key');
  return p;
}
async function putLocal(key, buf) {
  const p = localPath(key);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, buf);
}

// ---------------- s3 (SigV4)
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function s3Url(key) {
  const { endpoint, bucket, region, forcePathStyle } = S.s3;
  const base = endpoint || `https://s3.${region}.amazonaws.com`;
  const u = new URL(base);
  const k = key.split('/').map(encodeURIComponent).join('/');
  if (forcePathStyle) return new URL(`${u.origin}/${bucket}/${k}`);
  return new URL(`${u.protocol}//${bucket}.${u.host}/${k}`);
}
function sign(method, url, headers, payloadHash) {
  const { region, accessKeyId, secretAccessKey } = S.s3;
  const now = new Date();
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  headers['x-amz-date'] = amz;
  headers['x-amz-content-sha256'] = payloadHash;
  headers.host = url.host;
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonHeaders = names.map((n) => `${n}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === n)]).trim()}\n`).join('');
  const signed = names.join(';');
  const canon = [method, url.pathname, url.searchParams.toString(), canonHeaders, signed, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const kSig = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, date), region), 's3'), 'aws4_request');
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${crypto.createHmac('sha256', kSig).update(sts).digest('hex')}`;
  delete headers.host;
  return headers;
}
async function putS3(key, buf, mime) {
  const url = s3Url(key);
  const headers = sign('PUT', url, { 'content-type': mime }, sha(buf));
  const r = await fetch(url, { method: 'PUT', headers, body: buf });
  if (!r.ok) throw new Error(`S3 upload failed (${r.status})`);
}
async function getS3(key) {
  const url = s3Url(key);
  const headers = sign('GET', url, {}, sha(''));
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`S3 read failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Save a buffer and return a file record + public URL. */
async function save(buf, { filename, mime, ownerUserId, ownerKey, purpose, roomCode } = {}) {
  if (buf.length > S.maxUploadBytes) { const e = new Error(`File too large (max ${Math.round(S.maxUploadBytes / 1048576)} MB)`); e.status = 413; throw e; }
  const id = newId();
  const d = driver();
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}-${safeName(filename)}`;
  if (d === 's3') await putS3(key, buf, mime || 'application/octet-stream');
  else await putLocal(key, buf);
  const rec = { id, driver: d, objectKey: key, filename: safeName(filename), mime: mime || 'application/octet-stream', size: buf.length, ownerUserId, ownerKey, purpose, roomCode };
  await require('./data').insertFile(rec);
  return { ...rec, url: publicUrl(rec) };
}
function publicUrl(rec) {
  if (rec.driver === 's3' && S.s3.publicBaseUrl) return `${S.s3.publicBaseUrl}/${rec.objectKey || rec.object_key}`;
  return `/files/${rec.id}/${encodeURIComponent(rec.filename)}`;
}
async function open(row) {
  if (row.driver === 's3') return { buffer: await getS3(row.object_key) };
  const p = localPath(row.object_key);
  await fs.promises.access(p);
  return { stream: fs.createReadStream(p), size: (await fs.promises.stat(p)).size };
}

module.exports = { save, open, publicUrl, driver, _sign: sign };
