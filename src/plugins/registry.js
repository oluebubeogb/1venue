/**
 * Phase 2 plugin registry (server).
 * Each plugin: { id, register(ctx), unregister?(ctx) }
 */
const plugins = new Map();

function registerPlugin(plugin) {
  if (!plugin || !plugin.id || typeof plugin.register !== 'function') {
    throw new Error('Plugin must have id and register(ctx)');
  }
  if (plugins.has(plugin.id)) {
    console.warn(`[plugins] replacing ${plugin.id}`);
  }
  plugins.set(plugin.id, plugin);
}

function getPlugins() {
  return Array.from(plugins.values());
}

/**
 * ctx: {
 *   config, db,
 *   rooms: store helpers,
 *   broadcast, getMeeting, getParticipantsList, getContentState,
 *   clients, getClient, setClient, deleteClient,
 *   endMeeting,
 *   features: { chat: true, ... },
 *   wsHandlers: Map type -> handler  // plugins push here
 * }
 */
function loadAll(ctx) {
  const enabled = ctx.features || {};
  for (const plugin of plugins.values()) {
    if (enabled[plugin.id] === false) {
      console.log(`[plugins] skip disabled: ${plugin.id}`);
      continue;
    }
    try {
      plugin.register(ctx);
      console.log(`[plugins] registered: ${plugin.id}`);
    } catch (e) {
      console.error(`[plugins] failed ${plugin.id}:`, e.message);
    }
  }
}

module.exports = {
  registerPlugin,
  getPlugins,
  loadAll,
};
