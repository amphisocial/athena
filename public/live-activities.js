/* live-activities.js — the in-session immersive layer, shared verbatim by the
 * whiteboard (board.js) and the lesson player (app.js).
 *
 * It owns its own DOM: a teacher launcher + control panel, student poll popups,
 * a team "summit card" + team room (chat + quiz), and the final standings board
 * everyone sees. The host only has to:
 *
 *     const LA = window.LiveActivities.attach({
 *       host: 'board' | 'lesson',
 *       send: (obj) => ws.send(...),        // relay to /ws/board or /ws/lesson
 *       loadBanks: async () => [ ...banks ] // teacher only: prepared questions
 *     });
 *     LA.setRole('teacher' | 'student');    // when known / on every sync
 *     LA.setActive(isLive);                 // show/hide the teacher launcher
 *     // and forward every 'activity:*' message:
 *     if (m.type.startsWith('activity:')) LA.handle(m);
 *
 * Nothing here is persisted; a team exercise lives only for the session.
 */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

  function attach(config) {
    const send = typeof config.send === 'function' ? config.send : () => {};
    const loadBanks = typeof config.loadBanks === 'function' ? config.loadBanks : async () => [];
    const hostKind = config.host || 'lesson';

    // ---- Root + shared state ---------------------------------------------
    const root = el('div', 'la-root');
    root.setAttribute('data-host', hostKind);
    document.body.appendChild(root);

    const state = {
      role: 'student',
      active: false,
      banks: null,          // teacher: cached prepared questions (this topic)
      // Questions the teacher makes on the spot during this session. Kept only
      // in memory for the life of the session, surfaced as a "This session"
      // bank in both the Poll and Teams pickers.
      adhoc: { id: '__session__', title: 'This session', owned: true, creator: 'You', subject: '', topic: '', questions: [] },
      poll: null,           // { pollId, question, choices, answerIndex, explanation, counts, total, voted }
      teams: null,          // student: { exId, team, quiz, answers:{}, } ; teacher: { exId, title, teams, standings, quizLen, log:[] }
      launchedQuiz: null,   // teacher: the quiz array launched (kept for export)
      studentCount: 0       // teacher: live attendee count (drives guards)
    };

    // ---- Teacher launcher + panel ----------------------------------------
    const launcher = el('button', 'la-launcher', '<span class="la-launcher-ico">🎬</span> Activities');
    launcher.type = 'button';
    launcher.hidden = true;
    // Clicking the launcher toggles the panel — a second click closes it.
    launcher.addEventListener('click', () => { if (state.role !== 'teacher') return; if (panel.hidden) openPanel(); else closePanel(); });
    root.appendChild(launcher);

    const panel = el('div', 'la-panel');
    panel.hidden = true;
    root.appendChild(panel);

    // Escape closes the panel; clicking anywhere outside it (but not on the
    // launcher) closes it too. Both are ignored while a student overlay is up.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
    document.addEventListener('pointerdown', (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || launcher.contains(e.target)) return;
      closePanel();
    }, true);

    function updateLauncher() {
      const show = state.role === 'teacher' && state.active;
      launcher.hidden = !show;
      if (!show) { panel.hidden = true; }
    }

    function openPanel(tab) {
      if (state.role !== 'teacher') return; // students never get the panel
      panel.hidden = false;
      renderPanel(tab || panel.dataset.tab || 'poll');
    }
    function closePanel() { panel.hidden = true; }

    // The live attendee count gates what can start (a poll needs ≥1 student, a
    // team exercise needs ≥2). Re-render the open picker so its notice/buttons
    // reflect the change the moment someone joins or leaves.
    function setStudentCount(n) {
      const next = Math.max(0, Number(n) || 0);
      if (next === state.studentCount) return;
      state.studentCount = next;
      if (!panel.hidden && state.role === 'teacher' && !state.poll && !state.teams) renderPanel(panel.dataset.tab || 'poll');
    }

    async function ensureBanks() {
      if (state.banks) return state.banks;
      try { state.banks = await loadBanks(); } catch (_) { state.banks = []; }
      return state.banks;
    }

    // Prepared (topic-scoped) banks with the on-the-fly "This session" bank in
    // front when it has any questions, so ad-hoc questions are pickable too.
    function combinedBanks(prepared) {
      const list = Array.isArray(prepared) ? prepared.slice() : [];
      if (state.adhoc && state.adhoc.questions.length) list.unshift(state.adhoc);
      return list;
    }

    function renderPanel(tab) {
      panel.dataset.tab = tab;
      const n = state.studentCount;
      panel.innerHTML = `
        <div class="la-panel-head">
          <div class="la-tabs">
            <button class="la-tab${tab === 'poll' ? ' on' : ''}" data-tab="poll">Poll</button>
            <button class="la-tab${tab === 'teams' ? ' on' : ''}" data-tab="teams">Teams</button>
          </div>
          <span class="la-count" title="Students in this session">${n} student${n === 1 ? '' : 's'}</span>
          <button class="la-x" title="Close (Esc)" aria-label="Close">✕</button>
        </div>
        <div class="la-panel-body" id="laPanelBody"></div>`;
      panel.querySelector('.la-x').addEventListener('click', closePanel);
      panel.querySelectorAll('.la-tab').forEach((b) => b.addEventListener('click', () => renderPanel(b.dataset.tab)));
      if (tab === 'poll') renderPollTab();
      else renderTeamsTab();
    }

    // A compact, searchable bank picker that scales past a handful of lessons:
    // a text box filters a scrollable list (your own lessons first, then shared,
    // each labelled). Calls onPick(bank) when a lesson is chosen. Returns the
    // currently selected bank via getSelected().
    function bankPicker(container, banks, onPick) {
      let selected = banks[0] || null;
      let openList = false;
      function render() {
        container.innerHTML = `
          <div class="la-combo">
            <input class="la-combo-input" id="laBankInput" placeholder="Search your lessons…" autocomplete="off"
              value="${esc(selected ? selected.title : '')}" />
            <div class="la-combo-list" id="laBankList" ${openList ? '' : 'hidden'}></div>
          </div>`;
        const input = container.querySelector('#laBankInput');
        const list = container.querySelector('#laBankList');
        const paintList = (filter) => {
          const f = (filter || '').trim().toLowerCase();
          const matches = banks.filter((b) => !f || b.title.toLowerCase().includes(f) || (b.topic || '').toLowerCase().includes(f) || (b.subject || '').toLowerCase().includes(f));
          list.innerHTML = matches.length ? matches.map((b) => {
            const idx = banks.indexOf(b);
            return `<button class="la-combo-item${b === selected ? ' on' : ''}" data-i="${idx}">
              <span class="la-combo-title">${esc(b.title)}</span>
              <span class="la-combo-meta">${b.owned ? 'Your lesson' : 'Shared · ' + esc(b.creator)} · ${b.questions.length} Q</span>
            </button>`;
          }).join('') : '<div class="la-combo-empty">No lessons match.</div>';
          list.querySelectorAll('.la-combo-item').forEach((it) => it.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            selected = banks[Number(it.dataset.i)];
            openList = false;
            render();
            onPick(selected);
          }));
        };
        input.addEventListener('focus', () => { openList = true; list.hidden = false; paintList(''); });
        input.addEventListener('input', () => { openList = true; list.hidden = false; paintList(input.value); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openList = false; list.hidden = true; input.blur(); } });
        if (openList) paintList(input.value);
      }
      render();
      return { getSelected: () => selected };
    }

    // ----- Teacher: Poll tab ----------------------------------------------
    async function renderPollTab() {
      const body = panel.querySelector('#laPanelBody');
      // If a poll is running, show the live graph instead of the picker.
      if (state.poll && state.role === 'teacher') { renderTeacherPollLive(body); return; }
      body.innerHTML = '<div class="la-loading">Loading your prepared questions…</div>';
      const banks = combinedBanks(await ensureBanks());
      const noStudents = state.studentCount < 1;
      const hasBanks = banks.length > 0;
      body.innerHTML = `
        <p class="la-hint">Pick a prepared question for this topic, or make one on the spot. It pops up on every student's screen; as answers land, a live graph builds here and on their screens.</p>
        ${noStudents ? '<div class="la-notice">No students have joined yet. The poll will be ready to send as soon as someone arrives.</div>' : ''}
        ${hasBanks ? `
          <div class="la-field"><span>Lesson</span><div id="laPollBank"></div></div>
          <div id="laPollList" class="la-qlist${noStudents ? ' disabled' : ''}"></div>
          <label class="la-check"><input type="checkbox" id="laSurvey" /> Survey — no right answer (just gather opinions)</label>`
          : '<div class="la-empty">No quiz for this topic yet. Make a quick question below and it\'ll be ready to send.</div>'}
        <div class="la-newpoll">
          <button type="button" class="la-linkbtn" id="laNewPollToggle">＋ New question</button>
          <div id="laNewPollForm" hidden></div>
        </div>`;
      if (hasBanks) {
        const paint = (bank) => {
          body.querySelector('#laPollList').innerHTML = bank.questions.map((q, i) => `
            <button class="la-qpick" data-i="${i}"${noStudents ? ' disabled' : ''}>
              <span class="la-qpick-q">${esc(q.front)}</span>
              <span class="la-qpick-meta">${q.choices.length} choices${q.answerIndex >= 0 ? '' : ' · survey'}</span>
            </button>`).join('');
          body.querySelectorAll('.la-qpick').forEach((btn) => btn.addEventListener('click', () => {
            if (state.studentCount < 1) { flash('No students have joined yet.'); return; }
            const q = bank.questions[Number(btn.dataset.i)];
            const survey = body.querySelector('#laSurvey').checked;
            send({ type: 'activity:poll:launch', question: q.front, choices: q.choices, answerIndex: survey ? -1 : q.answerIndex, explanation: q.explanation });
          }));
        };
        const picker = bankPicker(body.querySelector('#laPollBank'), banks, paint);
        paint(picker.getSelected());
      }
      wireNewPollForm(body);
    }

    // ----- Teacher: make a poll question on the spot ----------------------
    // Lets the teacher add a 4-option question mid-session without leaving Go
    // Live. It's stored in the in-memory "This session" bank and immediately
    // pickable in both the Poll and Teams tabs.
    function wireNewPollForm(body) {
      const toggle = body.querySelector('#laNewPollToggle');
      const host = body.querySelector('#laNewPollForm');
      if (!toggle || !host) return;
      toggle.addEventListener('click', () => {
        if (host.hidden) { host.hidden = false; toggle.textContent = '✕ Cancel'; renderNewPollForm(host); }
        else { host.hidden = true; host.innerHTML = ''; toggle.textContent = '＋ New question'; }
      });
    }

    function renderNewPollForm(host) {
      host.innerHTML = `
        <div class="la-npform">
          <input class="la-np-q" id="laNpQ" placeholder="Type your question…" maxlength="600" />
          <div class="la-np-opts">
            ${[0, 1, 2, 3].map((i) => `
              <label class="la-np-opt">
                <input type="radio" name="laNpCorrect" value="${i}"${i === 0 ? ' checked' : ''} title="Mark as correct answer" />
                <input class="la-np-o" data-i="${i}" placeholder="Option ${i + 1}" maxlength="200" />
              </label>`).join('')}
          </div>
          <label class="la-check"><input type="checkbox" id="laNpSurvey" /> No right answer (survey)</label>
          <div class="la-panel-actions">
            <button type="button" class="btn primary" id="laNpAdd">Add to session</button>
          </div>
        </div>`;
      const survey = host.querySelector('#laNpSurvey');
      const radios = [...host.querySelectorAll('input[name="laNpCorrect"]')];
      survey.addEventListener('change', () => radios.forEach((r) => { r.disabled = survey.checked; }));
      host.querySelector('#laNpAdd').addEventListener('click', () => addAdhocQuestion(host));
    }

    function addAdhocQuestion(host) {
      const q = host.querySelector('#laNpQ').value.trim();
      const raw = [...host.querySelectorAll('.la-np-o')].map((n) => n.value.trim());
      const choices = raw.filter(Boolean);
      if (!q) { flash('Add a question first.'); return; }
      if (choices.length < 2) { flash('Add at least two options.'); return; }
      const survey = host.querySelector('#laNpSurvey').checked;
      let answerIndex = -1;
      if (!survey) {
        // The "correct" radio is over all four slots; map it onto the compacted
        // (non-empty) choices so the index stays valid after blanks are dropped.
        const checked = host.querySelector('input[name="laNpCorrect"]:checked');
        const rawIdx = checked ? Number(checked.value) : 0;
        let seen = -1; answerIndex = 0;
        for (let i = 0; i < raw.length; i += 1) {
          if (raw[i]) { seen += 1; if (i === rawIdx) { answerIndex = seen; break; } }
        }
      }
      state.adhoc.questions.push({ front: q, choices, answerIndex, explanation: '' });
      flash('Question added to this session.');
      renderPollTab();   // re-render: the "This session" bank now leads the picker
    }

    function renderTeacherPollLive(body) {
      const p = state.poll;
      const maxCount = Math.max(1, ...(p.counts || [0]));
      body.innerHTML = `
        <div class="la-live-q">${esc(p.question)}</div>
        <div class="la-poll-meta">${p.total || 0} of ${p.roster || 0} answered</div>
        <div class="la-bars">${p.choices.map((c, i) => {
          const n = (p.counts && p.counts[i]) || 0;
          const correct = p.answerIndex === i;
          return `<div class="la-bar-row${correct ? ' correct' : ''}">
            <div class="la-bar-label">${esc(c)}${correct ? ' <span class="la-tick">✓</span>' : ''}</div>
            <div class="la-bar-track"><div class="la-bar-fill" style="width:${(n / maxCount) * 100}%"></div></div>
            <div class="la-bar-num">${n} · ${pct(n, p.total)}%</div>
          </div>`;
        }).join('')}</div>
        <div class="la-panel-actions">
          <button class="btn primary" id="laPollClose">Close &amp; reveal to everyone</button>
        </div>`;
      const closeBtn = body.querySelector('#laPollClose');
      if (closeBtn) closeBtn.addEventListener('click', () => send({ type: 'activity:poll:close' }));
    }

    // ----- Teacher: Teams tab ---------------------------------------------
    async function renderTeamsTab() {
      const body = panel.querySelector('#laPanelBody');
      if (state.teams && state.role === 'teacher') { renderTeacherTeamsLive(body); return; }
      body.innerHTML = '<div class="la-loading">Loading your prepared questions…</div>';
      const banks = combinedBanks(await ensureBanks());
      if (!banks.length) {
        body.innerHTML = '<div class="la-empty">No quiz for this topic yet. Add one on the Poll tab with “New question”, or add a quiz to this lesson, then run it as a team exercise here.</div>';
        return;
      }
      const tooFew = state.studentCount < 2;
      let current = banks[0];
      body.innerHTML = `
        <p class="la-hint">Split the room into random teams named after mountain ranges, hand them a quiz, and watch the scores climb. Answers freeze the moment a teammate picks — the whole team sees right or wrong at once.</p>
        ${tooFew ? `<div class="la-notice">Teams need at least two students present. ${state.studentCount === 0 ? 'No one has joined yet.' : 'Only one student has joined so far.'}</div>` : ''}
        <div class="la-row">
          <label class="la-field"><span>Teams</span>
            <select id="laTeamCount">
              <option value="0">Auto</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option>
            </select></label>
          <div class="la-field grow"><span>Lesson</span><div id="laTeamBank"></div></div>
        </div>
        <div class="la-qtitle-row"><span>Questions</span><button class="la-linkbtn" id="laTeamAll">Toggle all</button></div>
        <div id="laTeamQs" class="la-qlist checks"></div>
        <div class="la-panel-actions">
          <button class="btn primary" id="laTeamStart"${tooFew ? ' disabled' : ''}>Make teams &amp; start</button>
        </div>`;
      const paint = (bank) => {
        current = bank;
        body.querySelector('#laTeamQs').innerHTML = bank.questions.map((q, i) => `
          <label class="la-qcheck"><input type="checkbox" data-i="${i}" checked />
            <span>${esc(q.front)}</span></label>`).join('');
      };
      const picker = bankPicker(body.querySelector('#laTeamBank'), banks, paint);
      paint(picker.getSelected());
      body.querySelector('#laTeamAll').addEventListener('click', () => {
        const boxes = body.querySelectorAll('#laTeamQs input');
        const anyOff = [...boxes].some((b) => !b.checked);
        boxes.forEach((b) => { b.checked = anyOff; });
      });
      body.querySelector('#laTeamStart').addEventListener('click', () => {
        if (state.studentCount < 2) { flash('Teams need at least two students present.'); return; }
        const bank = current;
        const picked = [...body.querySelectorAll('#laTeamQs input:checked')].map((b) => bank.questions[Number(b.dataset.i)]);
        if (!picked.length) { flash('Pick at least one question.'); return; }
        state.launchedQuiz = picked;
        send({ type: 'activity:teams:launch', teamCount: Number(body.querySelector('#laTeamCount').value) || 0, quiz: picked, title: bank.title });
      });
    }

    function renderTeacherTeamsLive(body) {
      const t = state.teams;
      const rows = (t.standings || []).slice().sort((a, b) => (b.score - a.score) || (a.finishedAt || '').localeCompare(b.finishedAt || ''));
      const maxScore = t.quizLen || 1;
      body.innerHTML = `
        <div class="la-live-q">${esc(t.title || 'Team quiz')} · ${t.quizLen} question${t.quizLen === 1 ? '' : 's'}</div>
        <div class="la-standings">${rows.map((s) => `
          <div class="la-stand-row${s.perfect ? ' perfect' : ''}">
            <span class="la-team-dot" style="background:${esc(s.color)}"></span>
            <span class="la-team-name">${esc(s.name)}</span>
            <div class="la-bar-track"><div class="la-bar-fill" style="width:${(s.score / maxScore) * 100}%;background:${esc(s.color)}"></div></div>
            <span class="la-team-score">${s.score}/${s.total}</span>
            <span class="la-team-prog">${s.answered}/${s.total} in</span>
          </div>`).join('')}</div>
        <details class="la-who"><summary>Who answered what</summary>
          <div class="la-wholog">${(t.log || []).slice().reverse().map((e) => `
            <div class="la-whorow"><span class="la-team-dot sm" style="background:${esc(e.color)}"></span>
              Q${e.qIndex + 1} · <strong>${esc(e.byName || e.byLabel)}</strong> ${e.correct ? '✅' : '❌'}</div>`).join('') || '<div class="la-muted">No answers yet.</div>'}</div>
        </details>
        <div class="la-panel-actions wrap">
          <button class="btn soft" id="laTeamReveal">Reveal results to all</button>
          <button class="btn soft" id="laTeamExport">Export scorecard (CSV)</button>
          <button class="btn ghost" id="laTeamClear">Clear exercise</button>
        </div>`;
      body.querySelector('#laTeamReveal').addEventListener('click', () => send({ type: 'activity:teams:reveal' }));
      body.querySelector('#laTeamExport').addEventListener('click', () => send({ type: 'activity:teams:scorecard' }));
      body.querySelector('#laTeamClear').addEventListener('click', () => {
        send({ type: 'activity:teams:clear' });
        state.teams = null; state.launchedQuiz = null; renderTeamsTab();
      });
    }

    function refreshTeacherLive() {
      if (panel.hidden || state.role !== 'teacher') return;
      const body = panel.querySelector('#laPanelBody');
      if (!body) return;
      if (panel.dataset.tab === 'poll' && state.poll) renderTeacherPollLive(body);
      if (panel.dataset.tab === 'teams' && state.teams) renderTeacherTeamsLive(body);
    }

    // ---- Student: poll popup ---------------------------------------------
    function showPollPopup(m) {
      state.poll = { pollId: m.pollId, question: m.question, choices: m.choices, voted: false };
      closeOverlay('poll');
      const ov = el('div', 'la-overlay', '');
      ov.dataset.kind = 'poll';
      ov.innerHTML = `
        <div class="la-card la-poll-card">
          <div class="la-card-eyebrow">Poll</div>
          <div class="la-card-q">${esc(m.question)}</div>
          <div class="la-choices">${m.choices.map((c, i) => `<button class="la-choice" data-i="${i}">${esc(c)}</button>`).join('')}</div>
          <div class="la-card-foot">Your pick is final — choose carefully.</div>
        </div>`;
      ov.querySelectorAll('.la-choice').forEach((btn) => btn.addEventListener('click', () => {
        if (state.poll.voted) return;
        state.poll.voted = true;
        ov.querySelectorAll('.la-choice').forEach((b) => { b.disabled = true; });
        btn.classList.add('picked');
        send({ type: 'activity:poll:vote', pollId: m.pollId, choice: Number(btn.dataset.i) });
      }));
      root.appendChild(ov);
    }

    function showPollResult(m) {
      // The voter's popup collapses into the live graph with their pick marked.
      if (state.poll) { state.poll.counts = m.counts; state.poll.total = m.total; state.poll.answerIndex = m.answerIndex; state.poll.explanation = m.explanation; state.poll.yourChoice = m.yourChoice; }
      paintStudentPollGraph({ ...m, question: state.poll ? state.poll.question : '', choices: state.poll ? state.poll.choices : [] });
    }

    function paintStudentPollGraph(m) {
      const ov = root.querySelector('.la-overlay[data-kind="poll"]') || (() => { const n = el('div', 'la-overlay'); n.dataset.kind = 'poll'; root.appendChild(n); return n; })();
      const choices = m.choices || (state.poll && state.poll.choices) || [];
      const counts = m.counts || [];
      const total = m.total || 0;
      const maxCount = Math.max(1, ...counts);
      const yours = state.poll ? state.poll.yourChoice : undefined;
      const right = m.answerIndex >= 0;
      ov.innerHTML = `
        <div class="la-card la-poll-card">
          <div class="la-card-eyebrow">Results</div>
          ${m.question ? `<div class="la-card-q sm">${esc(m.question)}</div>` : ''}
          <div class="la-bars">${choices.map((c, i) => {
            const n = counts[i] || 0;
            const isRight = m.answerIndex === i;
            const isYours = yours === i;
            return `<div class="la-bar-row${isRight ? ' correct' : ''}${isYours ? ' yours' : ''}">
              <div class="la-bar-label">${esc(c)}${isRight ? ' <span class="la-tick">✓</span>' : ''}${isYours ? ' <span class="la-you">you</span>' : ''}</div>
              <div class="la-bar-track"><div class="la-bar-fill" style="width:${(n / maxCount) * 100}%"></div></div>
              <div class="la-bar-num">${n} · ${pct(n, total)}%</div>
            </div>`;
          }).join('')}</div>
          ${right && m.explanation ? `<div class="la-explain">${esc(m.explanation)}</div>` : ''}
          <div class="la-card-foot">${right && yours != null ? (yours === m.answerIndex ? 'Nice — you got it.' : 'Not this time.') : 'Thanks for voting.'} <button class="la-dismiss">Dismiss</button></div>
        </div>`;
      const dz = ov.querySelector('.la-dismiss'); if (dz) dz.addEventListener('click', () => closeOverlay('poll'));
    }

    function closePollForAll(m) {
      // Non-voters get the final graph too; voters just see it finalise.
      if (!state.poll) state.poll = {};
      state.poll.counts = m.counts; state.poll.total = m.total; state.poll.answerIndex = m.answerIndex; state.poll.explanation = m.explanation;
      paintStudentPollGraph({ counts: m.counts, total: m.total, answerIndex: m.answerIndex, explanation: m.explanation, question: state.poll.question, choices: state.poll.choices });
    }

    // ---- Student: team assignment + team room ----------------------------
    function showTeamAssignment(m) {
      // Reconnect to the SAME exercise: keep any answers/chat and go straight
      // back to the room instead of popping the intro again.
      if (state.teams && state.teams.exId === m.exId) {
        state.teams.team = m.team; state.teams.quiz = m.quiz;
        openTeamRoom();
        return;
      }
      state.teams = { exId: m.exId, team: m.team, quiz: m.quiz, answers: {}, chat: [] };
      closeOverlay('team-intro');
      const ov = el('div', 'la-overlay');
      ov.dataset.kind = 'team-intro';
      ov.innerHTML = `
        <div class="la-card la-team-card" style="--team:${esc(m.team.color)}">
          <div class="la-summit"><span class="la-summit-peak">▲</span></div>
          <div class="la-card-eyebrow">Your team</div>
          <div class="la-team-title">${esc(m.team.name)}</div>
          <div class="la-mates">${m.team.mates.map((n) => `<span class="la-mate">${esc(n)}</span>`).join('')}</div>
          <div class="la-card-foot">${m.quiz.length} question${m.quiz.length === 1 ? '' : 's'} · any teammate can lock in an answer</div>
          <button class="btn primary" id="laTeamGo">Start</button>
        </div>`;
      ov.querySelector('#laTeamGo').addEventListener('click', () => { closeOverlay('team-intro'); openTeamRoom(); });
      root.appendChild(ov);
    }

    function openTeamRoom() {
      let dock = root.querySelector('.la-teamroom');
      if (!dock) { dock = el('div', 'la-teamroom'); root.appendChild(dock); }
      renderTeamRoom();
    }

    function renderTeamRoom() {
      const t = state.teams;
      const dock = root.querySelector('.la-teamroom');
      if (!t || !dock) return;
      const answeredCount = Object.keys(t.answers).length;
      const done = answeredCount >= t.quiz.length;
      dock.style.setProperty('--team', t.team.color);
      dock.innerHTML = `
        <div class="la-tr-head">
          <span class="la-team-dot" style="background:${esc(t.team.color)}"></span>
          <strong>${esc(t.team.name)}</strong>
          <span class="la-tr-prog">${answeredCount}/${t.quiz.length}</span>
          <button class="la-tr-min" title="Minimise">–</button>
        </div>
        <div class="la-tr-body">
          <div class="la-tr-quiz">${t.quiz.map((q, i) => renderTeamQuestion(q, i)).join('')}</div>
          ${done ? '<div class="la-tr-done">All answered — waiting for the other teams to finish.</div>' : ''}
          <div class="la-tr-chat">
            <div class="la-tr-mates">Team: ${t.team.mates.map((n) => esc(n)).join(', ')}</div>
            <div class="la-chat-log" id="laChatLog">${t.chat.map(chatLine).join('')}</div>
            <div class="la-chat-in"><input id="laChatMsg" maxlength="400" placeholder="Message your team…" /><button class="btn soft small" id="laChatSend">Send</button></div>
          </div>
        </div>`;
      dock.querySelector('.la-tr-min').addEventListener('click', () => dock.classList.toggle('min'));
      dock.querySelectorAll('.la-tq-choice').forEach((btn) => btn.addEventListener('click', () => {
        const qi = Number(btn.dataset.q); const ci = Number(btn.dataset.c);
        if (t.answers[qi]) return; // frozen
        send({ type: 'activity:teams:answer', exId: t.exId, qIndex: qi, choice: ci });
      }));
      const sendChat = () => {
        const inp = dock.querySelector('#laChatMsg'); const v = inp.value.trim();
        if (!v) return; send({ type: 'activity:teams:chat', exId: t.exId, text: v }); inp.value = '';
      };
      dock.querySelector('#laChatSend').addEventListener('click', sendChat);
      dock.querySelector('#laChatMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
      const log = dock.querySelector('#laChatLog'); if (log) log.scrollTop = log.scrollHeight;
    }

    function renderTeamQuestion(q, i) {
      const t = state.teams;
      const a = t.answers[i];
      const frozen = !!a;
      return `<div class="la-tq${frozen ? (a.correct ? ' right' : ' wrong') : ''}">
        <div class="la-tq-q"><span class="la-tq-n">${i + 1}</span>${esc(q.question)}</div>
        <div class="la-tq-choices">${q.choices.map((c, ci) => {
          const isChosen = frozen && a.choice === ci;
          const isCorrect = frozen && a.correctIndex === ci;
          return `<button class="la-tq-choice${isChosen ? ' chosen' : ''}${isCorrect ? ' correct' : ''}" data-q="${i}" data-c="${ci}"${frozen ? ' disabled' : ''}>${esc(c)}</button>`;
        }).join('')}</div>
        ${frozen ? `<div class="la-tq-verdict">${a.correct ? '✅ Correct' : '❌ Not quite'}${a.byLabel ? ` · locked by ${esc(a.byLabel)}` : ''}</div>` : ''}
        ${frozen && a.explanation ? `<div class="la-explain">${esc(a.explanation)}</div>` : ''}
      </div>`;
    }

    function chatLine(c) { return `<div class="la-chat-line"><strong>${esc(c.from)}:</strong> ${esc(c.text)}</div>`; }

    function applyTeamFrozen(m) {
      const t = state.teams;
      if (!t || t.exId !== m.exId) return;
      t.answers[m.qIndex] = { choice: m.choice, correct: m.correct, correctIndex: m.correctIndex, explanation: m.explanation, byLabel: m.byLabel };
      renderTeamRoom();
    }
    function applyTeamChat(m) {
      const t = state.teams;
      if (!t || t.exId !== m.exId) return;
      t.chat.push({ from: m.from, text: m.text });
      if (t.chat.length > 200) t.chat = t.chat.slice(-200);
      const log = root.querySelector('#laChatLog');
      if (log) { log.insertAdjacentHTML('beforeend', chatLine({ from: m.from, text: m.text })); log.scrollTop = log.scrollHeight; }
      else renderTeamRoom();
    }

    // ---- Everyone: final standings board ---------------------------------
    function showResults(m) {
      closeOverlay('results');
      const rows = (m.standings || []).slice().sort((a, b) => (b.score - a.score) || (a.finishedAt || '').localeCompare(b.finishedAt || ''));
      const winners = new Set(m.winners || []);
      const ov = el('div', 'la-overlay');
      ov.dataset.kind = 'results';
      ov.innerHTML = `
        <div class="la-card la-results-card">
          <div class="la-card-eyebrow">Final standings</div>
          <div class="la-card-q sm">${esc(m.title || 'Team quiz')}</div>
          <div class="la-podium">${rows.map((s, idx) => {
            const win = winners.has(s.teamId);
            const first = m.firstPerfect === s.teamId;
            return `<div class="la-podium-row${win ? ' win' : ''}">
              <span class="la-rank">${idx + 1}</span>
              <span class="la-team-dot" style="background:${esc(s.color)}"></span>
              <span class="la-team-name">${esc(s.name)}${win ? ' <span class="la-crown">👑</span>' : ''}${first ? ' <span class="la-firstperfect">first to a clean sweep</span>' : ''}</span>
              <span class="la-team-score">${s.score}/${s.total}</span>
            </div>`;
          }).join('')}</div>
          <div class="la-card-foot"><button class="la-dismiss">Close</button></div>
        </div>`;
      ov.querySelector('.la-dismiss').addEventListener('click', () => closeOverlay('results'));
      root.appendChild(ov);
      // Clear the student's team room now the exercise is over.
      if (state.role !== 'teacher') closeTeamRoom();
    }

    // ---- Teacher: scorecard export ---------------------------------------
    function exportScorecard(card) {
      const rows = [];
      rows.push(['Team quiz', card.title]);
      rows.push(['Generated', card.generatedAt]);
      rows.push([]);
      rows.push(['Standings']);
      rows.push(['Rank', 'Team', 'Members', 'Score', 'Out of', 'Perfect']);
      card.standings.slice().sort((a, b) => b.score - a.score).forEach((s, i) => {
        const team = card.teams.find((t) => t.name === s.name);
        rows.push([i + 1, s.name, team ? team.members.join('; ') : '', s.score, s.total, s.perfect ? 'yes' : '']);
      });
      rows.push([]);
      rows.push(['Answer key (share with the class)']);
      rows.push(['#', 'Question', 'Correct answer', 'Explanation']);
      card.questions.forEach((q) => rows.push([q.index + 1, q.question, q.answerText, q.explanation]));
      rows.push([]);
      rows.push(['Per-team responses']);
      rows.push(['Team', '#', 'Question', "Team's answer", 'Correct?', 'Entered by']);
      card.teams.forEach((t) => t.answers.forEach((a) => {
        const q = card.questions[a.qIndex] || {};
        rows.push([t.name, a.qIndex + 1, q.question || '', a.choiceText, a.correct ? 'yes' : 'no', a.enteredBy]);
      }));
      const csv = rows.map((r) => r.map((c) => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scorecard-${(card.title || 'team-quiz').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    // ---- Utilities --------------------------------------------------------
    function closeOverlay(kind) { const n = root.querySelector(`.la-overlay[data-kind="${kind}"]`); if (n) n.remove(); }
    function closeTeamRoom() { const n = root.querySelector('.la-teamroom'); if (n) n.remove(); state.teams = null; }
    function flash(text) {
      const n = el('div', 'la-toast', esc(text));
      root.appendChild(n);
      setTimeout(() => n.classList.add('show'), 10);
      setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 2600);
    }

    // ---- Inbound message router ------------------------------------------
    function handle(m) {
      if (!m || typeof m.type !== 'string') return;
      switch (m.type) {
        // Poll
        case 'activity:poll:show': if (state.role !== 'teacher') showPollPopup(m); break;
        case 'activity:poll:state': state.poll = { ...m, voted: false }; refreshTeacherLive(); if (panel.hidden) openPanel('poll'); break;
        case 'activity:poll:tally':
          if (state.role === 'teacher') { if (state.poll) { Object.assign(state.poll, { counts: m.counts, total: m.total, roster: m.roster != null ? m.roster : state.poll.roster }); } refreshTeacherLive(); }
          else paintStudentPollGraph({ counts: m.counts, total: m.total, answerIndex: state.poll ? state.poll.answerIndex : -1, question: state.poll ? state.poll.question : '', choices: state.poll ? state.poll.choices : [] });
          break;
        case 'activity:poll:result': showPollResult(m); break;
        case 'activity:poll:closed':
          if (state.role === 'teacher') { state.poll = null; if (!panel.hidden && panel.dataset.tab === 'poll') renderPollTab(); }
          else closePollForAll(m);
          break;
        // Teams
        case 'activity:teams:you': showTeamAssignment(m); break;
        case 'activity:teams:frozen': applyTeamFrozen(m); break;
        case 'activity:teams:reject': applyTeamFrozen({ exId: m.exId, qIndex: m.qIndex, choice: m.choice, correct: m.correct, correctIndex: -1, explanation: '', byLabel: '' }); break;
        case 'activity:teams:chat': applyTeamChat(m); break;
        case 'activity:teams:state':
          state.teams = { exId: m.exId, title: m.title, teams: m.teams, standings: m.standings, quizLen: m.quizLen, log: (state.teams && state.teams.log) || [] };
          refreshTeacherLive(); if (panel.hidden) openPanel('teams'); break;
        case 'activity:teams:progress':
          if (state.teams) {
            state.teams.standings = m.standings;
            state.teams.log = state.teams.log || [];
            const team = (state.teams.teams || []).find((t) => t.id === m.teamId);
            state.teams.log.push({ qIndex: m.qIndex, byName: m.byName, byLabel: m.byLabel, correct: m.correct, color: team ? team.color : '#888' });
          }
          refreshTeacherLive(); break;
        case 'activity:teams:results': showResults(m); break;
        case 'activity:teams:cleared': closeTeamRoom(); closeOverlay('results'); break;
        case 'activity:teams:scorecard': exportScorecard(m.card); break;
        // Errors
        case 'activity:error': flash(m.message || 'That activity could not start.'); break;
        default: break;
      }
    }

    function setRole(role) { state.role = role === 'teacher' ? 'teacher' : 'student'; updateLauncher(); }
    function setActive(on) { state.active = !!on; updateLauncher(); if (!on && state.role === 'teacher') { /* keep panel state */ } }
    function destroy() { try { root.remove(); } catch (_) {} }

    return { handle, setRole, setActive, setStudentCount, destroy, _state: state };
  }

  window.LiveActivities = { attach };
})();
