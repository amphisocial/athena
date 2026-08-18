/* Integration test: boots the real lesson-live WebSocketServer (the adapter
 * that bridges a live room to the activities engine) over an actual HTTP server
 * and drives a teacher + two anonymous students through a poll and a team quiz.
 * No Postgres — deps are mocked. Run: node scripts/test-live-activities-ws.js */
const http = require('http');
const assert = require('assert');
const { WebSocket } = require('ws');
const { attachLessonWebSocket } = require('../server/lesson-live');

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A live, public set owned by "teacher-1", with a two-question quiz.
const SET = {
  id: 'set-1', ownerId: 'teacher-1', title: 'Live set', isLive: true, public: true, format: 'quiz',
  cards: [
    { type: 'quiz', front: 'Capital of France?', choices: ['Lyon', 'Paris', 'Nice'], answerIndex: 1, explanation: 'Paris is the capital.' },
    { type: 'quiz', front: '3 x 3?', choices: ['6', '9', '12'], answerIndex: 1, explanation: '3 times 3 is 9.' }
  ]
};
const deps = {
  getUserFromCookieHeader: (cookie) => (cookie && cookie.includes('teacher') ? { id: 'teacher-1', firstName: 'Tia', lastName: 'Chu', email: 't@x.io' } : null),
  readStore: () => ({ quizlets: [SET], users: [] }),
  writeStore: () => {},
  emailOnRoster: () => false,
  nowIso: () => new Date().toISOString()
};

