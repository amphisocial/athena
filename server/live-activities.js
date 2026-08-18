/* live-activities.js — immersive in-session activities shared by BOTH live
 * surfaces (the whiteboard at /ws/board and the lesson at /ws/lesson).
 *
 * Two activities live here:
 *   1) Poll   — the teacher fires one prepared question; every student gets a
 *               popup, and as answers land a live bar graph builds on the
 *               teacher's screen and (once they've voted, or when the teacher
 *               closes it) on every student's screen too.
 *   2) Teams  — the teacher splits present students into randomised teams named
 *               after mountain ranges, hands them a quiz, and watches each
 *               team's score climb in real time. A team's answer to a question
 *               freezes the instant any member picks it; the team learns right/
 *               wrong immediately. When every team finishes, the standings are
 *               revealed to the whole room and the winner(s) are crowned.
 *
 * DESIGN: this module is deliberately host-agnostic. The board and lesson
 * WebSocket servers have different room shapes and different privacy models, so
 * instead of reaching into either, each host hands us a small `bus` describing
 * how to reach the teacher, a single participant, a set of participants, or the
 * whole room, plus the current roster. We own the activity STATE (keyed by the
 * host's room id) and never touch disk: per the product spec, a team exercise
 * is ephemeral — it is never stored for future reference. Only the exported
 * scorecard (correct answers + explanations) leaves the room, and that is built
 * on demand and handed back to the teacher to download.
 *
 * MESSAGE NAMESPACE: everything here is `activity:*`, so a host can route to us
 * with a single `if (msg.type.startsWith('activity:')) activities.handle(...)`.
 */

