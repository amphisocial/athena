/* lesson-live.js — real-time LIVE sessions for study sets (lessons), mirroring
 * the whiteboard live system but allowing anonymous (public) students.
 *
 * Privacy is enforced HERE, server-side: real student names never leave the
 * server to anyone but the owning teacher. Everyone else — including the public
 * — only ever receives "Student N" labels.
 *
 * Teacher → students:  { type:'sync', set, state, role }        (on join)
 *                      { type:'nav', index, flipped }           (teacher drives)
 *                      { type:'reaction', emoji, from }
 *                      { type:'presence', students }
 *                      { type:'ended' }
 * Student → teacher:   { type:'answer', index, choice }
 *                      { type:'question:ask', text }
 *                      { type:'reaction', emoji }
 * Teacher-only inbound:{ type:'nav' }, { type:'question:clear', id }, { type:'end' }
 */
const { WebSocketServer } = require('ws');
const { createLiveActivities } = require('./live-activities');

function attachLessonWebSocket(httpServer, deps) {
  const { getUserFromCookieHeader, readStore, writeStore, emailOnRoster, nowIso } = deps;
  // Immersive in-session activities (polls + team quiz). Shared engine; the
  // room-shaped `bus` below adapts our teacher/students structure to it. Team
  // exercises are ephemeral by design and never written to the store.
  const activities = createLiveActivities();
  // noServer: upgrades are routed centrally in server.js. See the matching
  // note in board.js — two WebSocketServers sharing one http.Server via
  // { server, path } fight over the 'upgrade' event and destroy each other's
  // sockets. Central routing avoids that. httpServer kept for signature parity.
  void httpServer;
  const wss = new WebSocketServer({ noServer: true });

  // setId -> { teacher, students:Set, state:{index,flipped}, answers:Map, nextLabel }
  const rooms = new Map();
  function roomFor(id) {
    if (!rooms.has(id)) rooms.set(id, { teacher: null, students: new Set(), state: { index: 0, flipped: false }, answers: new Map(), nextLabel: 0, annotations: new Map(), removed: new Set() });
    return rooms.get(id);
  }
  // Live annotations, keyed by card index, so a late-joining student can be
  // caught up to whatever the teacher has already drawn on each slide.
  const MAX_STROKES_PER_INDEX = 400;
  const MAX_POINTS_PER_STROKE = 1000;
  function strokesForIndex(room, index) {
    if (!room.annotations.has(index)) room.annotations.set(index, []);
    return room.annotations.get(index);
  }
  function annotationsPayload(room) {
    const out = {};
    room.annotations.forEach((arr, idx) => { if (arr && arr.length) out[idx] = arr; });
    return out;
  }
  const send = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (_) {} };
  function toStudents(room, obj) { room.students.forEach((c) => send(c.ws, obj)); }
  function toAll(room, obj) { if (room.teacher) send(room.teacher.ws, obj); toStudents(room, obj); }

  function presence(room) {
    // Teacher sees each student's id + name (to view the roster and remove
    // people); students still just see the head-count.
    const roster = [...room.students].map((c) => ({ id: c.id, label: c.label, name: c.realName || c.label }));
    if (room.teacher) send(room.teacher.ws, { type: 'presence', count: room.students.size, roster });
    toStudents(room, { type: 'presence', count: room.students.size });
  }

  function correctIndexFor(card) {
    if (!card) return -1;
    if (Number.isInteger(card.answerIndex)) return card.answerIndex;
    const choices = card.choices || [];
    return choices.findIndex((ch) => String(ch).trim().toLowerCase() === String(card.back || '').trim().toLowerCase());
  }

  // Adapts a lesson room to the activities engine. Teammates only ever see the
  // privacy-safe "Student N" label; the teacher-facing name carries the real
  // identity where one exists (public/anonymous students have none).
  function activityBus(room, actorWs) {
    const findById = (cid) => [...room.students].find((c) => c.id === cid);
    return {
      toTeacher: (o) => { if (room.teacher) send(room.teacher.ws, o); },
      toActor: (o) => { if (actorWs) send(actorWs, o); },
      toParticipant: (cid, o) => { const c = findById(cid); if (c) send(c.ws, o); },
      toParticipants: (ids, o) => { ids.forEach((cid) => { const c = findById(cid); if (c) send(c.ws, o); }); },
      toStudents: (o) => toStudents(room, o),
      toAll: (o) => toAll(room, o),
      roster: () => [...room.students].map((c) => ({ id: c.id, name: c.realName || c.label, label: c.label }))
    };
  }

  function aggregateFor(room, set, index) {
    const perQ = room.answers.get(index) || new Map();
    const card = (set.cards || [])[index];
    const correct = correctIndexFor(card);
    const byChoice = {};
    let total = 0; let right = 0;
    perQ.forEach((choice) => {
      byChoice[choice] = (byChoice[choice] || 0) + 1;
      total += 1;
      if (choice === correct) right += 1;
    });
    return { index, total, correct: right, correctIndex: correct, byChoice };
  }

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const setKey = url.searchParams.get('set');
      if (!setKey) return ws.close(4001, 'Missing set');

      const store = readStore();
      const set = (store.quizlets || []).find((s) => s.id === setKey || s.shareToken === setKey);
      if (!set) return ws.close(4004, 'Lesson not found');
      const setId = set.id;   // canonical room key (teacher uses id, students may use token)

      const user = getUserFromCookieHeader(req.headers.cookie);
      const isTeacher = Boolean(user && user.id === set.ownerId);

      if (!isTeacher) {
        // Students may only join a LIVE lesson, and only if it's public or
        // shared with them (roster). Anonymous is allowed only when public.
        if (!set.isLive) return ws.close(4003, 'This lesson is not live');
        const allowed = set.public || set.shared || (user && emailOnRoster(store, set.ownerId, user.email));
        if (!allowed) return ws.close(4003, 'This live lesson is private');
      } else if (!set.isLive) {
        // Teacher connecting implies/keeps it live.
        set.isLive = true; set.liveStartedAt = nowIso(); writeStore(store);
      }

      const room = roomFor(setId);
      const client = { ws, isTeacher };
      if (isTeacher) {
        room.teacher = client;
      } else {
        // Students enter their name before joining (no login). That name is
        // their identity in the room: teammates see it, and the teacher's roster
        // uses it. Signed-in students fall back to their account name.
        const rawName = (url.searchParams.get('name') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const accountName = user ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email) : '';
        const displayName = rawName || accountName;
        // A teacher can remove someone; block that exact name from walking back
        // in for the rest of the session (best-effort, since there's no login).
        if (room.removed && displayName && room.removed.has(displayName.toLowerCase())) {
          return ws.close(4008, 'Removed by teacher');
        }
        room.nextLabel += 1;
        client.id = `c_${Math.random().toString(16).slice(2)}`;
        client.label = displayName || `Student ${room.nextLabel}`;
        client.realName = displayName || null;
        room.students.add(client);
      }

      // Public projection of the set — no owner internals.
      const publicSet = { id: set.id, title: set.title, cards: set.cards || [], format: set.format,
        subject: set.subject || '', grade: set.grade || '', topic: set.topic || '' };
      send(ws, { type: 'sync', set: publicSet, state: room.state, role: isTeacher ? 'teacher' : 'student', youAre: client.label || null, audioOn: Boolean(room.audioOn), annotations: annotationsPayload(room) });
      if (isTeacher) {
        // Replay current aggregates so a reconnecting teacher isn't blank.
        [...room.answers.keys()].forEach((i) => send(ws, { type: 'quiz:aggregate', ...aggregateFor(room, set, i) }));
      }
      presence(room);
      // Catch a (re)joining client up to any activity already in flight.
      activities.resync({ roomId: setId, isTeacher, actor: { id: client.id, name: client.realName || client.label, label: client.label }, bus: activityBus(room, ws) });

      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'reaction') {
          const emoji = String(msg.emoji || '').slice(0, 8);
          if (emoji) toAll(room, { type: 'reaction', emoji, from: isTeacher ? 'teacher' : (client.label || 'student') });
          return;
        }

        // Immersive activities (poll + team quiz). The engine decides teacher vs
        // student capability itself, so we route before the owner-only gate.
        if (typeof msg.type === 'string' && msg.type.startsWith('activity:')) {
          const actor = { id: client.id, name: client.realName || client.label, label: client.label };
          activities.handle({ roomId: setId, isTeacher, actor, bus: activityBus(room, ws), msg });
          return;
        }

        if (isTeacher) {
          if (msg.type === 'kick') {
            // Fraud/safety control: remove a named participant. Tell them, close
            // their socket, and remember the name so they can't immediately
            // rejoin for this session.
            const target = [...room.students].find((c) => c.id === msg.id);
            if (target) {
              if (target.realName) room.removed.add(target.realName.toLowerCase());
              try { send(target.ws, { type: 'kicked' }); } catch (_) {}
              try { target.ws.close(4008, 'Removed by teacher'); } catch (_) {}
              room.students.delete(target);
              presence(room);
            }
            return;
          }
          if (msg.type === 'nav') {
            room.state = { index: Math.max(0, Number(msg.index) || 0), flipped: Boolean(msg.flipped) };
            toStudents(room, { type: 'nav', index: room.state.index, flipped: room.state.flipped });
            return;
          }
          if (msg.type === 'audio') {
            room.audioOn = Boolean(msg.on);
            toStudents(room, { type: 'audio', on: room.audioOn });
            return;
          }

          // ---- Live annotation (pen / highlighter) + laser ----
          // Marks are kept server-side per card index and relayed to students.
          // Coordinates are already normalised (0..1) on the client.
          if (msg.type === 'anno:start') {
            const idx = Math.max(0, Number(msg.index) || 0);
            const arr = strokesForIndex(room, idx);
            const tool = msg.tool === 'highlighter' ? 'highlighter' : 'pen';
            const color = String(msg.color || '#ff5a5a').slice(0, 9);
            arr.push({ id: String(msg.id || '').slice(0, 40), tool, color, points: [{ x: +msg.x || 0, y: +msg.y || 0 }] });
            if (arr.length > MAX_STROKES_PER_INDEX) arr.splice(0, arr.length - MAX_STROKES_PER_INDEX);
            toStudents(room, { type: 'anno:start', index: idx, id: msg.id, tool, color, x: +msg.x || 0, y: +msg.y || 0 });
            return;
          }
          if (msg.type === 'anno:point') {
            const idx = Math.max(0, Number(msg.index) || 0);
            const s = strokesForIndex(room, idx).find((x) => x.id === msg.id);
            if (s && s.points.length < MAX_POINTS_PER_STROKE) s.points.push({ x: +msg.x || 0, y: +msg.y || 0 });
            toStudents(room, { type: 'anno:point', index: idx, id: msg.id, x: +msg.x || 0, y: +msg.y || 0 });
            return;
          }
          if (msg.type === 'anno:end') {
            toStudents(room, { type: 'anno:end', index: Math.max(0, Number(msg.index) || 0), id: msg.id });
            return;
          }
          if (msg.type === 'anno:clear') {
            const idx = Math.max(0, Number(msg.index) || 0);
            room.annotations.set(idx, []);
            toStudents(room, { type: 'anno:clear', index: idx });
            return;
          }
          if (msg.type === 'laser') {
            // Laser is transient pointer position — relayed, never stored.
            toStudents(room, { type: 'laser', index: Math.max(0, Number(msg.index) || 0), x: +msg.x || 0, y: +msg.y || 0, active: msg.active !== false });
            return;
          }

          if (msg.type === 'question:clear') { toAll(room, { type: 'question:cleared', id: msg.id }); return; }
          if (msg.type === 'end') {
            const s2 = readStore(); const st = (s2.quizlets || []).find((x) => x.id === setId);
            if (st) { st.isLive = false; writeStore(s2); }
            toStudents(room, { type: 'ended' });
            return;
          }
          return;
        }

        // ---- Student inbound ----
        if (msg.type === 'answer') {
          const index = Math.max(0, Number(msg.index) || 0);
          const choice = Number(msg.choice);
          if (!Number.isInteger(choice)) return;
          if (!room.answers.has(index)) room.answers.set(index, new Map());
          room.answers.get(index).set(client.id, choice);
          // Only the teacher sees the aggregate; students just get their own echo.
          if (room.teacher) send(room.teacher.ws, { type: 'quiz:aggregate', ...aggregateFor(room, set, index) });
          send(ws, { type: 'answer:ack', index, choice });
          return;
        }
        if (msg.type === 'question:ask') {
          const text = String(msg.text || '').slice(0, 400).trim();
          const id = `q_${Math.random().toString(16).slice(2)}`;
          // Teacher gets the real name (if any) + label; students never do.
          if (room.teacher) send(room.teacher.ws, { type: 'question', question: { id, text: text || '(raised hand)', label: client.label, name: client.realName, createdAt: nowIso() } });
          // Broadcast an ANONYMISED copy so other students see activity.
          toStudents(room, { type: 'question:anon', question: { id, text: text || '(raised hand)', label: client.label, createdAt: nowIso() } });
          return;
        }
      });

      ws.on('close', () => {
        if (isTeacher) { if (room.teacher === client) room.teacher = null; }
        else { room.students.delete(client); }
        presence(room);
        if (!room.teacher && room.students.size === 0) { rooms.delete(setId); activities.clearRoom(setId); }
      });
    } catch (err) {
      try { ws.close(1011, 'Server error'); } catch (_) {}
    }
  });

  // How many students are connected to a set's live room right now (excludes
  // the teacher). Used to report live seat occupancy for public webinars.
  wss.getLiveCount = (setId) => {
    const room = rooms.get(setId);
    return room ? room.students.size : 0;
  };

  return wss;
}

module.exports = { attachLessonWebSocket };
