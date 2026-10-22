/** 1venue entrypoint (Docker and npm start). */
require('./src').start().catch((err) => {
  console.error('[FATAL] 1venue failed to start:', err);
  process.exit(1);
});
