/* livekit.js — thin wrapper around LiveKit for optional live audio.
 * If LIVEKIT_* env vars aren't set, isEnabled() is false and the whole audio
 * layer stays dormant — live sessions still work over WebSocket without voice. */
let AccessToken, RoomServiceClient;
try { ({ AccessToken, RoomServiceClient } = require('livekit-server-sdk')); } catch (_) { /* dep optional */ }

const URL = (process.env.LIVEKIT_URL || '').trim();          // wss://livekit.athenabot.ai
const HTTP_URL = (process.env.LIVEKIT_HTTP_URL || URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')).trim();
const KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();

function isEnabled() { return Boolean(AccessToken && URL && KEY && SECRET); }
function wsUrl() { return URL; }

// Mint a join token. canPublish=true lets that participant send audio.
async function mintToken({ room, identity, name, canPublish }) {
  const at = new AccessToken(KEY, SECRET, { identity, name: name || identity, ttl: '3h' });
  at.addGrant({ roomJoin: true, room, canSubscribe: true, canPublish: Boolean(canPublish), canPublishData: true });
  const jwt = at.toJwt();
  return typeof jwt === 'string' ? jwt : await jwt;   // v2 returns a Promise
}

let _svc = null;
function svc() {
  if (!_svc && isEnabled()) _svc = new RoomServiceClient(HTTP_URL, KEY, SECRET);
  return _svc;
}

// Grant/revoke a participant's ability to publish audio (teacher unmute/mute).
async function setPublish(room, identity, canPublish) {
  const s = svc(); if (!s) return;
  try { await s.updateParticipant(room, identity, undefined, { canPublish: Boolean(canPublish), canSubscribe: true, canPublishData: true }); }
  catch (e) { /* participant may have left */ }
}

module.exports = { isEnabled, wsUrl, mintToken, setPublish };
