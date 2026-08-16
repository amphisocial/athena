/*
 * learning.js — public Learning (Massachusetts curriculum) browser.
 *
 * Flow:
 *   /learning                     -> pick a grade, then a subject
 *   /learning?grade=5&subject=science -> every MA grade-5 science topic, by strand
 *
 * Grade and subject live in the URL, so the page is deep-linkable and the
 * browser back button works. The sticky filter bar swaps grade/subject in
 * place (history.pushState + re-render) without a full navigation, so a teacher
 * can move grade-to-grade and subject-to-subject without going back home.
 */
(() => {
  const C = window.AppCommon;
  const { $, escapeHtml, api } = C;

  const SUBJECT_LABEL = { math: 'Math', science: 'Science' };
  const GRADES = [5, 6, 7, 8, 9, 10];

  // Templates the no-login sandbox can auto-seed onto a live board (see
  // sandbox.js). A catalog topic may reference a template that isn't seedable
  // here (e.g. globe) — those still open the sandbox on the right subject, but
  // we don't label them "live board" so the affordance stays honest.
  const SEEDABLE = new Set(['quadratic', 'linear', 'sine', 'solid', 'newton', 'incline', 'pendulum', 'projectile', 'reflection', 'molecule']);

  let overview = null;              // { grades:[...], subjects:[...] }
  let selectedGrade = null;         // number or null
  let selectedSubject = null;       // 'math' | 'science' | null
  let loggedIn = false;             // set at boot from AppCommon.state.user

  // ---- URL <-> state -------------------------------------------------------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const g = Number(p.get('grade'));
    const s = p.get('subject');
    selectedGrade = GRADES.includes(g) ? g : null;
    selectedSubject = (s === 'math' || s === 'science') ? s : null;
  }

  function pushUrl(replace) {
    const p = new URLSearchParams();
    if (selectedGrade) p.set('grade', String(selectedGrade));
    if (selectedSubject) p.set('subject', selectedSubject);
    const qs = p.toString();
    const url = qs ? `/learning?${qs}` : '/learning';
    if (replace) history.replaceState({}, '', url);
    else history.pushState({}, '', url);
  }

  // ---- Elements ------------------------------------------------------------
  const el = {
    filters: $('#lrnFilters'), gradeChips: $('#gradeChips'), subjectChips: $('#subjectChips'),
    count: $('#lrnCount'), select: $('#lrnSelect'), selectGrades: $('#selectGrades'),
    topics: $('#lrnTopics'), status: $('#lrnStatus'), title: $('#lrnTitle'), lede: $('#lrnLede'),
    crumbTail: $('#crumbTail'), crumbLearning: $('#crumbLearning'),
    selMathMeta: $('#selMathMeta'), selScienceMeta: $('#selScienceMeta'), lselHint: $('#lselHint')
  };

  const show = (node, on) => { if (node) node.hidden = !on; };

  // ---- Filter bar ----------------------------------------------------------
  function renderFilterBar() {
    // Grade chips
    el.gradeChips.innerHTML = GRADES.map((g) =>
      `<button class="lf-chip grade${g === selectedGrade ? ' on' : ''}" data-grade="${g}">Grade ${g}</button>`
    ).join('');
    el.gradeChips.querySelectorAll('.lf-chip').forEach((b) =>
      b.addEventListener('click', () => setGrade(Number(b.dataset.grade))));

    // Subject chips
    el.subjectChips.innerHTML = ['math', 'science'].map((s) =>
      `<button class="lf-chip subj ${s}${s === selectedSubject ? ' on ' + s : ''}" data-subject="${s}">${SUBJECT_LABEL[s]}</button>`
    ).join('');
    el.subjectChips.querySelectorAll('.lf-chip').forEach((b) =>
      b.addEventListener('click', () => setSubject(b.dataset.subject)));
  }

  function setGrade(g) {
    selectedGrade = g;
    pushUrl(false);
    route();
  }
  function setSubject(s) {
    selectedSubject = s;
    // If a grade is already chosen this jumps straight to topics.
    pushUrl(false);
    route();
  }

  // ---- Selection screen ----------------------------------------------------
  function renderSelect() {
    el.selectGrades.innerHTML = GRADES.map((g) =>
      `<button class="lsel-grade${g === selectedGrade ? ' on' : ''}" data-grade="${g}">
        <span class="g-num">${g}</span><span class="g-lbl">Grade</span>
      </button>`
    ).join('');
    el.selectGrades.querySelectorAll('.lsel-grade').forEach((b) =>
      b.addEventListener('click', () => setGrade(Number(b.dataset.grade))));

    // Subject meta counts (only meaningful once a grade is picked).
    const metaFor = (subject) => {
      if (!selectedGrade || !overview) return 'Pick a grade first';
      const row = overview.grades.find((x) => x.grade === selectedGrade);
      const sub = row && row.subjects.find((x) => x.subject === subject);
      if (!sub || !sub.topics) return 'Coming soon';
      return `${sub.topics} topics · ${sub.strands} strands`;
    };
    el.selMathMeta.textContent = metaFor('math');
    el.selScienceMeta.textContent = metaFor('science');

    el.select.querySelectorAll('.lsel-subject').forEach((btn) => {
      const subject = btn.dataset.subject;
      const enabled = Boolean(selectedGrade);
      btn.disabled = !enabled;
      btn.onclick = enabled ? () => setSubject(subject) : null;
      btn.classList.toggle('on', subject === selectedSubject);
    });

    el.lselHint.textContent = selectedGrade
      ? `Grade ${selectedGrade} selected — now choose Math or Science.`
      : 'Pick a grade above, then a subject.';
  }

  // ---- Topics --------------------------------------------------------------
  function sandboxHref(subject, template) {
    const params = new URLSearchParams({ subject });
    if (template && SEEDABLE.has(template)) params.set('template', template);
    return `/sandbox?${params.toString()}`;
  }

  // Where a topic action should go, depending on auth:
  //  - signed in  -> the Library, which opens the prefilled New form and saves.
  //  - signed out -> whiteboard opens the no-login sandbox (not saved);
  //                  lesson needs an account, so we prompt sign-up.
  function libraryStartHref(kind, t, subject, grade) {
    const p = new URLSearchParams({ start: kind, grade: String(grade), subject });
    if (t.title) p.set('topic', t.title);
    if (t.id) p.set('id', t.id);
    if (kind === 'whiteboard' && t.template) p.set('template', t.template);
    return `/library?${p.toString()}`;
  }

  function topicCard(t, subject, grade) {
    const hasTemplate = Boolean(t.template) && SEEDABLE.has(t.template);
    const std = t.standard ? `<span class="lt-std">${escapeHtml(t.standard)}</span>` : '';
    const blurb = t.blurb ? `<p class="lt-blurb">${escapeHtml(t.blurb)}</p>` : '';
    const badge = hasTemplate ? '<span class="lt-badge">Live board</span>' : '';
    const wbMark = t.template ? ' <span class="lt-arrow">◆</span>' : '';
    // Buttons carry data so a single delegated handler can route them.
    return `<article class="lrn-topic" data-title="${escapeHtml(t.title)}" data-id="${escapeHtml(t.id)}" data-template="${escapeHtml(t.template || '')}">
      ${badge}
      <h3>${escapeHtml(t.title)}</h3>
      ${blurb}
      ${std}
      <div class="lt-actions">
        <button class="lt-open wb" data-act="whiteboard">Start whiteboard${wbMark}</button>
        <button class="lt-open ls" data-act="lesson">Start lesson</button>
      </div>
    </article>`;
  }

  function onTopicAction(act, card, subject, grade) {
    const t = { id: card.dataset.id, title: card.dataset.title, template: card.dataset.template || null };
    if (loggedIn) {
      // Hand off to the Library; it opens the prefilled dialog and saves.
      window.location.href = libraryStartHref(act, t, subject, grade);
      return;
    }
    if (act === 'whiteboard') {
      // No-login sandbox board, preset to subject (+ seeded template if any).
      window.location.href = sandboxHref(subject, t.template);
    } else {
      // A saved lesson needs an account — invite sign-up (topic carries over
      // once they land in the Library).
      try { C.openAuth('signup'); } catch (_) { window.location.href = '/?login=0'; }
    }
  }

  function renderTopics(data) {
    const subject = data.subject;
    const grade = data.grade;
    const cls = subject === 'science' ? ' science' : '';
    el.topics.innerHTML = data.strands.map((strand) => `
      <div class="lrn-strand${cls}">
        <div class="lrn-strand-head">
          <h2>${escapeHtml(strand.strand)}</h2>
          <span class="strand-count">${strand.topics.length} topic${strand.topics.length === 1 ? '' : 's'}</span>
        </div>
        <div class="lrn-topic-grid">
          ${strand.topics.map((t) => topicCard(t, subject, grade)).join('')}
        </div>
      </div>`).join('');
    el.topics.querySelectorAll('.lt-open').forEach((btn) => btn.addEventListener('click', () => {
      const card = btn.closest('.lrn-topic');
      onTopicAction(btn.dataset.act, card, subject, grade);
    }));
  }

  function skeleton() {
    el.topics.innerHTML = '<div class="lrn-skel">' + Array.from({ length: 6 }).map(() => '<div class="sk"></div>').join('') + '</div>';
  }

  async function loadTopics() {
    skeleton();
    show(el.topics, true); show(el.select, false); show(el.status, false);
    try {
      const data = await api(`/api/learning/topics?grade=${selectedGrade}&subject=${selectedSubject}`);
      renderTopics(data);
      el.count.textContent = `${data.topicCount} topics · ${data.strands.length} strands`;
    } catch (e) {
      el.topics.innerHTML = '';
      show(el.status, true);
      el.status.className = 'lrn-status error';
      el.status.textContent = e.message || 'Could not load topics for that selection.';
    }
  }

  // ---- Router: decide which view to show -----------------------------------
  function route() {
    renderFilterBar();

    const bothChosen = selectedGrade && selectedSubject;

    // Header + breadcrumb reflect the current selection.
    if (bothChosen) {
      el.title.textContent = `Grade ${selectedGrade} ${SUBJECT_LABEL[selectedSubject]}`;
      el.lede.textContent = `Every Massachusetts grade-${selectedGrade} ${SUBJECT_LABEL[selectedSubject].toLowerCase()} topic, grouped by strand. Open any topic on a live whiteboard.`;
      el.crumbTail.innerHTML = ` <span class="crumb-sep">/</span> <span class="crumb-cur">Grade ${selectedGrade} ${escapeHtml(SUBJECT_LABEL[selectedSubject])}</span>`;
      el.count.textContent = '';
      show(el.filters, true);
      loadTopics();
    } else {
      el.title.textContent = 'Pick a grade and subject';
      el.lede.innerHTML = 'Every Massachusetts Math &amp; Science topic, grades 5&ndash;10, organized by strand. Choose a grade and a subject to begin &mdash; then jump between them anytime from the bar up top.';
      el.crumbTail.innerHTML = '';
      // The filter bar is useful even here once a grade is picked, but keep the
      // full selection cards as the primary affordance until both are chosen.
      show(el.filters, Boolean(selectedGrade));
      show(el.topics, false);
      show(el.status, false);
      show(el.select, true);
      renderSelect();
    }
  }

  // Back/forward navigation.
  window.addEventListener('popstate', () => { readUrl(); route(); });

  (async () => {
    try { await C.initCommon(); } catch (_) {}
    loggedIn = Boolean(C.state && C.state.user);
    // Mirror the homepage: signed-in users see "My library" instead of Sign in.
    const nav = $('#navPlans');
    if (nav) {
      if (loggedIn) { nav.textContent = 'My library'; nav.setAttribute('href', '/library'); }
      else { nav.addEventListener('click', (e) => { e.preventDefault(); try { C.openAuth('login'); } catch (_) { location.href = '/?login=1'; } }); }
    }

    readUrl();
    try {
      overview = await api('/api/learning/overview');
    } catch (_) {
      overview = { grades: GRADES.map((g) => ({ grade: g, subjects: [{ subject: 'math', topics: 0, strands: 0 }, { subject: 'science', topics: 0, strands: 0 }] })) };
    }
    // Normalise the URL (drops junk params) without adding a history entry.
    pushUrl(true);
    route();
  })();
})();
