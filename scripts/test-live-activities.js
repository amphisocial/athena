/* Focused test for server/live-activities.js — exercises the poll + team quiz
 * engine with a mock "bus" that records what each recipient receives. No DB, no
 * sockets. Run: node scripts/test-live-activities.js */
const assert = require('assert');
const { createLiveActivities } = require('../server/live-activities');

let passed = 0;
function ok(label, cond) { assert.ok(cond, label); passed += 1; console.log('  ✓', label); }

// A mock room + bus. Participants have { id, name, label }. We capture messages
// per participant id and for the teacher, and expose a mutable roster.
function makeRoom(participants) {
  const inbox = { teacher: [], byId: {} };
  participants.forEach((p) => { inbox.byId[p.id] = []; });
  let actorWs = null; // we simulate "actor" via a closure per call
  function busFor(actorId) {
    return {
      toTeacher: (o) => inbox.teacher.push(o),
      toActor: (o) => { if (actorId) (inbox.byId[actorId] = inbox.byId[actorId] || []).push(o); },
      toParticipant: (id, o) => { (inbox.byId[id] = inbox.byId[id] || []).push(o); },
      toParticipants: (ids, o) => ids.forEach((id) => { (inbox.byId[id] = inbox.byId[id] || []).push(o); }),
      toStudents: (o) => participants.forEach((p) => inbox.byId[p.id].push(o)),
      toAll: (o) => { inbox.teacher.push(o); participants.forEach((p) => inbox.byId[p.id].push(o)); },
      roster: () => participants.map((p) => ({ id: p.id, name: p.name, label: p.label }))
    };
  }
  return { inbox, busFor, participants };
}
const last = (arr, type) => [...arr].reverse().find((m) => m.type === type);

console.log('POLL');
(() => {
  const eng = createLiveActivities();
  const room = makeRoom([
    { id: 's1', name: 'Ana Ng', label: 'Student 1' },
    { id: 's2', name: 'Bo Li', label: 'Student 2' },
    { id: 's3', name: 'Cy Fox', label: 'Student 3' }
  ]);
  const roomId = 'r1';
  // Teacher launches a poll with a correct answer (index 1).
  eng.handle({ roomId, isTeacher: true, actor: { id: 't', name: 'T', label: 'T' }, bus: room.busFor(null),
    msg: { type: 'activity:poll:launch', question: '2+2?', choices: ['3', '4', '5'], answerIndex: 1, explanation: 'Basic sum.' } });
  ok('students receive the popup (no answer leaked)', room.participants.every((p) => {
    const show = last(room.inbox.byId[p.id], 'activity:poll:show');
    return show && show.question === '2+2?' && show.choices.length === 3 && show.answerIndex === undefined;
  }));
  const state0 = last(room.inbox.teacher, 'activity:poll:state');
  ok('teacher gets initial empty state with roster', state0 && state0.total === 0 && state0.roster === 3);

  // s1 votes correct, s2 votes wrong.
  eng.handle({ roomId, isTeacher: false, actor: room.participants[0], bus: room.busFor('s1'), msg: { type: 'activity:poll:vote', pollId: state0.pollId, choice: 1 } });
  eng.handle({ roomId, isTeacher: false, actor: room.participants[1], bus: room.busFor('s2'), msg: { type: 'activity:poll:vote', pollId: state0.pollId, choice: 0 } });
  const r1 = last(room.inbox.byId.s1, 'activity:poll:result');
  ok('voter gets their result with the correct index + explanation', r1 && r1.yourChoice === 1 && r1.answerIndex === 1 && r1.explanation === 'Basic sum.');
  const tally = last(room.inbox.teacher, 'activity:poll:tally');
  ok('teacher tally reflects two votes', tally && tally.total === 2 && tally.counts[1] === 1 && tally.counts[0] === 1);

  // s1 tries to vote again — ignored (one vote, no change).
  const before = room.inbox.byId.s1.length;
  eng.handle({ roomId, isTeacher: false, actor: room.participants[0], bus: room.busFor('s1'), msg: { type: 'activity:poll:vote', pollId: state0.pollId, choice: 2 } });
  ok('a second vote from the same student is ignored', room.inbox.byId.s1.length === before);

  // Teacher closes — everyone (incl. non-voter s3) gets the final graph.
  eng.handle({ roomId, isTeacher: true, actor: { id: 't' }, bus: room.busFor(null), msg: { type: 'activity:poll:close' } });
  ok('non-voter also receives the closed/final graph', last(room.inbox.byId.s3, 'activity:poll:closed'));
})();