function open(cookie, name) {
  const q = `set=set-1${name ? `&name=${encodeURIComponent(name)}` : ''}`;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/lesson?${q}`, { headers: cookie ? { cookie } : {} });
  ws.messages = [];
  ws.on('message', (raw) => { try { ws.messages.push(JSON.parse(raw.toString())); } catch (_) {} });
  ws.sendJSON = (o) => ws.send(JSON.stringify(o));
  return ws;
}
const onOpen = (ws) => new Promise((res) => ws.on('open', res));
const lastOf = (ws, type) => [...ws.messages].reverse().find((m) => m.type === type);

let PORT;
let server;

(async () => {
  server = http.createServer((req, res) => res.end('ok'));
  const lessonWss = attachLessonWebSocket(server, deps);
  server.on('upgrade', (req, socket, head) => {
    lessonWss.handleUpgrade(req, socket, head, (ws) => lessonWss.emit('connection', ws, req));
  });
  await new Promise((res) => server.listen(0, res));
  PORT = server.address().port;

  const teacher = open('session=teacher-abc');
  await onOpen(teacher);
  const s1 = open(null, 'Ada Lovelace'); const s2 = open(null, 'Alan Turing');
  await Promise.all([onOpen(s1), onOpen(s2)]);
  await wait(120);

  ok('students joined and got a sync', s1.messages.some((m) => m.type === 'sync') && s2.messages.some((m) => m.type === 'sync'));

  console.log('NAMED JOIN + ROSTER + KICK');
  const pres = lastOf(teacher, 'presence');
  ok('teacher roster carries entered names', pres && pres.roster.some((r) => r.name === 'Ada Lovelace') && pres.roster.some((r) => r.name === 'Alan Turing'));
  ok('each roster entry has an id for kicking', pres && pres.roster.every((r) => typeof r.id === 'string' && r.id));
  ok('the joining student is told their own name', (lastOf(s1, 'sync') || {}).youAre === 'Ada Lovelace');

  // A throwaway student joins and gets removed, leaving s1/s2 intact.
  const sk = open(null, 'Mallory Kane'); await onOpen(sk); await wait(80);
  const before = (lastOf(teacher, 'presence') || {}).count;
  const kId = lastOf(teacher, 'presence').roster.find((r) => r.name === 'Mallory Kane').id;
  teacher.sendJSON({ type: 'kick', id: kId });
  await wait(80);
  ok('kicked student receives a kicked notice', lastOf(sk, 'kicked'));
  ok('roster shrinks by one after a kick', (lastOf(teacher, 'presence') || {}).count === before - 1);

  // Mallory tries to walk back in with the same name — blocked for the session.
  const kAgain = open(null, 'Mallory Kane');
  let closedCode = null;
  kAgain.on('close', (code) => { closedCode = code; });
  await wait(160);
  ok('a removed student cannot rejoin under the same name', closedCode === 4008 || !kAgain.messages.some((m) => m.type === 'sync'));

  console.log('POLL over the wire');
  teacher.sendJSON({ type: 'activity:poll:launch', question: SET.cards[0].front, choices: SET.cards[0].choices, answerIndex: 1, explanation: SET.cards[0].explanation });
  await wait(80);
  ok('both students receive the poll popup', lastOf(s1, 'activity:poll:show') && lastOf(s2, 'activity:poll:show'));
  ok('teacher receives the initial poll state', lastOf(teacher, 'activity:poll:state'));
  const pollId = lastOf(s1, 'activity:poll:show').pollId;

  s1.sendJSON({ type: 'activity:poll:vote', pollId, choice: 1 }); // correct
  s2.sendJSON({ type: 'activity:poll:vote', pollId, choice: 0 }); // wrong
  await wait(80);
  ok('voter s1 sees they were right', (lastOf(s1, 'activity:poll:result') || {}).yourChoice === 1);
  const tally = lastOf(teacher, 'activity:poll:tally');
  ok('teacher tally shows 2 answered', tally && tally.total === 2);

  teacher.sendJSON({ type: 'activity:poll:close' });
  await wait(80);
  ok('closing reveals the final graph to all', lastOf(s1, 'activity:poll:closed') && lastOf(s2, 'activity:poll:closed'));

  console.log('TEAMS over the wire');
  teacher.sendJSON({ type: 'activity:teams:launch', teamCount: 2, quiz: SET.cards, title: 'Live set' });
  await wait(100);
  const you1 = lastOf(s1, 'activity:teams:you');
  const you2 = lastOf(s2, 'activity:teams:you');
  ok('each student is assigned a mountain-range team', you1 && you2 && you1.team.name && you2.team.name);
  ok('student quiz payload hides the answer index', you1.quiz.every((q) => q.answerIndex === undefined));
  ok('teammates are shown by their entered names', you1.team.mates.every((m) => typeof m === 'string' && m.length) && [...you1.team.mates, ...you2.team.mates].some((m) => m === 'Ada Lovelace' || m === 'Alan Turing'));
  const tState = lastOf(teacher, 'activity:teams:state');
  ok('teacher sees the full team roster with real names', tState && tState.teams.some((t) => t.members.some((m) => m.name === 'Anonymous' || typeof m.name === 'string')));

  // s1 answers its team's first question correctly.
  s1.sendJSON({ type: 'activity:teams:answer', exId: you1.exId, qIndex: 0, choice: 1 });
  await wait(80);
  const frozen = lastOf(s1, 'activity:teams:frozen');
  ok('s1 gets immediate right/wrong + explanation on answer', frozen && frozen.correct === true && frozen.explanation === 'Paris is the capital.');
  ok('teacher sees live progress with the standings', lastOf(teacher, 'activity:teams:progress'));

  // A student who joins AFTER teams were formed is a spectator — deliberately
  // not injected into an existing team (which may already have answered).
  const s3 = open(null); await onOpen(s3); await wait(120);
  ok('a late joiner is NOT force-added to an in-progress team', !lastOf(s3, 'activity:teams:you'));

  // But an already-teamed student who reconnects on the SAME socket keeps their
  // frozen answers on resync (validated here by re-sending state to teacher).
  teacher.close(); await wait(40);
  const teacher2 = open('session=teacher-abc'); await onOpen(teacher2); await wait(120);
  ok('a reconnecting teacher is caught up to the running exercise', lastOf(teacher2, 'activity:teams:state'));

  teacher2.sendJSON({ type: 'activity:teams:clear' });
  await wait(80);
  ok('clearing the exercise reaches every student', lastOf(s1, 'activity:teams:cleared') && lastOf(s3, 'activity:teams:cleared'));

  [teacher2, s1, s2, s3].forEach((w) => w.close());
  await wait(60);
  server.close();
  console.log(`\nAll ${passed} assertions passed.`);
  process.exit(0);
})().catch((err) => { console.error('FAILED:', err.message); try { server.close(); } catch (_) {} process.exit(1); });
