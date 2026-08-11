/* library.js — the unified Library: the teacher's whiteboards and lessons in
 * one list, newest first, with type/subject/grade/topic filters and a
 * Yours / Shared / Bookmarked scope. */
(() => {
  const { $, $$, escapeHtml, setStatus, api, initCommon, state } = window.AppCommon;

  let allItems = [];          // current scope's items (unified shape)
  let scope = 'mine';

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return ''; } };
  const gradeLabel = (g) => g ? `Grade ${g}` : '';
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
    render(items);
  }

  function render(items) {
    const list = $('#libraryList');
    if (!items.length) {
      const msg = scope === 'bookmarked'
        ? 'No bookmarks yet. Open <a href="/lessons">Public Lessons</a> and bookmark the ones you like.'
        : scope === 'shared' ? 'Nothing shared with you yet.'
        : 'Nothing here yet — use “New whiteboard” or “New lesson” above.';
      list.innerHTML = `<p class="set-meta">${msg}</p>`;
      return;
    }
    list.innerHTML = items.map((it) => `
      <div class="set-item lib-item" data-id="${it.id}" data-type="${it.type}">
        <div class="lib-main">
          <span class="set-title">${typeBadge(it.type)} ${escapeHtml(it.title)} ${subjBadge(it.subject)}
            ${it.public ? '<span class="pub-pill public">Public</span>' : (it.readOnly ? '' : '<span class="pub-pill">Private</span>')}</span>
          <span class="set-meta">${escapeHtml([gradeLabel(it.grade), it.topic].filter(Boolean).join(' • ')) || 'No topic set'}
            ${it.owner ? '• by ' + escapeHtml(it.owner) : ''}
            • created ${fmtDate(it.createdAt)} • updated ${fmtDate(it.updatedAt)} • ${stars(it.rating)}</span>
        </div>
        <div class="set-actions">
          <a class="btn primary" href="${it.openUrl}">Enter</a>
          ${it.readOnly ? '' : `
            <a class="btn soft" href="${it.type === 'whiteboard' ? `/board/${it.id}?share=1` : `/app?set=${it.id}`}">Share</a>
            <button class="btn soft pub-toggle" data-id="${it.id}" data-type="${it.type}" data-public="${it.public}">${it.public ? 'Make private' : 'Make public'}</button>
            <button class="btn ghost del-item" data-id="${it.id}" data-type="${it.type}">Delete</button>`}
        </div>
      </div>`).join('');

    list.querySelectorAll('.pub-toggle').forEach((b) => b.addEventListener('click', () =>
      togglePublic(b.dataset.type, b.dataset.id, b.dataset.public === 'true')));
    list.querySelectorAll('.del-item').forEach((b) => b.addEventListener('click', () =>
      delItem(b.dataset.type, b.dataset.id)));
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
    loadScope();
  })();
})();
