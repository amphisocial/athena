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
    const nb = $('#newWhiteboardBtn');
    if (nb) {
      const canCreate = Boolean(state.user.limits && state.user.limits.whiteboard);
      if (!canCreate) nb.style.display = 'none';
      else {
        nb.addEventListener('click', openNewBoard);
        $('#createBoardBtn')?.addEventListener('click', createBoard);
        $('#templateClose')?.addEventListener('click', () => $('#templateDialog').close());
        $('#newBoardName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBoard(); });
      }
    }
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
    loadScope();
  })();

  // ---- New whiteboard dialog (ported from the retired /boards page) ----
  let getSelectedTemplate = null;
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
    const mark = (id) => { selected = id; tiles.forEach((el) => el.classList.toggle('selected', el.dataset.id === id)); };
    mark('blank');
    tiles.forEach((el) => el.addEventListener('click', () => mark(el.dataset.id)));
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
})();
