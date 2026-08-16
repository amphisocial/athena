/* lessons.js — public Lessons directory. Anyone can browse, open, and rate.
 * Logged-in teachers can also bookmark. No login required to view. */
(() => {
  const C = window.AppCommon;
  const { $, escapeHtml, api } = C;

  let items = [];
  let user = null;
  let bookmarks = new Set();
  let plPage = 0;

  const subjBadge = (s) => s === 'math' ? '<span class="subj-badge math">Math</span>'
    : s === 'science' ? '<span class="subj-badge science">Science</span>' : '';
  const typeBadge = (t) => t === 'whiteboard'
    ? '<span class="type-badge board">Whiteboard</span>' : '<span class="type-badge lesson">Lesson</span>';
  const gradeLabel = (g) => g ? (/^grade/i.test(String(g)) ? String(g) : `Grade ${g}`) : '';
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch (_) { return ''; } };

  function starWidget(it) {
    const avg = it.rating && it.rating.count ? it.rating.avg : 0;
    const count = it.rating ? it.rating.count : 0;
    let html = '<span class="pl-stars" data-type="' + it.type + '" data-id="' + it.id + '">';
    for (let n = 1; n <= 5; n += 1) {
      html += `<button class="pl-star${n <= Math.round(avg) ? ' on' : ''}" data-stars="${n}" title="Rate ${n}">★</button>`;
    }
    html += `<span class="pl-rating-count">${count ? avg.toFixed(1) + ' (' + count + ')' : 'Rate it'}</span></span>`;
    return html;
  }

  function bookmarkBtn(it) {
    if (!user) return '';
    const on = bookmarks.has(it.type + ':' + it.id);
    return `<button class="btn ghost small pl-bm" data-type="${it.type}" data-id="${it.id}">${on ? '★ Bookmarked' : '☆ Bookmark'}</button>`;
  }
  function bookmarkBtnXs(it) {
    if (!user) return '';
    const on = bookmarks.has(it.type + ':' + it.id);
    return `<button class="btn ghost xs pl-bm" data-type="${it.type}" data-id="${it.id}" title="${on ? 'Bookmarked' : 'Bookmark'}">${on ? '★' : '☆'}</button>`;
  }

  function render() {
    const q = ($('#plSearch').value || '').trim().toLowerCase();
    const type = $('#plType').value, subject = $('#plSubject').value, grade = $('#plGrade').value;
    const list = items.filter((it) => {
      if (type && it.type !== type) return false;
      if (subject && it.subject !== subject) return false;
      if (grade && String(it.grade) !== grade) return false;
      if (q && !(`${it.title} ${it.topic}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const grid = $('#plGrid');
    if (!list.length) { grid.innerHTML = '<div class="list-empty">No public lessons match — try clearing filters.</div>'; return; }
    const PAGE = 25;
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (plPage >= pages) plPage = 0;
    const start = plPage * PAGE;
    const pageItems = list.slice(start, start + PAGE);
    grid.innerHTML = '<div class="row-list">' + pageItems.map((it) => `
      <div class="list-row">
        <div class="lr-main">
          <div class="lr-titleline">
            ${typeBadge(it.type)} <a class="lr-title" href="${it.openUrl}">${escapeHtml(it.title)}</a> ${subjBadge(it.subject)} ${it.isLive ? '<span class="live-badge">● LIVE</span>' : ''}
          </div>
          <div class="lr-meta">${escapeHtml([gradeLabel(it.grade), it.topic, 'by ' + (it.creator || 'a teacher'), fmtDate(it.updatedAt)].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="lr-rate">${starWidget(it)}</div>
        <div class="lr-actions">
          <a class="btn primary xs" href="${it.openUrl}">Open</a>
          ${bookmarkBtnXs(it)}
        </div>
      </div>`).join('') + '</div>' + pager(list.length, start, PAGE, plPage, pages);

    grid.querySelectorAll('.pl-star').forEach((b) => b.addEventListener('click', () => rate(b)));
    grid.querySelectorAll('.pl-bm').forEach((b) => b.addEventListener('click', () => toggleBookmark(b)));
    grid.querySelectorAll('.pager-btn').forEach((b) => b.addEventListener('click', () => { plPage = Number(b.dataset.p); render(); }));
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

  async function rate(btn) {
    const wrap = btn.closest('.pl-stars');
    const stars = Number(btn.dataset.stars);
    try {
      const d = await api('/api/public/rate', { method: 'POST', body: JSON.stringify({ type: wrap.dataset.type, id: wrap.dataset.id, stars }) });
      const it = items.find((x) => x.type === wrap.dataset.type && x.id === wrap.dataset.id);
      if (it && d.rating) it.rating = d.rating;
      render();
    } catch (_) { /* rating is best-effort */ }
  }

  async function toggleBookmark(btn) {
    try {
      const d = await api('/api/bookmarks/toggle', { method: 'POST', body: JSON.stringify({ type: btn.dataset.type, id: btn.dataset.id }) });
      const key = btn.dataset.type + ':' + btn.dataset.id;
      if (d.bookmarked) bookmarks.add(key); else bookmarks.delete(key);
      render();
    } catch (_) {}
  }

  (async () => {
    try { await C.initCommon(); } catch (_) {}
    user = C.state && C.state.user;
    // Top-right reflects auth: signed-in teachers get "My library", everyone
    // else gets "Sign in" (which opens the auth modal in place).
    const nav = $('#navPlans');
    if (nav) {
      if (user) { nav.textContent = 'My library'; nav.setAttribute('href', '/library'); }
      else { nav.addEventListener('click', (e) => { e.preventDefault(); C.openAuth('login'); }); }
    }
    if (user) {
      try { const bm = await api('/api/bookmarks'); (bm.items || []).forEach((i) => bookmarks.add(i.type + ':' + i.id)); } catch (_) {}
    }
    try {
      const data = await api('/api/public/lessons');
      items = data.items || [];
    } catch (e) { $('#plGrid').innerHTML = `<p class="pl-empty">${escapeHtml(e.message)}</p>`; return; }
    if (!items.length) { $('#plGrid').innerHTML = '<p class="pl-empty">No public lessons yet. Teachers can mark a board or lesson Public from their Library.</p>'; return; }
    ['#plSearch', '#plType', '#plSubject', '#plGrade'].forEach((s) => { const el = $(s); if (el) el.addEventListener('input', () => { plPage = 0; render(); }); });
    render();
  })();
})();
