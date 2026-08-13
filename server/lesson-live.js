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

function attachLessonWebSocket(httpServer, deps) {
  const { getUserFromCookieHeader, readStore, writeStore, emailOnRoster, nowIso } = deps;
  // noServer: upgrades are routed centrally in server.js. See the matching
  // note in board.js — two WebSocketServers sharing one http.Server via
  // { server, path } fight over the 'upgrade' event and destroy each other's
  // sockets. Central routing avoids that. httpServer kept for signature parity.
  void httpServer;
  const wss = new WebSocketServer({ noServer: true });

  // setId -> { teacher, students:Set, state:{index,flipped}, answers:Map, nextLabel }
  const rooms = new Map();
  function roomFor(id) {
    if (!rooms.has(id)) rooms.set(id, { teacher: null, students: new Set(), state: { index: 0, flipped: false }, answers: new Map(), nextLabel: 0 });
    return rooms.get(id);
  }
  const send = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch (_) {} };
  function toStudents(room, obj) { room.students.forEach((c) => send(c.ws, obj)); }
  function toAll(room, obj) { if (room.teacher) send(room.teacher.ws, obj); toStudents(room, obj); }

  function presence(room) {
    // Teacher sees labels + real identities; students just see the count.
    const roster = [...room.students].map((c) => ({ label: c.label, name: c.realName || null }));
    if (room.teacher) send(room.teacher.ws, { type: 'presence', count: room.students.size, roster });
    toStudents(room, { type: 'presence', count: room.students.size });
  }

  function correctIndexFor(card) {
    if (!card) return -1;
    if (Number.isInteger(card.answerIndex)) return card.answerIndex;
    const choices = card.choices || [];
    return choices.findIndex((ch) => String(ch).trim().toLowerCase() === String(card.back || '').trim().toLowerCase());
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
        room.nextLabel += 1;
        client.label = `Student ${room.nextLabel}`;
        client.id = `c_${Math.random().toString(16).slice(2)}`;
        client.realName = user ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email) : null;
        room.students.add(client);
      }

      // Public projection of the set — no owner internals.
      const publicSet = { id: set.id, title: set.title, cards: set.cards || [], format: set.format,
        subject: set.subject || '', grade: set.grade || '', topic: set.topic || '' };
      send(ws, { type: 'sync', set: publicSet, state: room.state, role: isTeacher ? 'teacher' : 'student', youAre: client.label || null, audioOn: Boolean(room.audioOn) });
      if (isTeacher) {
        // Replay current aggregates so a reconnecting teacher isn't blank.
        [...room.answers.keys()].forEach((i) => send(ws, { type: 'quiz:aggregate', ...aggregateFor(room, set, i) }));
      }
      presence(room);

      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'reaction') {
          const emoji = String(msg.emoji || '').slice(0, 8);
          if (emoji) toAll(room, { type: 'reaction', emoji, from: isTeacher ? 'teacher' : (client.label || 'student') });
          return;
        }

        if (isTeacher) {
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
        if (!room.teacher && room.students.size === 0) rooms.delete(setId);
      });
    } catch (err) {
      try { ws.close(1011, 'Server error'); } catch (_) {}
    }
  });

  return wss;
}

module.exports = { attachLessonWebSocket };
