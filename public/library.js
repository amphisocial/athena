/* library.js — the unified Library: the teacher's whiteboards and lessons in
 * one list, newest first, with type/subject/grade/topic filters and a
 * Yours / Shared / Bookmarked scope. */
(() => {
  const { $, $$, escapeHtml, setStatus, api, initCommon, state } = window.AppCommon;

  let allItems = [];          // current scope's items (unified shape)
  let lastItems = [];         // last filtered set (for pager re-render)
  let libPage = 0;
  let scope = 'mine';

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return ''; } };
  const gradeLabel = (g) => g ? (/^grade/i.test(String(g)) ? String(g) : `Grade ${g}`) : '';
  const subjBadge = (s) => s === 'math' ? '<span class="subj-badge math">Math</span>'
    : s === 'science' ? '<span class="subj-badge science">Science</span>' : '';
  const typeBadge = (t) => t === 'whiteboard'
    ? '<span class="type-badge board">Whiteboard</span>'
    : '<span class="type-badge lesson">Lesson</span>';
  const stars = (r) => {
    if (!r || !r.count) return '<span class="rating none">No ratings</span>';
    const avg = r.sum / r.count;
    return `<span class="rating" title="${avg.toFixed(1)} from ${r.count}">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))} <small>(${r.count})</small></span>`;
  };

  async function loadScope() {
    const list = $('#libraryList');
    list.innerHTML = '<p class="set-meta">Loading…</p>';
    try {
      if (scope === 'mine') {
        const data = await api('/api/library');
        allItems = data.items || [];
      } else if (scope === 'shared') {
        allItems = await loadShared();
      } else {
        // Bookmarked public lessons the teacher saved.
        try { const d = await api('/api/bookmarks'); allItems = d.items || []; }
        catch (_) { allItems = []; }
      }
    } catch (e) {
      list.innerHTML = `<p class="set-meta">${escapeHtml(e.message)}</p>`;
      return;
    }
    applyFilters();
  }

  async function loadShared() {
    const items = [];
    try {
      const sets = await api('/api/sets');
      (sets.shared || []).forEach((s) => items.push({
        type: 'lesson', id: s.id, title: s.title, subject: s.subject || s.category || '',
        grade: s.grade || '', topic: s.topic || '', public: Boolean(s.public), shared: true,
        rating: s.rating || { sum: 0, count: 0 }, format: s.format, cardCount: (s.cards || []).length,
        createdAt: s.createdAt, updatedAt: s.updatedAt || s.createdAt, openUrl: `/app?set=${s.id}`, readOnly: true,
        owner: s.ownerEmail || ''
      }));
    } catch (_) {}
    try {
      const boards = await api('/api/board/shared/mine');
      (boards.boards || boards || []).forEach((b) => items.push({
        type: 'whiteboard', id: b.boardId || b.id, title: b.title, subject: b.subject || '',
        grade: b.grade || '', topic: b.topic || '', public: Boolean(b.public), shared: true,
        rating: b.rating || { sum: 0, count: 0 }, createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
        openUrl: `/board/${b.boardId || b.id}`, readOnly: true, owner: b.teacherName || ''
      }));
    } catch (_) {}
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function applyFilters() {
    const q = ($('#filterSearch').value || '').trim().toLowerCase();
    const type = $('#filterType').value;
    const subject = $('#filterSubject').value;
    const grade = $('#filterGrade').value;
    const items = allItems.filter((it) => {
      if (type && it.type !== type) return false;
      if (subject && it.subject !== subject) return false;
      if (grade && String(it.grade) !== grade) return false;
      if (q && !(`${it.title} ${it.topic}`.toLowerCase().includes(q))) return false;
      return true;
    });
    lastItems = items;
    libPage = 0;
    render(items);
  }

  function render(items) {
    const list = $('#libraryList');
    if (!items.length) {
      const msg = scope === 'bookmarked'
        ? 'No bookmarks yet. Open <a href="/lessons">Public Lessons</a> and bookmark the ones you like.'
        : scope === 'shared' ? 'Nothing shared with you yet.'
        : 'Nothing here yet — use “New whiteboard” or “New lesson” above.';
      list.innerHTML = `<div class="list-empty">${msg}</div>`;
      return;
    }
    const PAGE = 25;
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    if (libPage >= pages) libPage = 0;
    const start = libPage * PAGE;
    const pageItems = items.slice(start, start + PAGE);
    list.innerHTML = '<div class="row-list">' + pageItems.map((it) => `
      <div class="list-row" data-id="${it.id}" data-type="${it.type}">
        <div class="lr-main">
          <div class="lr-titleline">
            ${typeBadge(it.type)} <a class="lr-title" href="${it.openUrl}">${escapeHtml(it.title)}</a> ${subjBadge(it.subject)}
            ${it.public ? '<span class="pub-pill public">Public</span>' : (it.readOnly ? '' : '<span class="pub-pill">Private</span>')} ${it.isLive ? '<span class="live-badge">● LIVE</span>' : ''}
          </div>
          <div class="lr-meta">${escapeHtml([gradeLabel(it.grade), it.topic, it.owner ? 'by ' + it.owner : '', 'updated ' + fmtDate(it.updatedAt)].filter(Boolean).join(' · '))}${it.rating && it.rating.count ? ' · ★' + (it.rating.sum / it.rating.count).toFixed(1) + ' (' + it.rating.count + ')' : ''}</div>
        </div>
        <div class="lr-actions">
          <a class="btn primary xs" href="${it.openUrl}">Enter</a>
          ${it.readOnly ? '' : `
            <a class="btn ghost xs" href="${it.type === 'whiteboard' ? `/board/${it.id}?share=1` : `/app?set=${it.id}`}">Share</a>
            <button class="btn ghost xs pub-toggle" data-id="${it.id}" data-type="${it.type}" data-public="${it.public}" title="${it.public ? 'Make private' : 'Make public'}">${it.public ? 'Unpublish' : 'Publish'}</button>
            <button class="btn ghost xs del-item" data-id="${it.id}" data-type="${it.type}" title="Delete">✕</button>`}
        </div>
      </div>`).join('') + '</div>' + pager(items.length, start, PAGE, libPage, pages);

    list.querySelectorAll('.pub-toggle').forEach((b) => b.addEventListener('click', () =>
      togglePublic(b.dataset.type, b.dataset.id, b.dataset.public === 'true')));
    list.querySelectorAll('.del-item').forEach((b) => b.addEventListener('click', () =>
      delItem(b.dataset.type, b.dataset.id)));
    list.querySelectorAll('.pager-btn').forEach((b) => b.addEventListener('click', () => { libPage = Number(b.dataset.p); render(lastItems); }));
  }

  function pager(total, start, size, page, pages) {
    if (pages <= 1) return '';
    const end = Math.min(total, start + size);
    return `<div class="pager">
      <span class="pager-info">${start + 1}–${end} of ${total}</span>
      <button class="pager-btn" data-p="${Math.max(0, page - 1)}" ${page === 0 ? 'disabled' : ''}>‹ Prev</button>
      <span class="pager-page">Page ${page + 1} / ${pages}</span>
      <button class="pager-btn" data-p="${Math.min(pages - 1, page + 1)}" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button>
    </div>`;
  }

  async function togglePublic(type, id, currentlyPublic) {
    try {
      if (type === 'whiteboard') {
        await api(`/api/board/${id}/save`, { method: 'POST', body: JSON.stringify({ public: !currentlyPublic }) });
      } else {
        await api(`/api/sets/${id}/meta`, { method: 'POST', body: JSON.stringify({ public: !currentlyPublic }) });
      }
      setStatus(currentlyPublic ? 'Now private.' : 'Now public — it will appear in Public Lessons.', 'success');
      loadScope();
    } catch (e) { setStatus(e.message, 'error'); }
  }

  async function delItem(type, id) {
    if (!confirm('Delete this? This cannot be undone.')) return;
    try {
      await api(type === 'whiteboard' ? `/api/board/${id}` : `/api/sets/${id}`, { method: 'DELETE' });
      setStatus('Deleted.', 'success');
      loadScope();
    } catch (e) { setStatus(e.message, 'error'); }
  }

  (async () => {
    await initCommon();
    if (!state.user) { window.location.href = '/?login=1'; return; }
    $('#scopeToggle').querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      scope = b.dataset.scope;
      $('#scopeToggle').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      loadScope();
    }));
    ['#filterSearch', '#filterType', '#filterSubject', '#filterGrade'].forEach((sel) => {
      const el = $(sel); if (el) el.addEventListener('input', applyFilters);
    });
    // New whiteboard: create dialog lives here now (the old /boards page is gone).
    // The dialog handlers are always wired (the topic catalog can open the
    // dialog too); only the top "+ New whiteboard" button is gated by access.
    const nb = $('#newWhiteboardBtn');
    const canCreateBoard = Boolean(state.user.limits && state.user.limits.whiteboard);
    if (nb) {
      if (!canCreateBoard) nb.style.display = 'none';
      else nb.addEventListener('click', openNewBoard);
    }
    $('#createBoardBtn')?.addEventListener('click', createBoard);
    $('#templateClose')?.addEventListener('click', () => $('#templateDialog').close());
    $('#newBoardName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBoard(); });
    // New lesson: collect metadata first (parity with New whiteboard), then
    // hand off to /app with those fields prefilled.
    const nl = $('#newLessonBtn');
    if (nl) {
      nl.addEventListener('click', () => { $('#lessonDialog').showModal(); setTimeout(() => $('#newLessonTopic')?.focus(), 50); });
      $('#lessonClose')?.addEventListener('click', () => $('#lessonDialog').close());
      $('#createLessonBtn')?.addEventListener('click', () => {
        const q = new URLSearchParams();
        const subj = $('#newLessonSubject')?.value || '';
        const grade = $('#newLessonGrade')?.value || '';
        const topic = ($('#newLessonTopic')?.value || '').trim();
        if (subj) q.set('subject', subj);
        if (grade) q.set('grade', grade);
        if (topic) q.set('topic', topic);
        if ($('#newLessonPublic')?.checked) q.set('public', '1');
        const qs = q.toString();
        window.location.href = qs ? `/app?${qs}` : '/app';
      });
      $('#newLessonTopic')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#createLessonBtn').click(); });
    }
    setupTabs();
    handleStartHandoff();   // /learning "Start …" deep-link opens the prefilled dialog
    loadScope();            // default tab: Your boards & lessons
  })();

  // ---- Page tabs: Your boards & lessons (default) | Curriculum ----
  let catalogInited = false;
  function switchTab(name) {
    const isCur = name === 'curriculum';
    const libP = $('#tab-library');
    const curP = $('#tab-curriculum');
    if (libP) libP.hidden = isCur;
    if (curP) curP.hidden = !isCur;
    $('#libTabs')?.querySelectorAll('.lib-tab').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (isCur && !catalogInited) { catalogInited = true; initCatalog(); }
  }
  function setupTabs() {
    $('#libTabs')?.querySelectorAll('.lib-tab').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));
    // Allow /library?tab=curriculum to open the catalog directly.
    const p = new URLSearchParams(location.search);
    if (p.get('tab') === 'curriculum') switchTab('curriculum');
  }

  // ---- New whiteboard dialog (ported from the retired /boards page) ----
  let getSelectedTemplate = null;
  let markTemplate = null;   // set by buildTemplatePicker; preselects a tile by id
  function buildTemplatePicker() {
    const groups = {};
    (window.BOARD_TEMPLATES || []).forEach((t) => { (groups[t.subject] ||= []).push(t); });
    const order = ['Math', 'Science', 'Freeform'];
    const html = order.filter((s) => groups[s]).map((subject) => `
      <div class="template-group"><h4>${escapeHtml(subject)}</h4>
        <div class="template-grid">
          ${groups[subject].map((t) => `
            <button class="template-tile${t.id === 'blank' ? ' blank' : ''}" data-id="${t.id}">
              <strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.blurb || '')}</span>
              ${t.standard ? `<em>${escapeHtml(t.standard)}</em>` : ''}
            </button>`).join('')}
        </div></div>`).join('');
    const box = $('#templateGroups'); if (box) box.innerHTML = html;
    let selected = 'blank';
    const tiles = box ? box.querySelectorAll('.template-tile') : [];
    const mark = (id) => {
      const has = Array.from(tiles).some((el) => el.dataset.id === id);
      selected = has ? id : 'blank';
      tiles.forEach((el) => el.classList.toggle('selected', el.dataset.id === selected));
    };
    mark('blank');
    tiles.forEach((el) => el.addEventListener('click', () => mark(el.dataset.id)));
    markTemplate = mark;
    return () => selected;
  }
  function openNewBoard() {
    if (!getSelectedTemplate) getSelectedTemplate = buildTemplatePicker();
    if ($('#newBoardName')) $('#newBoardName').value = '';
    $('#templateDialog').showModal();
    setTimeout(() => $('#newBoardName')?.focus(), 50);
  }
  async function createBoard() {
    const title = $('#newBoardName').value.trim();
    const template = getSelectedTemplate ? getSelectedTemplate() : 'blank';
    const subject = $('#newBoardSubject') ? $('#newBoardSubject').value : '';
    const grade = $('#newBoardGrade') ? $('#newBoardGrade').value.trim() : '';
    const topic = $('#newBoardTopic') ? $('#newBoardTopic').value.trim() : '';
    const isPublic = $('#newBoardPublic') ? $('#newBoardPublic').checked : false;
    $('#createBoardBtn').disabled = true;
    try {
      const data = await api('/api/board/mine/new', { method: 'POST',
        body: JSON.stringify({ title, template, subject, grade, topic, public: isPublic }) });
      window.location.href = `/board/${data.board.id}`;
    } catch (error) {
      setStatus(error.message, 'error');
      $('#createBoardBtn').disabled = false;
    }
  }

  // =====================================================================
  //  "Start from a topic" — the Massachusetts curriculum catalog.
  //  Each topic opens the existing New whiteboard / New lesson dialog with
  //  grade, subject and topic prefilled; the normal create flow then saves.
  // =====================================================================
  const SUBJECT_LABEL = { math: 'Math', science: 'Science' };
  const LC_GRADES = [5, 6, 7, 8, 9, 10];
  let lcOverview = null;
  let lcGrade = 5;
  let lcSubject = 'math';

  function lcRenderFilters() {
    const gc = $('#lcGradeChips');
    if (gc) {
      gc.innerHTML = LC_GRADES.map((g) => `<button class="lc-chip grade${g === lcGrade ? ' on' : ''}" data-grade="${g}">Grade ${g}</button>`).join('');
      gc.querySelectorAll('.lc-chip').forEach((b) => b.addEventListener('click', () => { lcGrade = Number(b.dataset.grade); lcRenderFilters(); lcLoadTopics(); }));
    }
    const sc = $('#lcSubjectChips');
    if (sc) {
      sc.innerHTML = ['math', 'science'].map((s) => `<button class="lc-chip subj ${s}${s === lcSubject ? ' on ' + s : ''}" data-subject="${s}">${SUBJECT_LABEL[s]}</button>`).join('');
      sc.querySelectorAll('.lc-chip').forEach((b) => b.addEventListener('click', () => { lcSubject = b.dataset.subject; lcRenderFilters(); lcLoadTopics(); }));
    }
  }

  function lcTopicRow(t) {
    const std = t.standard ? `<div class="lc-t-std">${escapeHtml(t.standard)}</div>` : '';
    const tmplBadge = t.template ? ' <span class="lc-badge">◆</span>' : '';
    return `<div class="lc-topic" data-id="${escapeHtml(t.id)}">
      <div class="lc-t-main">
        <div class="lc-t-title">${escapeHtml(t.title)}</div>
        ${std}
      </div>
      <div class="lc-t-actions">
        <button class="lc-btn wb" data-act="whiteboard" data-id="${escapeHtml(t.id)}" title="Start a whiteboard on this topic">Start whiteboard${tmplBadge}</button>
        <button class="lc-btn ls" data-act="lesson" data-id="${escapeHtml(t.id)}" title="Start a lesson on this topic">Start lesson</button>
      </div>
    </div>`;
  }

  let lcTopicIndex = {};   // id -> topic (with grade/subject attached)
  function lcRenderTopics(data) {
    lcTopicIndex = {};
    const box = $('#lcTopics');
    if (!box) return;
    if (!data.strands || !data.strands.length) { box.innerHTML = '<p class="lc-empty">No topics for that selection yet.</p>'; return; }
    box.innerHTML = data.strands.map((strand) => {
      const rows = strand.topics.map((t) => {
        lcTopicIndex[t.id] = { ...t, grade: data.grade, subject: data.subject };
        return lcTopicRow(t);
      }).join('');
      return `<div class="lc-strand">
        <div class="lc-strand-head"><h3>${escapeHtml(strand.strand)}</h3><span class="lc-strand-count">${strand.topics.length} topic${strand.topics.length === 1 ? '' : 's'}</span></div>
        <div class="lc-topic-grid">${rows}</div>
      </div>`;
    }).join('');
    box.querySelectorAll('.lc-btn').forEach((b) => b.addEventListener('click', () => {
      const topic = lcTopicIndex[b.dataset.id];
      if (!topic) return;
      if (b.dataset.act === 'whiteboard') startTopicWhiteboard(topic);
      else startTopicLesson(topic);
    }));
    const cnt = $('#lcCount');
    if (cnt) cnt.textContent = `${data.topicCount} topics · ${data.strands.length} strands`;
  }

  async function lcLoadTopics() {
    const box = $('#lcTopics');
    if (box) box.innerHTML = '<div class="lc-skel">' + Array.from({ length: 6 }).map(() => '<div class="sk"></div>').join('') + '</div>';
    try {
      const data = await api(`/api/learning/topics?grade=${lcGrade}&subject=${lcSubject}`);
      lcRenderTopics(data);
    } catch (e) {
      if (box) box.innerHTML = `<p class="lc-empty">${escapeHtml(e.message || 'Could not load topics.')}</p>`;
    }
  }

  function gradeToLabel(g) { return g ? String(g) : ''; }

  // Prefill + open the New whiteboard dialog for a topic.
  function startTopicWhiteboard(topic) {
    if (!getSelectedTemplate) getSelectedTemplate = buildTemplatePicker();
    if ($('#newBoardName')) $('#newBoardName').value = topic.title || '';
    if ($('#newBoardSubject')) $('#newBoardSubject').value = topic.subject || '';
    if ($('#newBoardGrade')) $('#newBoardGrade').value = gradeToLabel(topic.grade);
    if ($('#newBoardTopic')) $('#newBoardTopic').value = topic.title || '';
    if ($('#newBoardPublic')) $('#newBoardPublic').checked = false;
    if (markTemplate) markTemplate(topic.template || 'blank');
    $('#templateDialog').showModal();
    setTimeout(() => $('#newBoardName')?.focus(), 50);
  }

  // Prefill + open the New lesson dialog for a topic.
  function startTopicLesson(topic) {
    if ($('#newLessonSubject')) $('#newLessonSubject').value = topic.subject || '';
    if ($('#newLessonGrade')) $('#newLessonGrade').value = gradeToLabel(topic.grade);
    if ($('#newLessonTopic')) $('#newLessonTopic').value = topic.title || '';
    if ($('#newLessonPublic')) $('#newLessonPublic').checked = false;
    $('#lessonDialog').showModal();
    setTimeout(() => $('#createLessonBtn')?.focus(), 50);
  }

  // Honour a ?start= handoff from the public Learning page. Runs on boot,
  // independent of which tab is active — it just opens the prefilled dialog.
  function handleStartHandoff() {
    const p = new URLSearchParams(location.search);
    const startAct = p.get('start');
    if (startAct !== 'whiteboard' && startAct !== 'lesson') return;
    const qGrade = Number(p.get('grade'));
    const qSubject = (p.get('subject') || '').toLowerCase();
    // Seed the catalog's default grade/subject so opening the tab later matches.
    if (LC_GRADES.includes(qGrade)) lcGrade = qGrade;
    if (qSubject === 'math' || qSubject === 'science') lcSubject = qSubject;
    const topic = {
      id: p.get('id') || '',
      title: (p.get('topic') || '').trim(),
      subject: (qSubject === 'math' || qSubject === 'science') ? qSubject : '',
      grade: LC_GRADES.includes(qGrade) ? qGrade : '',
      template: p.get('template') || null
    };
    if (!topic.title) return;
    if (startAct === 'whiteboard') startTopicWhiteboard(topic);
    else startTopicLesson(topic);
    history.replaceState({}, '', '/library');   // clean the URL
  }

  // Initialise the Curriculum tab (lazy — only when first opened).
  async function initCatalog() {
    try {
      lcOverview = await api('/api/learning/overview');
      if (lcOverview && lcOverview.minGrade && !LC_GRADES.includes(lcGrade)) lcGrade = lcOverview.minGrade;
    } catch (_) { lcOverview = null; }
    lcRenderFilters();
    await lcLoadTopics();
  }
})();
