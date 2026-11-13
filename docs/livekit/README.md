# Deprecated: use the `livekit-server` repository

These files are the old LiveKit setup that Coolify built from inside the 1venue repo
(`Base Directory: /docs/livekit`). They are kept for one release so an existing Coolify resource
that still points here keeps working.

Move to the standalone `livekit-server` repo (see `docs/livekit-coolify.md`), then delete this
folder. Note: while a Coolify resource builds from this folder, **every push to 1venue `main`
can redeploy LiveKit** and drop live calls for a few seconds.
