// Feature manifest. Copy this folder to src/features/<yourFeature>/ (no leading "_") and it is
// picked up automatically: no list to edit anywhere else.
module.exports = {
  id: 'myFeature', // must match the folder name; FEATURE_MY_FEATURE=false turns its WebSocket plugin off
  order: 1000, // load order among features (lower first); only matters if two features touch the same message
};