// Team names are drawn from real mountain ranges of the world. Paired 1:1 with
// a distinct, high-contrast colour so a team reads as "the Andes (red) team"
// at a glance on both the dark board and the light lesson theme.
const RANGE_POOL = [
  { name: 'Andes', color: '#ff6b7a' },
  { name: 'Himalaya', color: '#14d9c4' },
  { name: 'Alps', color: '#7c5cff' },
  { name: 'Rockies', color: '#ffcc66' },
  { name: 'Atlas', color: '#4fc3f7' },
  { name: 'Karakoram', color: '#ff9f6b' },
  { name: 'Cascades', color: '#9ccc65' },
  { name: 'Pyrenees', color: '#f06292' },
  { name: 'Caucasus', color: '#26c6da' },
  { name: 'Urals', color: '#ba68c8' },
  { name: 'Dolomites', color: '#ffd54f' },
  { name: 'Drakensberg', color: '#80cbc4' },
  { name: 'Appalachians', color: '#a1887f' },
  { name: 'Carpathians', color: '#7986cb' },
  { name: 'Sierra Nevada', color: '#4db6ac' },
  { name: 'Altai', color: '#ff8a65' }
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rid(prefix) { return `${prefix}_${Math.random().toString(16).slice(2, 10)}`; }

// A prepared question, sanitised down to exactly what an activity needs. The
// teacher-facing copy keeps the correct index + explanation; the student copy
// is stripped of both so a device can't reveal the answer early.
function cleanQuestion(q) {
  const question = String(q.question || q.front || '').slice(0, 600).trim();
  const choices = (Array.isArray(q.choices) ? q.choices : [])
    .map((c) => String(c).slice(0, 300).trim())
    .filter(Boolean)
    .slice(0, 6);
  let answerIndex = Number.isInteger(q.answerIndex) ? q.answerIndex : -1;
  if (answerIndex < 0 || answerIndex >= choices.length) answerIndex = -1;
  const explanation = String(q.explanation || '').slice(0, 1200).trim();
  return { question, choices, answerIndex, explanation };
}
function studentQuestion(q) { return { question: q.question, choices: q.choices }; }

function createLiveActivities() {
  // roomId -> { poll, teams }
  const rooms = new Map();
  function roomState(id) {
    if (!rooms.has(id)) rooms.set(id, { poll: null, teams: null });
    return rooms.get(id);
  }

  // ---- Poll ---------------------------------------------------------------
  function pollTally(poll) {
    const counts = poll.choices.map(() => 0);
    let total = 0;
    poll.votes.forEach((choice) => { if (counts[choice] != null) { counts[choice] += 1; total += 1; } });
    return { counts, total };
  }

  function launchPoll(state, bus, msg) {
    const q = cleanQuestion(msg);
    if (!q.question || q.choices.length < 2) {
      bus.toTeacher({ type: 'activity:error', scope: 'poll', message: 'A poll needs a question and at least two choices.' });
      return;
    }
    if (bus.roster().length < 1) {
      bus.toTeacher({ type: 'activity:error', scope: 'poll', message: 'No students have joined yet — wait for at least one to arrive before polling.' });
      return;
    }
    // A survey (no correct answer) is allowed: answerIndex stays -1.
    const poll = { id: rid('poll'), ...q, votes: new Map(), open: true };
    state.poll = poll;
    // Students get the popup (question + choices only).
    bus.toStudents({ type: 'activity:poll:show', pollId: poll.id, question: poll.question, choices: poll.choices });
    // Teacher gets the empty graph to watch fill up.
    const { counts, total } = pollTally(poll);
    bus.toTeacher({ type: 'activity:poll:state', pollId: poll.id, question: poll.question, choices: poll.choices, answerIndex: poll.answerIndex, explanation: poll.explanation, counts, total, votedCount: 0, roster: bus.roster().length });
  }

  function votePoll(state, bus, actor, msg) {
    const poll = state.poll;
    if (!poll || !poll.open || poll.id !== msg.pollId) return;
    const choice = Number(msg.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= poll.choices.length) return;
    if (poll.votes.has(actor.id)) return; // one vote per participant, no changes
    poll.votes.set(actor.id, choice);
    const { counts, total } = pollTally(poll);
    // The voter's popup closes into the live graph, and they see whether they
    // were right (only when the poll actually has a correct answer).
    bus.toActor({ type: 'activity:poll:result', pollId: poll.id, yourChoice: choice, answerIndex: poll.answerIndex, explanation: poll.explanation, counts, total });
    // Teacher's graph updates; other voters' graphs update too.
    bus.toTeacher({ type: 'activity:poll:tally', pollId: poll.id, counts, total, votedCount: poll.votes.size, roster: bus.roster().length });
    const votedIds = [...poll.votes.keys()].filter((id) => id !== actor.id);
    bus.toParticipants(votedIds, { type: 'activity:poll:tally', pollId: poll.id, counts, total });
  }

  function closePoll(state, bus) {
    const poll = state.poll;
    if (!poll) return;
    poll.open = false;
    const { counts, total } = pollTally(poll);
    // Everyone — including students who never voted — lands on the final graph.
    bus.toAll({ type: 'activity:poll:closed', pollId: poll.id, counts, total, answerIndex: poll.answerIndex, explanation: poll.explanation });
    state.poll = null;
  }

  // ---- Teams --------------------------------------------------------------
  function standingsOf(teams, quizLen) {
    return teams.map((t) => {
      let score = 0; let answered = 0;
      t.answers.forEach((a) => { answered += 1; if (a.correct) score += 1; });
      return {
        teamId: t.id, name: t.name, color: t.color,
        score, answered, total: quizLen,
        perfect: answered === quizLen && score === quizLen,
        done: answered === quizLen,
        finishedAt: t.finishedAt || null
      };
    });
  }

  function pushTeacherState(state, bus) {
    const ex = state.teams;
    if (!ex) return;
    bus.toTeacher({
      type: 'activity:teams:state',
      exId: ex.id,
      title: ex.title,
      quizLen: ex.quiz.length,
      teams: ex.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, members: t.members.map((m) => ({ id: m.id, name: m.name })) })),
      standings: standingsOf(ex.teams, ex.quiz.length)
    });
  }

  function launchTeams(state, bus, msg) {
    const roster = bus.roster(); // [{ id, name, label }]
    if (roster.length < 2) {
      bus.toTeacher({ type: 'activity:error', scope: 'teams', message: 'You need at least two students present to make teams.' });
      return;
    }
    const quiz = (Array.isArray(msg.quiz) ? msg.quiz : []).map(cleanQuestion).filter((q) => q.question && q.choices.length >= 2);
    if (!quiz.length) {
      bus.toTeacher({ type: 'activity:error', scope: 'teams', message: 'Pick at least one quiz question for the team exercise.' });
      return;
    }
    // Teacher picks how many teams; clamp to something sane given attendance.
    let teamCount = Math.round(Number(msg.teamCount) || 0);
    if (!teamCount || teamCount < 2) teamCount = Math.min(4, Math.max(2, Math.round(roster.length / 2)));
    teamCount = Math.max(2, Math.min(teamCount, roster.length, RANGE_POOL.length));

    const ranges = shuffle(RANGE_POOL).slice(0, teamCount);
    const teams = ranges.map((r) => ({ id: rid('team'), name: r.name, color: r.color, members: [], answers: new Map(), finishedAt: null }));
    // Snake the shuffled roster across teams for even, random sizes.
    shuffle(roster).forEach((p, i) => { teams[i % teamCount].members.push({ id: p.id, name: p.name, label: p.label }); });

    const memberToTeam = new Map();
    teams.forEach((t) => t.members.forEach((m) => memberToTeam.set(m.id, t.id)));

    const ex = { id: rid('ex'), title: String(msg.title || 'Team quiz').slice(0, 120), quiz, teams, memberToTeam, done: false };
    state.teams = ex;

    // Each student is told their team, their teammates (by the room's safe
    // label — see the host adapters), and the quiz WITHOUT answers.
    teams.forEach((t) => {
      const mates = t.members.map((m) => m.label);
      t.members.forEach((m) => {
        bus.toParticipant(m.id, {
          type: 'activity:teams:you',
          exId: ex.id,
          team: { id: t.id, name: t.name, color: t.color, mates },
          quiz: ex.quiz.map(studentQuestion)
        });
      });
    });
    pushTeacherState(state, bus);
  }

  function answerTeams(state, bus, actor, msg) {
    const ex = state.teams;
    if (!ex || ex.id !== msg.exId) return;
    const teamId = ex.memberToTeam.get(actor.id);
    if (!teamId) return; // actor isn't on a team (e.g. joined after teams formed)
    const team = ex.teams.find((t) => t.id === teamId);
    if (!team) return;
    const qIndex = Number(msg.qIndex);
    if (!Number.isInteger(qIndex) || qIndex < 0 || qIndex >= ex.quiz.length) return;

    // Freeze rule: the FIRST answer for this team on this question wins and can
    // never change. A racing second tap is rejected so the tapper's UI can
    // reconcile to the frozen state.
    if (team.answers.has(qIndex)) {
      const existing = team.answers.get(qIndex);
      bus.toActor({ type: 'activity:teams:reject', exId: ex.id, qIndex, reason: 'frozen', choice: existing.choice, correct: existing.correct });
      return;
    }
    const choice = Number(msg.choice);
    const q = ex.quiz[qIndex];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return;

    const correct = q.answerIndex >= 0 && choice === q.answerIndex;
    team.answers.set(qIndex, { choice, correct, byId: actor.id, byName: actor.name, byLabel: actor.label, at: new Date().toISOString() });

    const finishedNow = team.answers.size === ex.quiz.length && !team.finishedAt;
    if (finishedNow) team.finishedAt = new Date().toISOString();

    // The whole team immediately sees the frozen answer + right/wrong + the
    // correct choice and its explanation.
    const memberIds = team.members.map((m) => m.id);
    bus.toParticipants(memberIds, {
      type: 'activity:teams:frozen',
      exId: ex.id, qIndex, choice,
      correct, correctIndex: q.answerIndex, explanation: q.explanation,
      byLabel: actor.label
    });

    // Teacher watches the score climb, and sees WHO answered each question.
    bus.toTeacher({
      type: 'activity:teams:progress',
      exId: ex.id, teamId: team.id, qIndex, choice, correct,
      byName: actor.name, byLabel: actor.label,
      standings: standingsOf(ex.teams, ex.quiz.length)
    });

    if (ex.teams.every((t) => t.answers.size === ex.quiz.length)) finishTeams(state, bus);
  }

  // Team-scoped chat: a message from a member is relayed only to that team (so
  // teams can't read each other) plus the teacher, who can monitor. Ephemeral —
  // never stored.
  function chatTeams(state, bus, actor, msg) {
    const ex = state.teams;
    if (!ex || ex.id !== msg.exId) return;
    const teamId = ex.memberToTeam.get(actor.id);
    if (!teamId) return;
    const team = ex.teams.find((t) => t.id === teamId);
    if (!team) return;
    const text = String(msg.text || '').slice(0, 400).trim();
    if (!text) return;
    const payload = { type: 'activity:teams:chat', exId: ex.id, teamId, from: actor.label, text, at: new Date().toISOString() };
    bus.toParticipants(team.members.map((m) => m.id), payload);
    bus.toTeacher({ ...payload, fromName: actor.name });
  }

  function computeResults(ex) {
    const standings = standingsOf(ex.teams, ex.quiz.length);
    const maxScore = standings.reduce((m, s) => Math.max(m, s.score), 0);
    const winners = maxScore > 0 ? standings.filter((s) => s.score === maxScore).map((s) => s.teamId) : [];
    // "First to a perfect score is a natural winner": among perfect teams, the
    // one that finished earliest.
    const perfect = standings.filter((s) => s.perfect && s.finishedAt).sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
    const firstPerfect = perfect.length ? perfect[0].teamId : null;
    return { standings, winners, firstPerfect, maxScore };
  }

  function finishTeams(state, bus, forced) {
    const ex = state.teams;
    if (!ex) return;
    ex.done = true;
    const { standings, winners, firstPerfect } = computeResults(ex);
    // Standings go to the whole room — everyone sees the board and the winner.
    bus.toAll({ type: 'activity:teams:results', exId: ex.id, title: ex.title, standings, winners, firstPerfect, forced: !!forced });
  }

  // The exportable scorecard: for each team, every question with the team's
  // answer, who entered it, whether it was right, and — crucially — the correct
  // answer and its explanation, so the teacher can share the review later.
  function scorecard(ex) {
    const { standings, winners, firstPerfect } = computeResults(ex);
    return {
      title: ex.title,
      generatedAt: new Date().toISOString(),
      winners, firstPerfect,
      standings,
      questions: ex.quiz.map((q, i) => ({
        index: i, question: q.question, choices: q.choices,
        answerIndex: q.answerIndex,
        answerText: q.answerIndex >= 0 ? q.choices[q.answerIndex] : '',
        explanation: q.explanation
      })),
      teams: ex.teams.map((t) => ({
        name: t.name, color: t.color,
        members: t.members.map((m) => m.name || m.label),
        answers: ex.quiz.map((q, i) => {
          const a = t.answers.get(i);
          return a
            ? { qIndex: i, choice: a.choice, choiceText: q.choices[a.choice] || '', correct: a.correct, enteredBy: a.byName || a.byLabel, at: a.at }
            : { qIndex: i, choice: -1, choiceText: '', correct: false, enteredBy: '', at: null };
        })
      }))
    };
  }

  // ---- Public surface -----------------------------------------------------
  // Returns true if the message was an activity message (handled or ignored),
  // so the host can `return` and not fall through to its own handlers.
  function handle({ roomId, isTeacher, actor, bus, msg }) {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('activity:')) return false;
    const state = roomState(roomId);

    // Teacher-only controls.
    if (isTeacher) {
      switch (msg.type) {
        case 'activity:poll:launch': launchPoll(state, bus, msg); return true;
        case 'activity:poll:close': closePoll(state, bus); return true;
        case 'activity:teams:launch': launchTeams(state, bus, msg); return true;
        case 'activity:teams:reveal': finishTeams(state, bus, true); return true;
        case 'activity:teams:scorecard':
          if (state.teams) bus.toTeacher({ type: 'activity:teams:scorecard', card: scorecard(state.teams) });
          return true;
        case 'activity:teams:clear':
          state.teams = null;
          bus.toAll({ type: 'activity:teams:cleared' });
          return true;
        default: return true; // swallow unknown teacher activity messages
      }
    }

    // Student inbound.
    switch (msg.type) {
      case 'activity:poll:vote': votePoll(state, bus, actor, msg); return true;
      case 'activity:teams:answer': answerTeams(state, bus, actor, msg); return true;
      case 'activity:teams:chat': chatTeams(state, bus, actor, msg); return true;
      default: return true;
    }
  }

  // When a participant reconnects, replay whatever is currently live so their
  // screen isn't blank mid-activity.
  function resync({ roomId, isTeacher, actor, bus }) {
    const state = rooms.get(roomId);
    if (!state) return;
    if (state.poll && state.poll.open) {
      if (isTeacher) {
        const { counts, total } = pollTally(state.poll);
        bus.toActor({ type: 'activity:poll:state', pollId: state.poll.id, question: state.poll.question, choices: state.poll.choices, answerIndex: state.poll.answerIndex, explanation: state.poll.explanation, counts, total, votedCount: state.poll.votes.size, roster: bus.roster().length });
      } else if (state.poll.votes.has(actor.id)) {
        const { counts, total } = pollTally(state.poll);
        bus.toActor({ type: 'activity:poll:tally', pollId: state.poll.id, counts, total });
      } else {
        bus.toActor({ type: 'activity:poll:show', pollId: state.poll.id, question: state.poll.question, choices: state.poll.choices });
      }
    }
    const ex = state.teams;
    if (ex) {
      if (isTeacher) { pushTeacherState(state, bus); if (ex.done) finishTeams(state, bus, true); }
      else {
        const teamId = ex.memberToTeam.get(actor.id);
        const team = teamId && ex.teams.find((t) => t.id === teamId);
        if (team) {
          bus.toActor({ type: 'activity:teams:you', exId: ex.id, team: { id: team.id, name: team.name, color: team.color, mates: team.members.map((m) => m.label) }, quiz: ex.quiz.map(studentQuestion) });
          // Replay this team's frozen answers so a reconnecting device catches up.
          team.answers.forEach((a, qIndex) => {
            const q = ex.quiz[qIndex];
            bus.toActor({ type: 'activity:teams:frozen', exId: ex.id, qIndex, choice: a.choice, correct: a.correct, correctIndex: q.answerIndex, explanation: q.explanation, byLabel: a.byLabel });
          });
        }
      }
    }
  }

  function clearRoom(roomId) { rooms.delete(roomId); }

  return { handle, resync, clearRoom };
}

module.exports = { createLiveActivities };
