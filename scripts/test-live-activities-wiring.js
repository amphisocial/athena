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

console.log('\nUI: the hidden attribute must actually hide the panel + launcher');
{
  const css = read('public/live-activities.css');
  // An author display:flex/inline-flex defeats the UA [hidden]{display:none};
  // there must be an explicit override or Close/Esc/toggle silently no-op.
  ok('css forces display:none for [hidden] panel + launcher',
    /\.la-(launcher|panel)\[hidden\][^{]*,?[^{]*\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/.test(css)
    || (/\.la-launcher\[hidden\]/.test(css) && /\.la-panel\[hidden\]/.test(css) && /display:\s*none\s*!important/.test(css)));
  ok('cache-buster present so the fix actually loads', /live-activities\.js\?v=boardsy\d+/.test(appHtml) && /live-activities\.js\?v=boardsy\d+/.test(boardHtml));
}

console.log('\nExit ends a live session before leaving');
{
  ok('presentExitBtn ends live for a live teacher', /teacherLive/.test(appJs) && /teacherEndLive\(\)/.test(appJs.slice(appJs.indexOf('presentExitBtn'))));
}

console.log('\nstudents can never open Activities');
{
  ok('openPanel refuses non-teachers', /function openPanel[\s\S]{0,80}role !== 'teacher'\) return/.test(client));
  ok('launcher click refuses non-teachers', /launcher\.addEventListener[\s\S]{0,90}role !== 'teacher'\) return/.test(client));
}

console.log('\njoin-by-code');
{
  const indexHtml = read('public/index.html');
  ok('homepage has a join-by-code box under the founding strip',
    indexHtml.indexOf('founding-strip') < indexHtml.indexOf('joinLiveForm') && /id="joinCode"/.test(indexHtml));
  ok('join box navigates to /l/<code>', /location\.href = '\/l\/' \+ encodeURIComponent\(code\)/.test(indexHtml));
  ok('teacher session QR shows a copyable join code', /id="lessonQrCode"/.test(read('public/app.html')) && /lessonQrCode/.test(appJs));
}

console.log('\nmandatory name + roster + kick');
{
  const lesson = read('server/lesson-live.js');
  ok('server reads the entered name from the WS query', /searchParams\.get\('name'\)/.test(lesson));
  ok('presence roster carries id + name for the teacher', /roster = \[\.\.\.room\.students\]\.map\(\(c\) => \(\{ id: c\.id/.test(lesson));
  ok('server handles teacher kick + blocks rejoin', /msg\.type === 'kick'/.test(lesson) && /room\.removed\.add/.test(lesson));
  ok('client prompts for a name before joining live', /function promptStudentName/.test(appJs) && /connectLive\(token, 'student', name\)/.test(appJs));
  ok('client renders a roster with remove buttons', /id="rosterToggle"/.test(appJs) && /lr-kick/.test(appJs) && /type: 'kick'/.test(appJs));
  ok('client handles being kicked', /m\.type === 'kicked'/.test(appJs) && /showKickedNotice/.test(appJs));
}

console.log('\nroster Remove button is readable + roster scrolls');
{
  const css = read('public/live-activities.css');
  // theme-light forces .btn.ghost text dark with !important; the Remove button
  // must override that with its own !important colour or it's invisible on the
  // dark presenting panel.
  ok('Remove button has an !important colour override', /\.lr-kick\.btn[\s\S]{0,160}color:[^;]*!important/.test(css));
  ok('roster scrolls (max-height + overflow)', /\.live-roster\b/.test(css) && /max-height:\s*240px/.test(css) && /overflow-y:\s*auto/.test(css));
}

console.log('\nwhiteboard parity: join-by-code, anonymous live join, roster + kick');
{
  const bjs = read('public/board.js');
  const bsrv = read('server/board.js');
  const bhtml = read('public/board.html');
  ok('board WS accepts an anonymous named participant', /participant = \{ id: cid, firstName/.test(bsrv) && /searchParams\.get\('name'\)/.test(bsrv));
  ok('board WS resolves a public token to the board', /publicToken === (boardIdValue|joinKey)/.test(bsrv));
  ok('board WS handles teacher kick + blocks rejoin', /msg\.type === 'kick'/.test(bsrv) && /removedFor\(targetBoardId\)\.add/.test(bsrv));
  ok('board presence carries id for kicking', /viewers = Array\.from\(room\)[\s\S]{0,240}id: c\.cid/.test(bsrv));
  ok('board client prompts for a name to join a live public board', /function promptBoardName/.test(bjs) && /board\.isLive[\s\S]{0,120}promptBoardName/.test(bjs));
  ok('board client passes the name into the WS', /&name=\$\{encodeURIComponent\(joinName\)\}/.test(bjs));
  ok('board viewers panel has Remove buttons', /viewer-kick/.test(bjs) && /type: 'kick'/.test(bjs));
  ok('board client handles being kicked', /m\.type === 'kicked'/.test(bjs) && /function boardKicked/.test(bjs));
  ok('board shows a copyable join code', /id="sessionQrCode"/.test(bhtml) && /sessionQrCode/.test(bjs));
  ok('server has a join-code resolver for lesson + board', /\/api\/join\/:code/.test(serverJs) && /kind: 'board'/.test(serverJs));
  ok('homepage join box uses the resolver', /\/api\/join\//.test(read('public/index.html')));
}

console.log('\nwhiteboard fixes: activities reach code-joined students, fullscreen, clear, viewers z-index');
{
  const bjs = read('public/board.js');
  const css = read('public/live-activities.css');
  // The killer bug: liveActivities() must NOT bail on NOLOGIN, or /s/:token
  // (code-joined) students never get polls/teams.
  ok('board activities are NOT gated behind NOLOGIN', /function liveActivities[\s\S]{0,500}!window\.LiveActivities \|\| GUEST\) return LA/.test(bjs) && !/!window\.LiveActivities \|\| NOLOGIN\) return LA/.test(bjs));
  ok('fullscreen targets the document so overlays render', /fullscreenBtn[\s\S]{0,360}document\.documentElement\.requestFullscreen/.test(bjs));
  ok('clear-page is guarded against non-owners', /clearBoardBtn[\s\S]{0,120}if \(!isOwner\) return/.test(bjs));
  ok('viewers panel lifted above the join QR', /\.viewers-panel\s*\{\s*z-index:\s*30\s*!important/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
