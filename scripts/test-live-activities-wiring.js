/* Structural guards for the live-activities feature. No browser: these keep the
 * client/server message contract and the page wiring from drifting apart.
 *   - every activity:* message the SERVER sends to a client is HANDLED by the
 *     client module (a missing case = a silently ignored update);
 *   - every activity:* message the CLIENT sends is ROUTED by the server engine;
 *   - both live surfaces load the script + stylesheet and route activity:*.
 * Run: node scripts/test-live-activities-wiring.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0; let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const types = (src) => new Set((src.match(/activity:[a-z:]+/g) || []));

const engine = read('server/live-activities.js');
const client = read('public/live-activities.js');
const appJs = read('public/app.js');
const boardJs = read('public/board.js');
const appHtml = read('public/app.html');
const boardHtml = read('public/board.html');
const serverJs = read('server/server.js');

console.log('client handles what the server sends');
{
  // Types the server emits to CLIENTS (bus.toActor/toStudents/toAll/toParticipant*
  // /toTeacher). We approximate "server-emitted" as every activity type that
  // appears in the engine but is NOT a purely inbound command.
  const inboundOnly = new Set([
    'activity:poll:launch', 'activity:poll:close', 'activity:poll:vote',
    'activity:teams:launch', 'activity:teams:reveal', 'activity:teams:scorecard',
    'activity:teams:clear', 'activity:teams:answer', 'activity:teams:chat'
  ]);
  const emitted = [...types(engine)].filter((t) => !inboundOnly.has(t));
  // The client's switch must have a case for each emitted type.
  const clientCases = new Set((client.match(/case '(activity:[a-z:]+)'/g) || []).map((m) => m.slice(6, -1)));
  emitted.forEach((t) => ok(`client handles ${t}`, clientCases.has(t)));
}

console.log('\nserver routes what the client sends');
{
  // Types the client SENDS via send({ type: 'activity:...' }).
  const sent = new Set((client.match(/type: '(activity:[a-z:]+)'/g) || []).map((m) => m.match(/'(activity:[a-z:]+)'/)[1]));
  // The engine's handle() switch must recognise each (as an explicit case).
  const engineCases = new Set((engine.match(/case '(activity:[a-z:]+)'/g) || []).map((m) => m.slice(6, -1)));
  // poll:vote / teams:answer / teams:chat are student-branch cases; include them.
  sent.forEach((t) => ok(`engine routes ${t}`, engineCases.has(t)));
}

console.log('\nboth surfaces are wired');
{
  ok('app.html loads the stylesheet', /live-activities\.css/.test(appHtml));
  ok('app.html loads the script before app.js', appHtml.indexOf('live-activities.js') < appHtml.indexOf('/app.js') && /live-activities\.js/.test(appHtml));
  ok('board.html loads the stylesheet', /live-activities\.css/.test(boardHtml));
  ok('board.html loads the script before board.js', boardHtml.indexOf('live-activities.js') < boardHtml.indexOf('/board.js') && /live-activities\.js/.test(boardHtml));
  ok('app.js routes activity:* to the module', /startsWith\('activity:'\)/.test(appJs) && /\.handle\(m\)/.test(appJs));
  ok('board.js routes activity:* to the module', /startsWith\('activity:'\)/.test(boardJs) && /\.handle\(m\)/.test(boardJs));
  ok('app.js attaches with host lesson', /host: 'lesson'/.test(appJs));
  ok('board.js attaches with host board', /host: 'board'/.test(boardJs));
  ok('server exposes the question-bank endpoint', /\/api\/live\/question-banks/.test(serverJs));
  ok('lesson-live imports the engine', /require\('\.\/live-activities'\)/.test(read('server/lesson-live.js')));
  ok('board imports the engine', /require\('\.\/live-activities'\)/.test(read('server/board.js')));
}

console.log('\nprivacy: student payloads never carry the answer key');
{
  // studentQuestion() must strip answerIndex/explanation.
  const sq = engine.slice(engine.indexOf('function studentQuestion'), engine.indexOf('function studentQuestion') + 140);
  ok('studentQuestion sends only question + choices', /question: q\.question, choices: q\.choices/.test(sq) && !/answerIndex/.test(sq));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