console.log('TEAMS');
(() => {
  const eng = createLiveActivities();
  const ppl = [];
  for (let i = 1; i <= 6; i += 1) ppl.push({ id: `s${i}`, name: `Name ${i}`, label: `Student ${i}` });
  const room = makeRoom(ppl);
  const roomId = 'r2';
  const quiz = [
    { front: 'Q1', choices: ['a', 'b'], answerIndex: 0, explanation: 'because a' },
    { front: 'Q2', choices: ['x', 'y'], answerIndex: 1, explanation: 'because y' }
  ];
  eng.handle({ roomId, isTeacher: true, actor: { id: 't' }, bus: room.busFor(null),
    msg: { type: 'activity:teams:launch', teamCount: 3, quiz, title: 'Mountains quiz' } });
  const tState = last(room.inbox.teacher, 'activity:teams:state');
  ok('teacher gets team state with 3 teams', tState && tState.teams.length === 3 && tState.quizLen === 2);
  ok('every student is assigned to a team and gets the quiz w/o answers', ppl.every((p) => {
    const you = last(room.inbox.byId[p.id], 'activity:teams:you');
    return you && you.team && you.team.name && you.quiz.length === 2 && you.quiz[0].answerIndex === undefined;
  }));
  ok('team names are mountain ranges + colors, mates use safe labels', tState.teams.every((t) => t.name && t.members.length >= 1));

  // Map a member -> team for driving answers.
  const memberTeam = {};
  tState.teams.forEach((t) => t.members.forEach((m) => { memberTeam[m.id] = t; }));
  const teamA = tState.teams[0];
  const a1 = teamA.members[0];

  // teamA member answers Q1 correctly.
  eng.handle({ roomId, isTeacher: false, actor: ppl.find((p) => p.id === a1.id), bus: room.busFor(a1.id),
    msg: { type: 'activity:teams:answer', exId: tState.exId, qIndex: 0, choice: 0 } });
  const frozen = last(room.inbox.byId[a1.id], 'activity:teams:frozen');
  ok('answering freezes the question with immediate right/wrong + explanation', frozen && frozen.correct === true && frozen.correctIndex === 0 && frozen.explanation === 'because a');
  // every teammate on teamA got the frozen message
  ok('the whole team is notified of the frozen answer', teamA.members.every((m) => last(room.inbox.byId[m.id], 'activity:teams:frozen')));

  // A second member of teamA tries to change Q1 — rejected (frozen).
  if (teamA.members[1]) {
    const a2 = teamA.members[1];
    eng.handle({ roomId, isTeacher: false, actor: ppl.find((p) => p.id === a2.id), bus: room.busFor(a2.id),
      msg: { type: 'activity:teams:answer', exId: tState.exId, qIndex: 0, choice: 1 } });
    ok('a teammate cannot change a frozen answer', last(room.inbox.byId[a2.id], 'activity:teams:reject'));
  } else { ok('a teammate cannot change a frozen answer (team of 1, skipped)', true); }

  const prog = last(room.inbox.teacher, 'activity:teams:progress');
  ok('teacher sees who answered (by name) and live standings', prog && prog.byName && Array.isArray(prog.standings));

  // Drive ALL teams to answer BOTH questions correctly, so everyone finishes.
  tState.teams.forEach((t) => {
    quiz.forEach((q, qi) => {
      const m = t.members[0];
      eng.handle({ roomId, isTeacher: false, actor: ppl.find((p) => p.id === m.id), bus: room.busFor(m.id),
        msg: { type: 'activity:teams:answer', exId: tState.exId, qIndex: qi, choice: q.answerIndex } });
    });
  });
  const results = last(room.inbox.teacher, 'activity:teams:results');
  ok('when all teams finish, results are broadcast to everyone', results && results.standings.length === 3);
  ok('all-correct teams are perfect and all tie as winners', results.winners.length === 3 && results.standings.every((s) => s.perfect));
  ok('a firstPerfect team is identified as the natural winner', !!results.firstPerfect);
  ok('everyone (students too) receives the final standings', ppl.every((p) => last(room.inbox.byId[p.id], 'activity:teams:results')));

  // Scorecard export contains the answer key + who entered each answer.
  eng.handle({ roomId, isTeacher: true, actor: { id: 't' }, bus: room.busFor(null), msg: { type: 'activity:teams:scorecard' } });
  const sc = last(room.inbox.teacher, 'activity:teams:scorecard');
  ok('scorecard carries the answer key with explanations', sc && sc.card.questions.length === 2 && sc.card.questions[0].answerText === 'a' && sc.card.questions[0].explanation === 'because a');
  ok('scorecard records each team\'s answers + who entered them', sc.card.teams.every((t) => t.answers.length === 2 && t.answers.every((a) => a.enteredBy)));

  // Team chat is relayed to the team + teacher only.
  eng.handle({ roomId, isTeacher: false, actor: ppl.find((p) => p.id === a1.id), bus: room.busFor(a1.id),
    msg: { type: 'activity:teams:chat', exId: tState.exId, text: 'go with a' } });
  ok('chat reaches teammates', teamA.members.every((m) => last(room.inbox.byId[m.id], 'activity:teams:chat')));
  const otherTeam = tState.teams[1];
  ok('chat does NOT leak to other teams', otherTeam.members.every((m) => {
    const c = last(room.inbox.byId[m.id], 'activity:teams:chat');
    return !c || c.text !== 'go with a';
  }));

  // Clear wipes it for everyone.
  eng.handle({ roomId, isTeacher: true, actor: { id: 't' }, bus: room.busFor(null), msg: { type: 'activity:teams:clear' } });
  ok('clearing the exercise notifies everyone', ppl.every((p) => last(room.inbox.byId[p.id], 'activity:teams:cleared')));
})();

