/* Integration test for the WHITEBOARD live adapter: boots the real board
 * WebSocketServer over HTTP and drives an owner + anonymous name-joined students
 * through join-by-code (public token), the roster, and a kick. The board store
 * is DB-backed, so we stub the db singleton with one seeded, live, shared board.
 * No Postgres. Run: node scripts/test-board-live-ws.js */
const http = require('http');
const assert = require('assert');
const { WebSocket } = require('ws');

// Seed a live, shared board and stub the db BEFORE requiring the board module.
const BOARD = {
  id: 'brd1', teacherId: 'teacher-1', title: 'Live board', shared: true, isLive: true,
  publicToken: 'pubLIVE123', pages: [{ id: 'p1', template: 'blank', background: null, strokes: [], objects: [] }], insights: []
};
const db = require('../server/db');
db.readBoardStore = () => ({ boards: [JSON.parse(JSON.stringify(BOARD))] });
db.writeBoardStore = () => {};

const { attachBoardWebSocket } = require('../server/board');

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const deps = {
  getUserFromCookieHeader: (cookie) => (cookie && cookie.includes('teacher') ? { id: 'teacher-1', firstName: 'Tam', lastName: 'Ng', email: 't@x.io' } : null),
  readStore: () => ({ users: [] }),
  emailOnRoster: () => false,
  canViewTeachersContent: () => true,
  userHasWhiteboardAccess: () => true,
  askVisionAI: async () => ({})
};

function open(cookie, name, boardKey) {
  const q = `boardId=${encodeURIComponent(boardKey || BOARD.publicToken)}${name ? `&name=${encodeURIComponent(name)}` : ''}`;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/board?${q}`, { headers: cookie ? { cookie } : {} });
  ws.messages = [];
  ws.on('message', (raw) => { try { ws.messages.push(JSON.parse(raw.toString())); } catch (_) {} });
  ws.sendJSON = (o) => ws.send(JSON.stringify(o));
  return ws;
}
const onOpen = (ws) => new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
const lastOf = (ws, type) => [...ws.messages].reverse().find((m) => m.type === type);

let PORT; let server;

(async () => {
  server = http.createServer((req, res) => res.end('ok'));
  const wss = attachBoardWebSocket(server, deps);
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws/board')) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  await new Promise((res) => server.listen(0, res));
  PORT = server.address().port;

  // Teacher joins by real board id (with cookie); students join by PUBLIC TOKEN
  // and a name — no login.
  const teacher = open('session=teacher-abc', null, BOARD.id);
  await onOpen(teacher);
  const s1 = open(null, 'Grace Hopper');
  const s2 = open(null, 'Linus Pauling');
  await Promise.all([onOpen(s1), onOpen(s2)]);
  await wait(150);

  console.log('ANONYMOUS JOIN-BY-CODE');
  ok('anonymous students joined a live board via the public token', (lastOf(s1, 'sync') && lastOf(s2, 'sync')) && lastOf(s1, 'sync').board.id === 'brd1');
  ok('students are viewers, not owners', lastOf(s1, 'sync').isOwner === false);

  console.log('ROSTER + KICK');
  const pres = lastOf(teacher, 'presence');
  ok('teacher sees viewers by their entered names', pres && pres.viewers.some((v) => v.name === 'Grace Hopper') && pres.viewers.some((v) => v.name === 'Linus Pauling'));
  ok('each viewer has an id for kicking', pres && pres.viewers.every((v) => typeof v.id === 'string' && v.id));

  const graceId = pres.viewers.find((v) => v.name === 'Grace Hopper').id;
  teacher.sendJSON({ type: 'kick', id: graceId });
  await wait(80);
  ok('kicked viewer gets a kicked notice', lastOf(s1, 'kicked'));
  ok('roster shrinks after the kick', (lastOf(teacher, 'presence') || {}).viewers.length === 1);

  const graceAgain = open(null, 'Grace Hopper');
  let code = null; graceAgain.on('close', (c) => { code = c; });
  await wait(180);
  ok('a removed viewer cannot rejoin under the same name', code === 4008 || !graceAgain.messages.some((m) => m.type === 'sync'));

  console.log('ACTIVITIES OVER THE BOARD SOCKET');
  teacher.sendJSON({ type: 'activity:poll:launch', question: 'Ready?', choices: ['Yes', 'No'], answerIndex: 0, explanation: 'ok' });
  await wait(80);
  ok('a poll launched by the board owner reaches the remaining student', lastOf(s2, 'activity:poll:show'));
  s2.sendJSON({ type: 'activity:poll:vote', pollId: lastOf(s2, 'activity:poll:show').pollId, choice: 0 });
  await wait(80);
  ok('teacher sees the live tally on the board', lastOf(teacher, 'activity:poll:tally') && lastOf(teacher, 'activity:poll:tally').total === 1);

  [teacher, s2].forEach((w) => { try { w.close(); } catch (_) {} });
  await wait(60);
  server.close();
  console.log(`\nAll ${passed} assertions passed.`);
  process.exit(0);
})().catch((err) => { console.error('FAILED:', err && err.message); try { server.close(); } catch (_) {} process.exit(1); });
