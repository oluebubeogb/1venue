const { normCode } = require('../lib/codes');
const metrics = require('../core/metrics');
const { WebSocketServer } = require('ws');
const db = require('../../db');
const config = require('../config');
const { features } = require('../lib/features');
const {
  getMeeting,
  getParticipantsList,
  getWaitingList,
  getRaisedHands,
  getContentState,
  getSecurityState,
  broadcast,
  broadcastToModerators,
  sendToParticipant,
  setClient,
  deleteClient,
  getClient,
  clients,
} = require('../rooms/store');
const { endMeeting } = require('../rooms/lifecycle');
const { can } = require('../lib/permissions');
const { verifyWsCredential } = require('../lib/wsCredential');
const { registerPlugin, loadAll } = require('../core/plugin-registry');
const featureRegistry = require('../core/features');
const { getOrRestoreMeeting } = require('../rooms/snapshot');

function createPluginContext() {
  const wsHandlers = new Map();
  const registerHooks = [];

  return {
    config,
    db,
    features,
    clients,
    getMeeting,
    getParticipantsList,
    getWaitingList,
    getRaisedHands,
    getContentState,
    getSecurityState,
    broadcast,
    broadcastToModerators,
    sendToParticipant,
    getClient,
    setClient,
    deleteClient,
    endMeeting,
    onWs(type, handler) {
      if (!wsHandlers.has(type)) wsHandlers.set(type, []);
      wsHandlers.get(type).push(handler);
    },
    onRegister(fn) {
      registerHooks.push(fn);
    },
    _wsHandlers: wsHandlers,
    _registerHooks: registerHooks,
  };
}

