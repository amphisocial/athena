/*
 * AI Agent page: a teacher picks grade + subject, then one topic or all
 * topics, answers a few questions (formats, counts, difficulty, notes), and
 * the server runs a background job that fills each topic's slides / flashcards
 * / quiz from its stored curriculum content. Progress is polled here; the
 * teacher is emailed when the run finishes.
 */
(() => {
  const { $, $$, escapeHtml, setStatus, api, initCommon } = window.AppCommon;

  const state = {
    grade: '',
    subject: '',
    topics: [],        // flat [{id,title,standard,strand,has}]
    pollTimer: null
  };

  const FMT_LABEL = { slides: 'Slides', flashcard: 'Flashcards', quiz: 'Quiz' };

  // ---- Step 1: grade & subject ------------------------------------------
  async function loadOverview() {
    try {
      const data = await api('/api/learning/overview');
      const sel = $('#gradeSelect');
      sel.innerHTML = '<option value="">Select a grade…</option>' + data.grades
        .map((g) => {
          const total = (g.subjects || []).reduce((n, s) => n + (s.topics || 0), 0);
          return `<option value="${g.grade}">Grade ${g.grade}${total ? ` — ${total} topics` : ''}</option>`;
        }).join('');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  function refreshStep1Ready() {
    $('#loadTopicsBtn').disabled = !(state.grade && state.subject);
  }

  // ---- Step 2: topics ----------------------------------------------------
  async function loadTopics() {
    if (!state.grade || !state.subject) return;
    const btn = $('#loadTopicsBtn');
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const data = await api(`/api/agent/topics?grade=${encodeURIComponent(state.grade)}&subject=${encodeURIComponent(state.subject)}`);
      state.topics = [];
      const html = (data.strands || []).map((strand) => {
        const rows = strand.topics.map((t) => {
          state.topics.push({ ...t, strand: strand.strand });
          const chips = ['slides', 'flashcard', 'quiz']
            .map((f) => `<span class="chip ${t.has && t.has[f] ? 'chip-has' : ''}">${FMT_LABEL[f]}</span>`).join('');
          return `<label class="topic-row">
            <input type="checkbox" class="topicBox" value="${escapeHtml(t.id)}" />
            <span class="topic-main">
              <span class="t-title">${escapeHtml(t.title)}</span>
              ${t.standard ? `<span class="t-std"> · ${escapeHtml(t.standard)}</span>` : ''}
              <span class="topic-chips">${chips}</span>
            </span>
          </label>`;
        }).join('');
        return `<div class="strand-block"><h3>${escapeHtml(strand.strand)}</h3>${rows}</div>`;
      }).join('');
      $('#topicsList').innerHTML = html || '<p class="muted">No topics found for that grade and subject.</p>';
      $('#topicCountLabel').textContent = state.topics.length ? `(${state.topics.length} topics)` : '';
      $('#selectAllTopics').checked = false;

      $$('.topicBox').forEach((box) => box.addEventListener('change', onTopicSelectionChange));
      unlock('#step2'); unlock('#step3');
      refreshRunHint();
      $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Load topics →';
    }
  }

  function onTopicSelectionChange() {
    const boxes = $$('.topicBox');
    const checked = boxes.filter((b) => b.checked).length;
    $('#selectAllTopics').checked = checked > 0 && checked === boxes.length;
    refreshRunHint();
  }

  function selectedTopicIds() {
    return $$('.topicBox').filter((b) => b.checked).map((b) => b.value);
  }

  // ---- Step 3: run -------------------------------------------------------
  function selectedFormats() {
    return $$('.fmtBox').filter((b) => b.checked).map((b) => b.value);
  }

  function refreshRunHint() {
    const topics = selectedTopicIds().length;
    const formats = selectedFormats().length;
    const hint = $('#runHint');
    if (!topics || !formats) { hint.textContent = 'Select at least one topic and one format.'; return; }
    hint.textContent = `Up to ${topics * formats} study set${topics * formats === 1 ? '' : 's'} will be built (${topics} topic${topics === 1 ? '' : 's'} × ${formats} format${formats === 1 ? '' : 's'}).`;
  }

  function syncCountVisibility() {
    const chosen = new Set(selectedFormats());
    $$('[data-count-for]').forEach((el) => {
      el.style.display = chosen.has(el.dataset.countFor) ? '' : 'none';
    });
    refreshRunHint();
  }

  async function run() {
    const topicIds = selectedTopicIds();
    const formats = selectedFormats();
    if (!topicIds.length) return setStatus('Pick at least one topic (or select all).', 'error');
    if (!formats.length) return setStatus('Pick at least one of Slides, Flashcards, or Quiz.', 'error');

    const allChecked = $('#selectAllTopics').checked && topicIds.length === state.topics.length;
    const payload = {
      grade: Number(state.grade),
      subject: state.subject,
      topicIds: allChecked ? 'all' : topicIds,
      formats,
      slideCount: Number($('#slideCount').value || 8),
      cardCount: Number($('#cardCount').value || 12),
      quizCount: Number($('#quizCount').value || 10),
      difficulty: $('#difficulty').value,
      notes: $('#notes').value.trim(),
      overwrite: $('#overwrite').checked
    };

    const btn = $('#runBtn');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const data = await api('/api/agent/run', { method: 'POST', body: JSON.stringify(payload) });
      setStatus('', '');
      startProgress(data.jobId, data.total, data.skipped || 0);
    } catch (e) {
      setStatus(e.message, 'error');
      btn.disabled = false; btn.textContent = '✨ Build my content';
    }
  }

  // ---- Progress ----------------------------------------------------------
  function startProgress(jobId, total, skipped) {
    lock('#step1'); lock('#step2'); lock('#step3');
    const panel = $('#progressPanel');
    panel.style.display = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#progressBar').style.width = '0%';
    $('#progressMeta').textContent = `0 of ${total} done${skipped ? ` · ${skipped} skipped (already had content)` : ''}`;
    $('#progressItems').innerHTML = '';
    poll(jobId);
    state.pollTimer = setInterval(() => poll(jobId), 2500);
  }

  async function poll(jobId) {
    try {
      const { job } = await api(`/api/agent/job/${jobId}`);
      const done = job.completed + job.failed;
      const pct = job.total ? Math.round((done / job.total) * 100) : 100;
      $('#progressBar').style.width = `${pct}%`;
      const cur = job.currentLabel ? ` · now: ${escapeHtml(job.currentLabel)}` : '';
      $('#progressMeta').innerHTML = `${done} of ${job.total} done${job.failed ? ` · ${job.failed} failed` : ''}${job.status === 'running' ? cur : ''}`;
      renderItems(job.items);

      if (job.status !== 'running') {
        clearInterval(state.pollTimer);
        $('#runBtn').disabled = false;
        $('#runBtn').textContent = '✨ Build more content';
        unlock('#step1'); unlock('#step2'); unlock('#step3');
        const msg = job.failed
          ? `Done — ${job.completed} created, ${job.failed} failed. We emailed you a summary.`
          : `All done — ${job.completed} study sets created. We emailed you a summary. They're now on each topic in Learning and in your Library.`;
        setStatus(msg, job.failed ? '' : 'success');
      }
    } catch (e) {
      clearInterval(state.pollTimer);
      setStatus(`Lost track of the run (${e.message}). It may still be finishing in the background — check your email and Library.`, 'error');
      $('#runBtn').disabled = false; $('#runBtn').textContent = '✨ Build my content';
    }
  }

  function renderItems(items) {
    const icon = (s) => (s === 'done' ? '✓' : s === 'error' ? '✕' : s === 'queued' ? '·' : '⟳');
    $('#progressItems').innerHTML = items.map((it) => `
      <div class="p-item ${it.status}">
        <span class="p-icon">${icon(it.status)}</span>
        <span class="p-topic">${escapeHtml(it.topic)}</span>
        <span class="p-fmt">${FMT_LABEL[it.format] || it.format}</span>
        ${it.error ? `<span class="p-err">${escapeHtml(it.error)}</span>` : ''}
      </div>`).join('');
  }

  // ---- helpers -----------------------------------------------------------
  function lock(sel) { $(sel).classList.add('is-locked'); }
  function unlock(sel) { $(sel).classList.remove('is-locked'); }

  async function init() {
    $('#gradeSelect').addEventListener('change', (e) => { state.grade = e.target.value; refreshStep1Ready(); });
    $('#subjectToggle').addEventListener('click', (e) => {
      const b = e.target.closest('.subj-btn'); if (!b) return;
      $$('.subj-btn').forEach((x) => x.classList.toggle('active', x === b));
      state.subject = b.dataset.subject; refreshStep1Ready();
    });
    $('#loadTopicsBtn').addEventListener('click', loadTopics);

    $('#selectAllTopics').addEventListener('change', (e) => {
      $$('.topicBox').forEach((b) => { b.checked = e.target.checked; });
      refreshRunHint();
    });

    $$('.fmtBox').forEach((b) => b.addEventListener('change', syncCountVisibility));
    $('#runBtn').addEventListener('click', run);

    await initCommon();
    await loadOverview();
    syncCountVisibility();
  }

  init().catch((e) => setStatus(e.message, 'error'));
})();
