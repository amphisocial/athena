# Live session activities — polls & team quizzes

Immersive, in-session activities a teacher can run during any **LIVE** session,
on either surface:

- the whiteboard (`/board/:id`, `/ws/board`), and
- the lesson player (`/app?set=…`, `/ws/lesson`), including public/anonymous
  student sessions.

Two activities are supported, both driven from a single floating **🎬 Activities**
launcher the teacher sees while live.

## 1. Poll

The teacher picks one **prepared** question (see *Question banks* below). It pops
up on every student's screen. A student picks once — the choice is final. As
answers land, a live bar graph builds on the teacher's screen; each student sees
the graph the moment they vote, and **Close & reveal to everyone** pushes the
final graph (with the correct answer marked and its explanation) to the whole
room — including anyone who didn't vote.

A poll can be run as a **survey** (no right answer) with the checkbox at the
bottom of the picker.

## 2. Team quiz

The teacher chooses how many teams (or *Auto*), picks a quiz, and starts. The
server:

- randomly splits the **students currently present** into teams,
- names each team after a **mountain range** (with a distinct colour), and
- shows every student their team name + teammates, and the quiz **without the
  answers**.

Rules, exactly as specified:

- Any teammate can answer any question on their own device.
- The **first** answer a team gives to a question **freezes** it — it can never
  be changed. A racing second tap is rejected and reconciled to the frozen state.
- The team learns **immediately** whether the frozen answer was right or wrong,
  and sees the correct choice + explanation.
- Teammates can coordinate in a **team-only chat** (or just talk, if they're in
  the same room).
- The teacher watches every team's **score climb live**, and can expand *Who
  answered what* to see which student entered each answer.
- When every team has answered every question, the **standings** are revealed to
  the whole room. The top score wins; ties produce multiple winners. The first
  team to a **perfect score** is flagged as the natural winner.
- The teacher can **Export scorecard (CSV)** — standings, the full answer key
  with explanations (to share with the class later), and each team's answers
  with who entered them.
- The exercise is **ephemeral**: it lives only in server memory for the session
  and is never written to the database. **Clear exercise** wipes it for everyone.

## Question banks

Prepared questions come from the teacher's own study sets. `GET
/api/live/question-banks` returns each of the teacher's sets that contain
answerable quiz cards (a prompt + 2+ choices), with the correct index and
explanation. The whiteboard has no cards of its own, so this is how a live board
sources questions; the lesson player uses the same endpoint for consistency.

## Architecture

```
server/live-activities.js   Host-agnostic engine: owns activity STATE per room,
                            produces all activity:* messages. Never touches disk.
server/lesson-live.js       Adapts a lesson room -> engine (Student N labels).
server/board.js             Adapts a board room  -> engine (real names, already
                            public to the room via presence).
public/live-activities.js   Self-contained client: teacher launcher/panel,
                            student popups, team room + chat, standings, CSV.
public/live-activities.css  Themed via the app's CSS variables (works on the
                            dark board and the light lesson theme).
```

Every `activity:*` message is routed to the engine by both WebSocket servers
with a single `msg.type.startsWith('activity:')` check, and to the client module
via `LiveActivities.handle(m)`.

### Privacy

- On the **lesson** surface, teammates only ever see each other by the
  privacy-safe `Student N` label; real names never leave the server to peers.
  The teacher's scorecard uses real names where a student has an account.
- Student devices are **never** sent the answer key: `studentQuestion()` strips
  `answerIndex` and `explanation` before a quiz reaches a student. The correct
  answer is only revealed per question *after* the team has locked its answer.

### Late joiners & reconnects

Teams are formed from the students present at launch. A student who joins **after**
teams are formed is a spectator (not injected into an existing team, which may
already have answered). Reconnecting clients are caught up via `resync()` — a
teacher is restored to the running exercise, and a student who kept their socket
sees their team's frozen answers replayed. Because anonymous students have no
durable identity, a student who fully drops and reconnects during an exercise is
treated as a new participant.

## Tests

```
npm run test:activities
```

- `scripts/test-live-activities.js` — engine logic (poll flow, freeze rule,
  winners/ties/first-perfect, scorecard, team-scoped chat, guards).
- `scripts/test-live-activities-ws.js` — the real lesson-live WebSocket adapter
  over live sockets (teacher + anonymous students).
- `scripts/test-live-activities-wiring.js` — client/server message contract and
  page wiring (guards protocol drift; asserts the answer key never ships to
  students).
