/* live-audio.js — optional LiveKit (self-hosted) audio for live sessions.
 *
 * Entirely optional: if LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are
 * not set (or the SDK isn't installed), every endpoint reports "disabled" and
 * the app behaves exactly as before — sessions just run without audio.
 *
 * Publishing (teacher, or a student the teacher grants) requires a Teams-level
 * license. Listening (subscribing) is open to any attendee of a live session.
 */
let AccessToken = null; let RoomServiceClient = null;
try { ({ AccessToken, RoomServiceClient } = require('livekit-server-sdk')); } catch (_) { /* not installed yet */ }

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

function audioEnabled() {
  return Boolean(AccessToken && LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
}

// Tracks the single student currently allowed to speak, per room.
const currentSpeaker = new Map(); // room -> identity

function roomClient() {
  // RoomServiceClient wants an https URL for the API; derive it from the ws URL.
  const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
  return new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function attachLiveAudioRoutes(app, deps) {
  const { requireUserOptional, readStore, boardStore, membership } = deps;

  app.get('/api/live/config', (req, res) => {
    res.json({ enabled: audioEnabled(), url: audioEnabled() ? LIVEKIT_URL : null });
  });

  // Resolve a session (lesson or whiteboard) by id or share token, and decide
  // whether the requester is its owner (teacher) and whether it's joinable.
  function resolveSession(kind, key) {
    if (kind === 'lesson') {
      const set = (readStore().quizlets || []).find((s) => s.id === key || s.shareToken === key);
      if (!set) return null;
      return { room: `lesson_${set.id}`, ownerId: set.ownerId, isLive: Boolean(set.isLive),
        joinable: set.public || set.shared || set.isLive };
    }
    const boards = (boardStore().boards || []);
    const b = boards.find((x) => x.id === key || x.publicToken === key);
    if (!b) return null;
    return { room: `board_${b.id}`, ownerId: b.teacherId, isLive: Boolean(b.isLive),
      joinable: b.public || b.shared || b.isLive };
  }

  // Mint a LiveKit access token for a live session.
  app.post('/api/live/token', (req, res) => {
    if (!audioEnabled()) return res.status(503).json({ error: 'Audio is not configured on this server.' });
    const user = requireUserOptional(req); // may be null (anonymous attendee)
    const kind = req.body.kind === 'board' ? 'board' : 'lesson';
    const key = String(req.body.id || '');
    const label = String(req.body.label || 'Student').slice(0, 24);
    const session = resolveSession(kind, key);
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const isTeacher = Boolean(user && user.id === session.ownerId);
    if (!isTeacher && !session.joinable) return res.status(403).json({ error: 'This session is private.' });
    if (!isTeacher && !session.isLive) return res.status(403).json({ error: 'This session is not live.' });

    // Publishing (talking) is Teams-gated and, for students, off by default.
    if (isTeacher && !membership.effectiveLimits(user).whiteboardLive) {
      return res.status(403).json({ error: 'Audio is a Teams feature. Start a free 7-day Teams trial to talk live.' });
    }

    // Identity is stable per teacher; anonymous per attendee. Names are the
    // anonymised label only — real identities never enter LiveKit.
    const identity = isTeacher ? `teacher_${user.id}` : `att_${Math.random().toString(16).slice(2, 10)}`;
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name: isTeacher ? 'Teacher' : label });
    at.addGrant({
      roomJoin: true,
      room: session.room,
      canPublish: isTeacher,          // students start muted; teacher may grant later
      canSubscribe: true,
      canPublishData: true
    });
    Promise.resolve(at.toJwt()).then((token) => {
      res.json({ token, url: LIVEKIT_URL, room: session.room, identity, canPublish: isTeacher });
    }).catch((e) => res.status(500).json({ error: e.message }));
  });

  // Teacher grants / revokes a student's mic (1 speaker at a time), or mutes.
  app.post('/api/live/grant', (req, res) => {
    if (!audioEnabled()) return res.status(503).json({ error: 'Audio is not configured.' });
    const user = requireUserOptional(req);
    const kind = req.body.kind === 'board' ? 'board' : 'lesson';
    const session = resolveSession(kind, String(req.body.id || ''));
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (!user || user.id !== session.ownerId) return res.status(403).json({ error: 'Only the teacher can manage the mic.' });
    const identity = String(req.body.identity || '');
    const allow = Boolean(req.body.allow);
    const svc = roomClient();

    (async () => {
      // Revoke the previous speaker so only one student talks at a time.
      const prev = currentSpeaker.get(session.room);
      if (allow && prev && prev !== identity) {
        try { await svc.updateParticipant(session.room, prev, undefined, { canPublish: false, canSubscribe: true }); } catch (_) {}
      }
      await svc.updateParticipant(session.room, identity, undefined, { canPublish: allow, canSubscribe: true });
      if (allow) currentSpeaker.set(session.room, identity);
      else if (prev === identity) currentSpeaker.delete(session.room);
      res.json({ ok: true, identity, allow });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });

  // Teacher mutes a participant's currently published track.
  app.post('/api/live/mute', (req, res) => {
    if (!audioEnabled()) return res.status(503).json({ error: 'Audio is not configured.' });
    const user = requireUserOptional(req);
    const kind = req.body.kind === 'board' ? 'board' : 'lesson';
    const session = resolveSession(kind, String(req.body.id || ''));
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    if (!user || user.id !== session.ownerId) return res.status(403).json({ error: 'Only the teacher can mute.' });
    (async () => {
      try { await roomClient().updateParticipant(session.room, String(req.body.identity || ''), undefined, { canPublish: false, canSubscribe: true }); } catch (_) {}
      if (currentSpeaker.get(session.room) === req.body.identity) currentSpeaker.delete(session.room);
      res.json({ ok: true });
    })().catch((e) => res.status(500).json({ error: e.message }));
  });
}

module.exports = { attachLiveAudioRoutes, audioEnabled };
