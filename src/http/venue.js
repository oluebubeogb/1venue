/**
 * Compatibility shim. The 1venue REST routes now live in src/features/<id>/routes.js and are
 * dispatched by src/core/router.js; file downloads live in src/features/files/http.js.
 */
const router = require('../core/router');
const { roomParticipant } = require('../core/http-kit');
const filesHttp = require('../features/files/http');

async function handleVenueRoutes(req, res, parsed) {
  const r = await filesHttp(req, res, parsed);
  if (r === true || res.headersSent) return true;
  return router.dispatch(req, res, parsed);
}

module.exports = { handleVenueRoutes, roomParticipant };
