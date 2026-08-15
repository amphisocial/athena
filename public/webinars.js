(() => {
  const { $, escapeHtml, api, refreshMe, state, setStatus } = window.AppCommon;

  let options = { lessons: [], boards: [] };

  function fmtWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function statusPill(w) {
    if (w.status === 'live' || w.contentLive) return '<span class="web-pill live">● LIVE</span>';
    if (new Date(w.scheduledAt) < new Date()) return '<span class="web-pill due">Ready to start</span>';
    return '<span class="web-pill">Scheduled</span>';
  }

  function row(w) {
    const kindLabel = w.kind === 'whiteboard' ? '🖊 Whiteboard' : '📚 Lesson';
    const missing = w.exists ? '' : ' <span class="web-missing">(content deleted)</span>';
    const joinAbs = `${location.origin}${w.joinUrl}`;
    return `<div class="webinar-row" data-id="${w.id}">
      <div class="web-main">
        <div class="web-title">${escapeHtml(w.title)}${missing}</div>
        <div class="web-meta">${kindLabel} · ${escapeHtml(fmtWhen(w.scheduledAt))} ${statusPill(w)}</div>
        ${(w.status === 'live' || w.contentLive) ? `<div class="web-join">Join link: <a href="${w.joinUrl}" target="_blank" rel="noopener">${escapeHtml(joinAbs)}</a> <button class="btn ghost xs web-copy" data-url="${escapeHtml(joinAbs)}">Copy</button></div>` : ''}
      </div>
      <div class="web-actions">
        <button class="btn primary small web-start" ${w.exists ? '' : 'disabled'}>${(w.status === 'live' || w.contentLive) ? 'Open / resume' : '▶ Start'}</button>
        <button class="btn ghost small web-del">Delete</button>
      </div>
    </div>`;
  }

  async function load() {
    try {
      const data = await api('/api/webinars');
      const list = data.webinars || [];
      const wrap = $('#webinarList');
      if (!list.length) { wrap.innerHTML = '<p class="info-empty">No webinars yet. Schedule one to run a lesson or whiteboard live for your students.</p>'; return; }
      wrap.innerHTML = list.map(row).join('');
      wrap.querySelectorAll('.webinar-row').forEach((el) => {
        const id = el.dataset.id;
        el.querySelector('.web-start')?.addEventListener('click', () => start(id, el));
        el.querySelector('.web-del')?.addEventListener('click', () => del(id));
        el.querySelector('.web-copy')?.addEventListener('click', (e) => {
          navigator.clipboard.writeText(e.target.dataset.url).then(() => setStatus('Join link copied.', 'success')).catch(() => {});
        });
      });
    } catch (e) {
      $('#webinarList').innerHTML = `<p class="info-empty">${escapeHtml(e.message || 'Could not load webinars.')}</p>`;
    }
  }

  async function start(id, el) {
    const btn = el.querySelector('.web-start');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
    try {
      const d = await api(`/api/webinars/${id}/start`, { method: 'POST', body: JSON.stringify({}) });
      // Open the teacher's run view; the join link now shows on the row for sharing.
      window.open(d.runUrl, '_blank', 'noopener');
      await load();
      setStatus('Live session started. Share the join link with your students.', 'success');
    } catch (e) {
      setStatus(e.message || 'Could not start the session.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '▶ Start'; }
    }
  }

  async function del(id) {
    try { await api(`/api/webinars/${id}`, { method: 'DELETE' }); await load(); }
    catch (e) { setStatus(e.message || 'Could not delete.', 'error'); }
  }

  function fillContent() {
    const kind = $('#webKind').value;
    const list = kind === 'whiteboard' ? options.boards : options.lessons;
    $('#webContent').innerHTML = '<option value="">—</option>' +
      list.map((o) => `<option value="${o.id}">${escapeHtml(o.title)}</option>`).join('');
  }

  async function openDialog() {
    try {
      options = await api('/api/webinars/options');
    } catch (_) { options = { lessons: [], boards: [] }; }
    fillContent();
    // Default the date/time to the next round hour.
    const d = new Date(Date.now() + 60 * 60 * 1000);
    $('#webDate').value = d.toISOString().slice(0, 10);
    $('#webTime').value = d.toTimeString().slice(0, 5);
    $('#webErr').style.display = 'none';
    $('#webinarDialog').showModal();
  }

  async function create() {
    const kind = $('#webKind').value;
    const refId = $('#webContent').value;
    const title = $('#webTitle').value.trim();
    const date = $('#webDate').value;
    const time = $('#webTime').value;
    const err = $('#webErr');
    if (!refId) { err.textContent = 'Pick a lesson or whiteboard.'; err.style.display = ''; return; }
    if (!date || !time) { err.textContent = 'Pick a date and time.'; err.style.display = ''; return; }
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    const btn = $('#webCreate');
    btn.disabled = true; btn.textContent = 'Scheduling…';
    try {
      await api('/api/webinars', { method: 'POST', body: JSON.stringify({ kind, refId, title, scheduledAt }) });
      $('#webinarDialog').close();
      await load();
    } catch (e) {
      err.textContent = e.message || 'Could not schedule.'; err.style.display = '';
    } finally {
      btn.disabled = false; btn.textContent = 'Schedule';
    }
  }

  (async () => {
    await refreshMe();
    if (!state.user) { window.location.href = '/?login=1'; return; }
    // Webinars need the live plan; the API enforces it too, but nudge here.
    if (!(state.user.limits && state.user.limits.whiteboardLive)) {
      $('#webinarList').innerHTML = '<p class="info-empty">Webinars are a Teams feature. <a href="/pricing">Start a free Teams trial</a> to schedule live sessions.</p>';
      $('#scheduleBtn').disabled = true;
      return;
    }
    $('#scheduleBtn').addEventListener('click', openDialog);
    $('#webinarClose').addEventListener('click', () => $('#webinarDialog').close());
    $('#webKind').addEventListener('change', fillContent);
    $('#webCreate').addEventListener('click', create);
    await load();
  })();
})();
