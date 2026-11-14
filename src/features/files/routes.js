/**
 * Uploads (POST /api/files).
 * JSON API routes (see src/core/router.js for the route() contract).
 */
module.exports = function routes(route, kit) {
  const { readRaw, clientIp, getAuthUser, can, data, storage, httpError, roomParticipant } = kit;

  // ------------------------------------------------------------ files
  route('POST', '/api/files', async (ctx) => {
    const uploads = require('../../venue/uploads');
    const u = await getAuthUser(ctx.req, ctx.res);
    const rp = roomParticipant(ctx.req);
    if (!u && !rp) throw httpError(401, 'Sign in or join a room to upload');
    const mime = String(ctx.req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const ownerKey = !u && rp ? `p:${rp.participant.id}` : null;
    const purpose = uploads.normalizePurpose(ctx.url.searchParams.get('purpose'));
    const contentBatch = !!(rp && purpose === 'content' && can(rp.meeting, rp.participant, 'screenShare'));
    const max = uploads.precheck({ contentBatch, mime, declaredSize: Number(ctx.req.headers['content-length']) || 0, rateKey: u ? `u:${u.id}` : `ip:${clientIp(ctx.req)}` });
    let buf;
    try { buf = await readRaw(ctx.req, max); } catch (e) { if (e.status === 413) throw httpError(413, `That file is too big (max ${uploads.fmtMB(max)})`); throw e; }
    if (!buf.length) throw httpError(400, 'The file is empty');
    const roomCode = rp ? rp.code : null;
    await uploads.quota(data, { size: buf.length, userId: u && u.id, ownerKey, roomCode });
    const filename = decodeURIComponent(String(ctx.req.headers['x-file-name'] || 'upload'));
    const rec = await storage().save(buf, { filename, mime, ownerUserId: u && u.id, ownerKey, roomCode, purpose });
    return { id: rec.id, url: rec.url, filename: rec.filename, mime: rec.mime, size: rec.size };
  });
};