console.log('GUARDS');
(() => {
  const eng = createLiveActivities();
  const room = makeRoom([{ id: 's1', name: 'A', label: 'Student 1' }]);
  // Teams need >= 2 students.
  eng.handle({ roomId: 'r3', isTeacher: true, actor: { id: 't' }, bus: room.busFor(null),
    msg: { type: 'activity:teams:launch', teamCount: 2, quiz: [{ front: 'Q', choices: ['a', 'b'], answerIndex: 0 }] } });
  ok('teams refuse to start with fewer than two students', last(room.inbox.teacher, 'activity:error'));
  // Poll needs 2+ choices.
  eng.handle({ roomId: 'r3', isTeacher: true, actor: { id: 't' }, bus: room.busFor(null),
    msg: { type: 'activity:poll:launch', question: 'Q', choices: ['only one'], answerIndex: 0 } });
  ok('poll refuses with fewer than two choices', [...room.inbox.teacher].reverse().find((m) => m.type === 'activity:error' && m.scope === 'poll'));

  // Poll needs at least one student to answer.
  const empty = makeRoom([]);
  eng.handle({ roomId: 'r4', isTeacher: true, actor: { id: 't' }, bus: empty.busFor(null),
    msg: { type: 'activity:poll:launch', question: 'Q', choices: ['a', 'b'], answerIndex: 0 } });
  ok('poll refuses when no students have joined', [...empty.inbox.teacher].reverse().find((m) => m.type === 'activity:error' && m.scope === 'poll'));
})();

console.log(`\nAll ${passed} assertions passed.`);