function attachWebSocket(server) {
  featureRegistry.registerWsPlugins(registerPlugin);
  const ctx = createPluginContext();
  loadAll(ctx, featureRegistry.isEnabled);

  const wss = new WebSocketServer({ server, path: '/' });
  metrics.setWss(wss);

  // Heartbeat: browsers answer pings automatically; sockets that miss one round are dead (sleeping
  // laptops, dropped mobile links) and get terminated so their memory and fan-out cost is freed.
  const heartbeatMs = config.MEMORY.wsHeartbeatMs;
  const heartbeat = heartbeatMs > 0 ? setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { metrics.incDeadSockets(); try { ws.terminate(); } catch (_) {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, heartbeatMs) : null;
  if (heartbeat) heartbeat.unref();
  wss.on('close', () => heartbeat && clearInterval(heartbeat));

  /** Graceful restart: tell every client to reconnect (they keep their LiveKit media), then close. */
  wss.notifyRestart = (retryInMs = 1500) => {
    const payload = JSON.stringify({ type: 'server-restarting', retryInMs });
    for (const ws of wss.clients) {
      try { ws.send(payload); } catch (_) {}
      try { ws.close(1012, 'server restarting'); } catch (_) {}
    }
  };

  wss.on('connection', (ws) => {
    let participantId = null;
    let meetingCode = null;
    let restoring = null; // set while a meeting is being restored from a restart snapshot
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', function onMessage(raw) {
      if (restoring) { restoring.then(() => onMessage(raw)); return; }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'register') {
        const claimedId = msg.participantId;
        const claimedCode = normCode(msg.code);
        const credential = msg.wsCredential || msg.credential || msg.token;

        const verified = verifyWsCredential(credential, {
          participantId: claimedId,
          code: claimedCode,
        });

        if (!verified.ok) {
          try {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Unauthorized WebSocket registration',
              detail: verified.error,
            }));
            ws.close(4401, 'unauthorized');
          } catch (_) {}
          return;
        }

        participantId = verified.participantId;
        meetingCode = verified.code;

        if (!getMeeting(meetingCode) && !msg._restoreTried) {
          // Not live in this process: maybe it was live before a restart. Retry register once restored.
          msg._restoreTried = true;
          restoring = getOrRestoreMeeting(meetingCode).catch(() => null).finally(() => { restoring = null; });
          restoring.then(() => onMessage(JSON.stringify(msg)));
          return;
        }
        const meeting = getMeeting(meetingCode);
        if (!meeting) {
          try {
            ws.send(JSON.stringify({ type: 'error', error: 'Meeting not found' }));
            ws.close(4404, 'meeting not found');
          } catch (_) {}
          return;
        }

        const p = meeting.participants.get(participantId);
        if (!p || p.status === 'REMOVED' || p.status === 'BLOCKED') {
          try {
            ws.send(JSON.stringify({ type: 'error', error: 'Not a participant of this meeting' }));
            ws.close(4403, 'forbidden');
          } catch (_) {}
          return;
        }

        const oldSock = clients.get(participantId);
        if (oldSock && oldSock !== ws) {
          try { oldSock.close(); } catch (_) {}
        }
        setClient(participantId, ws);
        meeting.lastActivity = Date.now();
        if (!Array.isArray(meeting.chatHistory)) meeting.chatHistory = [];

        try {
          ws.send(
            JSON.stringify({
              type: 'participants',
              participants: getParticipantsList(meeting),
              waiting: getWaitingList(meeting),
              raisedHands: getRaisedHands(meeting),
              security: getSecurityState(meeting),
              self: { id: p.id, role: p.role, status: p.status },
            })
          );
        } catch (_) {}
        for (const hook of ctx._registerHooks) {
          try {
            hook(ws, meeting, participantId);
          } catch (e) {
            console.error('[ws] onRegister hook', e.message);
          }
        }
        return;
      }

      if (!participantId || !meetingCode) return;
      const meeting = getMeeting(meetingCode);
      if (!meeting) return;
      meeting.lastActivity = Date.now();

      if (msg.type === 'start-share') {
        const p = meeting.participants.get(participantId);
        if (p && p.status === 'ACTIVE') {
          if (!can(meeting, p, 'screenShare')) {
            try { ws.send(JSON.stringify({ type: 'error', error: 'Screen sharing is not allowed' })); } catch (_) {}
            return;
          }
          p.sharing = true;
          broadcast(meetingCode, {
            type: 'share-started',
            participantId,
            participants: getParticipantsList(meeting),
          });
          if (typeof ctx.logActivity === 'function') {
            try { ctx.logActivity(meeting, 'share_started', p); } catch (_) {}
          }
        }
        return;
      }

      if (msg.type === 'stop-share') {
        const p = meeting.participants.get(participantId);
        if (p) {
          p.sharing = false;
          if (p.permissionOverrides && p.permissionOverrides.screenShare) {
            delete p.permissionOverrides.screenShare;
            // notify client to update perms
            try { ctx.sendToParticipant && ctx.sendToParticipant(participantId, { type: 'permissions-updated', permissions: require('../lib/permissions').resolvePermissions(meeting, p) }); } catch(_) {}
          }
          broadcast(meetingCode, {
            type: 'share-stopped',
            participantId,
            participants: getParticipantsList(meeting),
          });
          if (typeof ctx.logActivity === 'function') {
            try { ctx.logActivity(meeting, 'share_stopped', p); } catch (_) {}
          }
        }
        return;
      }

      if (msg.type === 'force-stop-share') {
        const actor = meeting.participants.get(participantId);
        const targetId = msg.targetId;
        const target = meeting.participants.get(targetId);
        if (actor && target && (can(meeting, actor, 'muteOthers') || actor.role === 'host' || actor.role === 'cohost')) {
          target.sharing = false;
          sendToParticipant(targetId, {
            type: 'force-stop-share',
            by: participantId,
            byName: actor.name,
          });
          broadcast(meetingCode, {
            type: 'share-stopped',
            participantId: targetId,
            participants: getParticipantsList(meeting),
          });
          if (typeof ctx.logActivity === 'function') {
            try { ctx.logActivity(meeting, 'share_stopped', actor, { forced: true, targetId }); } catch (_) {}
          }
        }
        return;
      }

      if (msg.type === 'end-meeting') {
        const p = meeting.participants.get(participantId);
        if (!p) return;
        const isOwner = p.isHost || p.role === 'host';
        const isAdmin = p.role === 'cohost';
        if (isOwner) {
          Promise.resolve(endMeeting(meetingCode, 'host-ended')).catch(() => {});
        } else if (isAdmin && meeting.venue) {
          // Admin cannot close if the owner is currently in the venue
          const ownerPresent = [...meeting.participants.values()].some((x) => x.isHost || x.role === 'host');
          if (ownerPresent) {
            try { sendToParticipant(participantId, { type: 'error', error: 'Cannot close the venue while the owner is present' }); } catch {}
          } else {
            Promise.resolve(endMeeting(meetingCode, 'admin-ended')).catch(() => {});
          }
        }
        return;
      }

      const handlers = ctx._wsHandlers.get(msg.type);
      if (handlers && handlers.length) {
        const payload = { msg, participantId, meeting, meetingCode, ws };
        for (const h of handlers) {
          try {
            Promise.resolve(h(payload)).catch((e) => {
              console.error('[ws] plugin handler ' + msg.type + ':', e.message);
            });
          } catch (e) {
            console.error('[ws] plugin handler ' + msg.type + ':', e.message);
          }
        }
      }
    });

    ws.on('close', () => {
      if (participantId && clients.get(participantId) === ws) {
        deleteClient(participantId);
        if (meetingCode) {
          const meeting = getMeeting(meetingCode);
          if (meeting) {
            broadcast(meetingCode, {
              type: 'participants',
              participants: getParticipantsList(meeting),
              waiting: getWaitingList(meeting),
              raisedHands: getRaisedHands(meeting),
            });
            if (meeting.content && (meeting.content.remoteHolderId === participantId || meeting.content.ownerId === participantId)) {
              // Auto-hand to a co-host or another active participant
              const others = [...meeting.participants.values()].filter((p) => p.id !== participantId && p.status === 'ACTIVE');
              const cohost = others.find((p) => p.role === 'cohost' || p.isHost);
              const next = cohost || others[0];
              if (next) {
                meeting.content.remoteHolderId = next.id;
                if (meeting.content.ownerId === participantId) meeting.content.ownerId = next.id;
              }
              broadcast(meetingCode, {
                type: 'content-state',
                content: getContentState(meeting),
              });
            }
          }
        }
      }
    });

    ws.on('error', () => {
      if (participantId && clients.get(participantId) === ws) {
        deleteClient(participantId);
      }
    });
  });

  return wss;
}

module.exports = { attachWebSocket };
