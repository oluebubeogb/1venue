const config = require('../config');
/** Delete all media namespaces recorded before token issuance; retry on any real failure. */
function roomClient() {
  if(!config.LIVEKIT_URL||!config.LIVEKIT_API_KEY||!config.LIVEKIT_API_SECRET)return null;
  const {RoomServiceClient}=require('livekit-server-sdk');
  return new RoomServiceClient(config.LIVEKIT_URL.replace(/^ws/,'http'),config.LIVEKIT_API_KEY,config.LIVEKIT_API_SECRET,{requestTimeout:3,failover:false});
}
async function cleanup(session,client) {
  if(!session.media_issued)return;
  client=client||roomClient();
  if(!client)throw new Error('LiveKit cleanup needs configuration');
  const rooms=typeof session.media_rooms==='string'?JSON.parse(session.media_rooms):session.media_rooms;
  for(const room of new Set([session.media_room,...rooms])) {
    try {await client.deleteRoom(room);}
    catch(e) {if(e.code!=='not_found'&&e.status!==404&&e.statusCode!==404)throw e;}
  }
}
module.exports={cleanup,roomClient};
