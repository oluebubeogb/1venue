# Server features (Phase 1)

Phase 1 keeps feature **message handlers** inside `src/ws/hub.js` for zero behavior change.

In **Phase 2**, each folder here will export:

```js
module.exports = {
  id: 'chat',
  register(ctx) { /* ctx.ws.on(...), ctx.db, ctx.broadcast */ },
};
```

| Feature        | WS / API surface                                      |
|----------------|--------------------------------------------------------|
| chat           | `chat`, `chat-history`                                 |
| reactions      | `reaction`                                             |
| mute           | `mute-participant`, `unmute-self`, `force-mute`        |
| device-icons   | `device`                                               |
| schedule       | `/api/schedule*`                                       |
| content        | `content-*`, `remote-*` (legacy; UI removed)           |

Core (not a feature): create/join/leave, screen share start/stop, LiveKit tokens, auth, participants.
