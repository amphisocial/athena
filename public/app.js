/* App page: build a study set + study it (flashcards, graded quiz, slides). */
(() => {
  const { state, $, $$, escapeHtml, setStatus, api, updateUsagePill, initCommon } = window.AppCommon;

  const study = { set: null, index: 0, flipped: false, answers: {} };
  const creator = { activeTab: 'paste', chatMessages: [], chatReady: false, chatSeed: null, plan: null };
  // Metadata carried over from the "New lesson" dialog on the Library page.
  let pendingLessonMeta = { topic: '', topicId: '', public: false };

  // ===================== Live annotation over lessons =====================
  // The teacher draws over the current card/slide with pen, highlighter, or a
  // laser pointer, and every mark streams to students in real time. Strokes are
  // keyed by card index, so moving to the next slide reveals that slide's own
  // annotations (and comes back to these if the teacher navigates back).
  // Coordinates are normalised to the stage (0..1) so a phone and a projector
  // land the ink in the same place. Defined here (before renderStudy runs) so
  // the render hook can call it safely; DOM refs are grabbed lazily.
  const Anno = (() => {
    let inited = false, canvas, lctx, laser, ctx, stage;
    let tool = 'off', color = '#ff5a5a';
    let drawing = false, curId = null, pending = null, rafQueued = false;
    const store = new Map();               // index -> [ {id,tool,color,points:[{x,y}]} ]
    const strokesFor = (i) => { if (!store.has(i)) store.set(i, []); return store.get(i); };
    const isTeacher = () => (typeof Live !== 'undefined') && Live.on && Live.role === 'teacher';
    const uid = () => `a_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

    function grab() {
      if (inited) return true;
      canvas = document.getElementById('lessonAnnoCanvas');
      laser = document.getElementById('lessonLaserCanvas');
      stage = document.getElementById('lessonStage');
      if (!canvas || !laser || !stage) return false;
      ctx = canvas.getContext('2d'); lctx = laser.getContext('2d');
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      inited = true;
      return true;
    }

    function resize() {
      if (!grab()) return;
      const dpr = window.devicePixelRatio || 1;
      const r = stage.getBoundingClientRect();
      [canvas, laser].forEach((c) => {
        c.width = Math.max(1, Math.round(r.width * dpr));
        c.height = Math.max(1, Math.round(r.height * dpr));
        c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
      });
      paint();
    }

    // Normalised (0..1) point from a pointer event, clamped to the stage.
    function norm(e) {
      const r = stage.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1))),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / (r.height || 1)))
      };
    }

    function strokeStyleFor(ctx2, s) {
      const w = canvas.width, h = canvas.height, dpr = window.devicePixelRatio || 1;
      ctx2.lineCap = 'round'; ctx2.lineJoin = 'round';
      if (s.tool === 'highlighter') {
        ctx2.globalCompositeOperation = 'multiply';
        ctx2.globalAlpha = 0.4;
        ctx2.strokeStyle = s.color;
        ctx2.lineWidth = 18 * dpr;
      } else {
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.globalAlpha = 1;
        ctx2.strokeStyle = s.color;
        ctx2.lineWidth = 3.2 * dpr;
      }
      return { w, h };
    }

    function drawStroke(s) {
      if (!s.points || s.points.length === 0) return;
      const { w, h } = strokeStyleFor(ctx, s);
      ctx.beginPath();
      s.points.forEach((p, i) => { const x = p.x * w, y = p.y * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (s.points.length === 1) { const p = s.points[0]; ctx.lineTo(p.x * w + 0.1, p.y * h + 0.1); }
      ctx.stroke();
    }

    function paint() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokesFor(study.index).forEach((s) => { ctx.save(); drawStroke(s); ctx.restore(); });
    }

    function drawLaserAt(p) {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, laser.width, laser.height);
      if (!p) return;
      const dpr = window.devicePixelRatio || 1;
      const x = p.x * laser.width, y = p.y * laser.height, rad = 16 * dpr;
      const g = lctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,70,80,0.95)');
      g.addColorStop(1, 'rgba(255,70,80,0)');
      lctx.fillStyle = g; lctx.beginPath(); lctx.arc(x, y, rad, 0, Math.PI * 2); lctx.fill();
    }

    // ---- Teacher pointer handling ----
    function onDown(e) {
      if (!isTeacher() || tool === 'off') return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      drawing = true;
      const p = norm(e);
      if (tool === 'laser') { drawLaserAt(p); liveSend({ type: 'laser', index: study.index, x: p.x, y: p.y, active: true }); return; }
      curId = uid();
      const s = { id: curId, tool, color, points: [p] };
      strokesFor(study.index).push(s);
      paint();
      liveSend({ type: 'anno:start', index: study.index, id: curId, tool, color, x: p.x, y: p.y });
    }
    function onMove(e) {
      if (!drawing || !isTeacher()) return;
      const p = norm(e);
      if (tool === 'laser') {
        drawLaserAt(p);
        pending = p; queueFlush('laser');
        return;
      }
      const arr = strokesFor(study.index); const s = arr[arr.length - 1];
      if (!s || s.id !== curId) return;
      s.points.push(p); paint();
      pending = p; queueFlush('pt');
    }
    function onUp() {
      if (!drawing) return;
      drawing = false;
      if (tool === 'laser') { drawLaserAt(null); liveSend({ type: 'laser', index: study.index, active: false }); }
      else if (curId) { liveSend({ type: 'anno:end', index: study.index, id: curId }); }
      curId = null; pending = null;
    }
    // Coalesce move events to one message per frame to keep the socket light.
    function queueFlush(kind) {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(() => {
        rafQueued = false;
        if (!pending) return;
        if (kind === 'laser') liveSend({ type: 'laser', index: study.index, x: pending.x, y: pending.y, active: true });
        else liveSend({ type: 'anno:point', index: study.index, id: curId, x: pending.x, y: pending.y });
      });
    }

    // ---- Inbound (students apply teacher marks; teacher applies its own echo-free) ----
    function apply(m) {
      if (m.type === 'anno:start') {
        const arr = strokesFor(m.index);
        if (!arr.some((s) => s.id === m.id)) arr.push({ id: m.id, tool: m.tool, color: m.color, points: [{ x: m.x, y: m.y }] });
        if (m.index === study.index) paint();
      } else if (m.type === 'anno:point') {
        const s = strokesFor(m.index).find((x) => x.id === m.id);
        if (s) { s.points.push({ x: m.x, y: m.y }); if (m.index === study.index) paint(); }
      } else if (m.type === 'anno:end') {
        /* nothing to finalise — points already stored */
      } else if (m.type === 'anno:clear') {
        store.set(m.index, []);
        if (m.index === study.index) paint();
      } else if (m.type === 'laser') {
        if (m.index !== study.index) return;
        drawLaserAt(m.active === false ? null : { x: m.x, y: m.y });
      }
    }

    // Seed everything a late-joining student receives on sync.
    function loadAll(annotations) {
      store.clear();
      if (annotations) Object.keys(annotations).forEach((k) => store.set(Number(k), annotations[k] || []));
      paint();
    }

    function clearCurrent() {
      store.set(study.index, []);
      paint();
      if (isTeacher()) liveSend({ type: 'anno:clear', index: study.index });
    }

    function setTool(name) {
      tool = name;
      canvas.classList.toggle('drawing', name !== 'off' && name !== undefined && (typeof Live !== 'undefined') && Live.on && Live.role === 'teacher');
      // Laser is transient; drop any dot when switching away.
      if (name !== 'laser') drawLaserAt(null);
    }
    function setColor(c) { color = c; }
    function currentTool() { return tool; }

    function reset() { store.clear(); tool = 'off'; if (canvas) { canvas.classList.remove('drawing'); paint(); drawLaserAt(null); } }

    function onNavigate() { resize(); if (lctx) drawLaserAt(null); paint(); }

    window.addEventListener('resize', () => { if (inited) resize(); });

    return { grab, resize, paint, apply, loadAll, clearCurrent, setTool, setColor, currentTool, reset, onNavigate };
  })();

  const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  /* ---------- Creator ---------- */

  function switchTab(tab) {
    creator.activeTab = tab;
    $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');
  }

  async function extractDocument() {
    const file = $('#docUpload').files[0];
    if (!file) return setStatus('Choose a file first.', 'error');
    const form = new FormData();
    form.append('document', file);
    setStatus('Extracting document text...');
    try {
      const data = await api('/api/extract', { method: 'POST', body: form });
      $('#uploadContent').value = data.text;
      $('#uploadContent').readOnly = false;
      setStatus(`Extracted ${data.characters.toLocaleString()} characters from ${data.filename}.`, 'success');
      $('#planBtn').style.display = data.text.trim().length > 40 ? '' : 'none';
      $('#planPreview').style.display = 'none';
      creator.plan = null;
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  const FORMAT_ICONS = { flashcard: '🗂', quiz: '❓', slides: '🖥' };

  async function planDocument() {
    const content = $('#uploadContent').value;
    if (!content || content.trim().length < 40) return setStatus('Extract a document first.', 'error');
    setStatus('Analyzing document and planning sections...');
    $('#planBtn').disabled = true;
    try {
      const data = await api('/api/generate/plan', {
        method: 'POST',
        body: JSON.stringify({
          content,
          cardCount: Number($('#cardCount').value || 10),
          category: $('#category').value,
          grade: $('#grade').value,
          subject: $('#subject').value
        })
      });
      creator.plan = data.sections;
      $('#planReasoning').textContent = data.reasoning || '';
      $('#planSections').innerHTML = data.sections.map((section, index) => `
        <div class="plan-section-row">
          <span class="plan-section-icon">${FORMAT_ICONS[section.format] || '🗂'}</span>
          <span class="plan-section-title">${escapeHtml(section.title)}</span>
          <span class="plan-section-meta">${section.format} · ${section.cardCount} items</span>
        </div>
      `).join('');
      $('#planPreview').style.display = '';
      setStatus(`Planned ${data.sections.length} section${data.sections.length === 1 ? '' : 's'} — review, then build the full set.`, 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      $('#planBtn').disabled = false;
    }
  }

  async function buildPlan() {
    if (!creator.plan || !creator.plan.length) return setStatus('Plan the document first.', 'error');
    setStatus('Building your study set from the plan...');
    $('#buildPlanBtn').disabled = true;
    try {
      const data = await api('/api/generate/execute-plan', {
        method: 'POST',
        body: JSON.stringify({
          sections: creator.plan,
          category: $('#category').value,
          grade: $('#grade').value,
          subject: $('#subject').value,
          notes: $('#notes').value
        })
      });
      state.usage = data.usage;
      updateUsagePill();
      loadSetIntoStudy(data.set || data.quizlet);
      setStatus('Study set built from your document plan and saved to Your Library.', 'success');
      const creatorPanel = $('#creatorPanel');
      if (creatorPanel.classList.contains('maximized')) toggleMaximize(creatorPanel, false);
      $('#studyPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      $('#buildPlanBtn').disabled = false;
    }
  }

  function buildChatContent() {
    return creator.chatSeed?.contentSeed || '';
  }

  function getSourceContent() {
    if (creator.activeTab === 'paste') return $('#pasteContent').value;
    if (creator.activeTab === 'upload') return $('#uploadContent').value;
    return buildChatContent();
  }

  async function generateSet() {
    const satMode = isSatPrep();
    if (satMode) return startSatSession();

    const content = getSourceContent();
    if (!content || content.trim().length < 20) return setStatus('Add more content before generating.', 'error');
    const payload = {
      content,
      cardCount: Number($('#cardCount').value || 10),
      format: $('#format').value,
      category: $('#category').value,
      grade: $('#grade').value,
      subject: $('#subject').value,
      notes: $('#notes').value,
      sourceType: creator.activeTab
    };
    setStatus('Generating your study set...');
    $('#generateBtn').disabled = true;
    try {
      const data = await api('/api/generate', { method: 'POST', body: JSON.stringify(payload) });
      state.usage = data.usage;
      updateUsagePill();
      const newSet = data.set || data.quizlet;
      // Carry over topic/topicId/public chosen in the "New lesson" dialog.
      if (newSet && (pendingLessonMeta.topic || pendingLessonMeta.topicId || pendingLessonMeta.public)) {
        try {
          await api(`/api/sets/${newSet.id}/meta`, { method: 'POST', body: JSON.stringify({
            topic: pendingLessonMeta.topic || undefined,
            topicId: pendingLessonMeta.topicId || undefined,
            public: pendingLessonMeta.public || undefined
          }) });
          if (pendingLessonMeta.topic) newSet.topic = pendingLessonMeta.topic;
          if (pendingLessonMeta.topicId) newSet.topicId = pendingLessonMeta.topicId;
          if (pendingLessonMeta.public) newSet.public = true;
        } catch (_) {}
        pendingLessonMeta = { topic: '', topicId: '', public: false };
      }
      loadSetIntoStudy(newSet);
      setStatus('Study set created and saved to Your Library.', 'success');
      const creatorPanel = $('#creatorPanel');
      if (creatorPanel.classList.contains('maximized')) toggleMaximize(creatorPanel, false);
      $('#studyPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      $('#generateBtn').disabled = false;
    }
  }

  /* ---------- Adaptive SAT practice ---------- */

  const sat = { sessionId: null, stage: 0, totalStages: 0, stageCardIds: [], section: '' };

  function resetSatState() {
    sat.sessionId = null;
    sat.stage = 0;
    sat.totalStages = 0;
    sat.stageCardIds = [];
    $('#satStageBar').style.display = 'none';
    $('#satSubmitStage').style.display = 'none';
    $('#satResults').style.display = 'none';
  }

  function renderSatStageBar() {
    $('#satStageBar').style.display = sat.sessionId ? '' : 'none';
    if (!sat.sessionId) return;
    $('#satStageLabel').textContent = `Stage ${sat.stage} of ${sat.totalStages} — ${sat.section}`;
    $('#satStageProgress').style.width = `${(sat.stage / sat.totalStages) * 100}%`;
    const answeredCount = sat.stageCardIds.filter((cardId) => study.answers[cardId] != null).length;
    const submitBtn = $('#satSubmitStage');
    submitBtn.style.display = '';
    submitBtn.disabled = answeredCount < sat.stageCardIds.length;
    submitBtn.textContent = answeredCount < sat.stageCardIds.length
      ? `Answer all ${sat.stageCardIds.length} questions to continue (${answeredCount}/${sat.stageCardIds.length})`
      : (sat.stage >= sat.totalStages ? 'Submit final stage & see results →' : 'Submit stage & continue →');
  }

  async function startSatSession() {
    const section = $('#satSection').value;
    const grade = $('#grade').value;
    const totalQuestions = Number($('#cardCount').value || 16);
    setStatus('Starting your adaptive practice session...');
    $('#generateBtn').disabled = true;
    try {
      const data = await api('/api/sat/session', {
        method: 'POST',
        body: JSON.stringify({ section, grade, totalQuestions, focusNotes: getSourceContent().trim() })
      });
      sat.sessionId = data.sessionId;
      sat.stage = data.stage;
      sat.totalStages = data.totalStages;
      sat.section = section;
      sat.stageCardIds = data.cards.map((card) => card.id);
      study.set = { title: data.title, cards: [...data.cards] };
      study.index = 0;
      study.flipped = false;
      study.answers = {};
      $('#satResults').style.display = 'none';
      renderStudy();
      renderSatStageBar();
      setStatus(`Stage 1 of ${sat.totalStages} — answer every question, then submit to continue.`, 'success');
      setAppView('study');
      $('#studyPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      $('#generateBtn').disabled = false;
    }
  }

  async function submitSatStage() {
    if (!sat.sessionId) return;
    const answers = sat.stageCardIds.map((cardId) => ({ cardId, selectedIndex: study.answers[cardId] }));
    const button = $('#satSubmitStage');
    button.disabled = true;
    button.textContent = 'Grading...';
    try {
      const data = await api(`/api/sat/session/${sat.sessionId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers })
      });
      if (data.done) {
        sat.sessionId = null;
        $('#satStageBar').style.display = 'none';
        $('#satSubmitStage').style.display = 'none';
        renderSatResults(data.overallAccuracy, data.domainStats);
        state.usage = data.usage;
        updateUsagePill();
        setStatus('Adaptive practice complete — saved to Your Library.', 'success');
      } else {
        sat.stage = data.stage;
        sat.stageCardIds = data.cards.map((card) => card.id);
        study.set.cards.push(...data.cards);
        study.index = study.set.cards.length - data.cards.length;
        study.flipped = false;
        renderStudy();
        renderSatStageBar();
        const trend = data.runningAccuracy >= 0.75 ? 'Nice work — the next stage steps up the difficulty.'
          : data.runningAccuracy <= 0.45 ? 'The next stage eases up to build confidence.'
          : 'The next stage stays balanced based on your performance.';
        setStatus(`Stage ${data.stage} of ${sat.totalStages}. ${trend}`, 'success');
      }
    } catch (error) {
      setStatus(error.message, 'error');
      renderSatStageBar();
    }
  }

  function renderSatResults(accuracy, domainStats) {
    const panel = $('#satResults');
    panel.style.display = '';
    $('#satScorePct').textContent = `${Math.round(accuracy * 100)}%`;
    const entries = Object.entries(domainStats || {});
    $('#satDomainBars').innerHTML = entries.map(([domain, stats]) => {
      const pct = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
      return `
        <div class="sat-domain-row">
          <div class="sat-domain-label"><span>${escapeHtml(domain)}</span><span>${stats.correct}/${stats.total}</span></div>
          <div class="slide-progress-track"><div class="slide-progress-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- Study ---------- */

  function loadSetIntoStudy(set) {
    resetSatState();
    study.set = set;
    study.index = 0;
    study.flipped = false;
    study.answers = {};
    renderStudy();
    // Teachers land on the preview after building/opening a set; students and
    // the public viewer stay where they are.
    if (!document.body.classList.contains('public-lesson') && Live.role !== 'student') {
      setAppView('study');
    }
    if (typeof renderLiveChrome === 'function') renderLiveChrome();
  }

  const currentCard = () => study.set?.cards?.[study.index];
  const isQuiz = (card) => card?.type === 'quiz' && (card.choices || []).length >= 2;
  const isSlide = (card) => card?.type === 'slide';

  function answerIndexOf(card) {
    if (Number.isInteger(card.answerIndex) && card.answerIndex >= 0) return card.answerIndex;
    return (card.choices || []).findIndex((choice) => normalize(choice) === normalize(card.back));
  }

  function renderEmptyStudy() {
    $('#setTitle').textContent = 'No set selected';
    $('#cardCounter').textContent = '0 / 0';
    $('#flashcard').style.display = '';
    $('#slideView').style.display = 'none';
    $('#flipCard').style.display = '';
    $('#shuffleCards').style.display = '';
    $('#flashcard').classList.remove('flipped');
    $('#flashcard').classList.remove('has-passage');
    $('#frontLabel').textContent = 'Question';
    $('#cardFront').textContent = 'Create or select a study set to begin. Pick a set from Your Library, or generate a new one.';
    $('#cardBack').textContent = 'The answer will appear here.';
    $('#cardExplanation').textContent = '';
    $('#verdict').innerHTML = '';
    $('#choices').innerHTML = '';
    $('#cardList').innerHTML = '';
  }

  function renderStudy() {
    const set = study.set;
    const card = currentCard();
    if (!set || !card) return renderEmptyStudy();

    $('#setTitle').textContent = set.title;
    $('#cardCounter').textContent = `${study.index + 1} / ${set.cards.length}`;

    const exportBtn = $('#exportPdfBtn');
    if (exportBtn) {
      exportBtn.style.display = set.cards.length ? '' : 'none';
      if (!exportBtn._wired) {
        exportBtn._wired = true;
        exportBtn.addEventListener('click', () => { try { window.ExportPdf.export(study.set); } catch (_) { alert('Export unavailable.'); } });
      }
    }

    if (isSlide(card)) {
      renderSlide(card);
    } else {
      renderCard(card);
    }
    renderCardList(set);
    if (sat.sessionId) renderSatStageBar();
    if (typeof Anno !== 'undefined') Anno.onNavigate();
  }

  const SLIDE_ICONS = {
    title: '✦', agenda: '🗂', content: '💡', stat: '📊', chart: '📈', quote: '❝', section: '▤', closing: '🎯'
  };

  function renderChart(chart) {
    const width = 560;
    const height = 220;
    const padding = { top: 16, right: 16, bottom: 32, left: 16 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    const values = chart.series.map((point) => point.value);
    const maxValue = Math.max(...values, 0);
    const minValue = Math.min(...values, 0);
    const range = (maxValue - minValue) || 1;
    const unit = chart.unit || '';

    if (chart.type === 'line') {
      const stepX = plotW / Math.max(1, chart.series.length - 1);
      const points = chart.series.map((point, i) => {
        const x = padding.left + i * stepX;
        const y = padding.top + plotH - ((point.value - minValue) / range) * plotH;
        return { x, y, point };
      });
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const dots = points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="var(--brand-2)" />`).join('');
      const labels = points.map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-axis-label">${escapeHtml(p.point.label)}</text>`).join('');
      const valueLabels = points.map((p) => `<text x="${p.x.toFixed(1)}" y="${(p.y - 12).toFixed(1)}" text-anchor="middle" class="chart-value-label">${escapeHtml(String(p.point.value))}${escapeHtml(unit)}</text>`).join('');
      return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg"><path d="${path}" fill="none" stroke="var(--brand-2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}${valueLabels}${labels}</svg>`;
    }

    const gap = 18;
    const barW = (plotW - gap * (chart.series.length - 1)) / chart.series.length;
    const bars = chart.series.map((point, i) => {
      const x = padding.left + i * (barW + gap);
      const barH = Math.max(4, ((point.value - Math.min(minValue, 0)) / range) * plotH);
      const y = padding.top + plotH - barH;
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="var(--brand-2)" opacity="${0.55 + (0.45 * (i + 1)) / chart.series.length}" />
        <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="chart-value-label">${escapeHtml(String(point.value))}${escapeHtml(unit)}</text>
        <text x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-axis-label">${escapeHtml(point.label)}</text>
      `;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">${bars}</svg>`;
  }

  function renderSlide(card) {
    $('#flashcard').style.display = 'none';
    $('#slideView').style.display = 'flex';
    $('#flipCard').style.display = 'none';
    $('#shuffleCards').style.display = 'none';

    const layout = card.layout || 'content';
    const stage = $('#slideStage');
    stage.className = `slide-stage layout-${layout} accent-${study.index % 5}`;

    const kicker = $('#slideKicker');
    kicker.textContent = card.kicker || '';
    kicker.style.display = card.kicker ? '' : 'none';

    $('#slideTitle').textContent = card.front;

    const bullets = String(card.back || '')
      .split(/\n+/)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);
    const bulletsEl = $('#slideBullets');
    const showBullets = bullets.length && layout !== 'stat' && layout !== 'quote' && layout !== 'chart';
    bulletsEl.style.display = showBullets ? '' : 'none';
    bulletsEl.innerHTML = showBullets ? bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('') : '';

    const chartBox = $('#slideChart');
    if (layout === 'chart' && card.chart?.series?.length) {
      chartBox.style.display = '';
      chartBox.innerHTML = renderChart(card.chart);
    } else {
      chartBox.style.display = 'none';
      chartBox.innerHTML = '';
    }

    const statBox = $('#slideStat');
    if (layout === 'stat' && card.stat?.value) {
      statBox.style.display = '';
      $('#statValue').textContent = card.stat.value;
      $('#statLabel').textContent = card.stat.label || '';
    } else {
      statBox.style.display = 'none';
    }

    const quoteBox = $('#slideQuote');
    if (layout === 'quote' && card.quote?.text) {
      quoteBox.style.display = '';
      $('#quoteText').textContent = card.quote.text;
      $('#quoteAttribution').textContent = card.quote.attribution || '';
    } else {
      quoteBox.style.display = 'none';
    }

    const media = $('#slideMedia');
    const usesMedia = layout !== 'quote' && layout !== 'chart';
    const hasImage = usesMedia && card.imageUrl;
    if (hasImage) {
      media.style.display = '';
      media.style.backgroundImage = `url("${card.imageUrl}")`;
      $('#mediaIcon').style.display = 'none';
      stage.classList.remove('no-media');
    } else {
      // No image → full-width slide (no empty half-panel, no placeholder icon).
      media.style.display = 'none';
      media.style.backgroundImage = '';
      $('#mediaIcon').style.display = 'none';
      stage.classList.add('no-media');
    }

    $('#slideNotes').textContent = card.explanation || '';
    const credit = $('#slideCredit');
    credit.textContent = card.imageCredit || '';
    credit.style.display = card.imageCredit ? '' : 'none';

    const total = study.set.cards.length;
    $('#slideProgressFill').style.width = `${((study.index + 1) / total) * 100}%`;
  }

  function renderCard(card) {
    $('#flashcard').style.display = '';
    $('#slideView').style.display = 'none';
    $('#flipCard').style.display = '';
    $('#shuffleCards').style.display = '';
    $('#flashcard').classList.toggle('flipped', study.flipped);
    $('#flashcard').classList.toggle('has-passage', Boolean(card.passage));
    $('#cardBack').textContent = card.back;
    $('#cardExplanation').textContent = card.explanation || '';
    $('#cardFront').textContent = card.front;

    const passageBox = $('#passageBox');
    passageBox.style.display = card.passage ? '' : 'none';
    passageBox.textContent = card.passage || '';

    const badge = $('#difficultyBadge');
    badge.style.display = card.difficulty ? '' : 'none';
    badge.textContent = card.difficulty ? card.difficulty.charAt(0).toUpperCase() + card.difficulty.slice(1) : '';
    badge.className = `difficulty-badge ${card.difficulty || ''}`.trim();

    if (!isQuiz(card)) {
      $('#frontLabel').textContent = 'Question';
      $('#choices').innerHTML = '';
      $('#verdict').innerHTML = '';
      return;
    }

    const selected = study.answers[card.id];
    const answerIndex = answerIndexOf(card);
    $('#frontLabel').textContent = selected == null ? 'Quiz — pick an answer, then flip' : 'Quiz — flip to check your answer';

    $('#choices').innerHTML = card.choices.map((choice, index) => {
      const classes = ['choice', 'selectable'];
      if (selected === index) classes.push('selected');
      if (study.flipped) {
        if (index === answerIndex) classes.push('correct');
        else if (selected === index) classes.push('incorrect');
      }
      return `<button type="button" class="${classes.join(' ')}" data-index="${index}">${String.fromCharCode(65 + index)}. ${escapeHtml(choice)}</button>`;
    }).join('');

    $$('#choices .choice').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (study.flipped) return;
        const choice = Number(button.dataset.index);
        study.answers[card.id] = choice;
        renderStudy();
        // In a live session, students send their answer to the teacher's tally.
        if (Live.on && Live.role === 'student') liveSend({ type: 'answer', index: study.index, choice });
      });
    });

    if (study.flipped && selected != null) {
      const isCorrect = answerIndex >= 0
        ? selected === answerIndex
        : normalize(card.choices[selected]) === normalize(card.back);
      $('#verdict').innerHTML = isCorrect
        ? '<span class="verdict-pill correct">✓ Correct answer</span>'
        : '<span class="verdict-pill incorrect">✗ Incorrect answer</span>';
    } else if (study.flipped) {
      $('#verdict').innerHTML = '<span class="verdict-pill neutral">No answer selected</span>';
    } else {
      $('#verdict').innerHTML = '';
    }
  }

  function renderCardList(set) {
    $('#cardList').innerHTML = set.cards.map((item, index) => `
      <button class="card-row ${index === study.index ? 'active' : ''}" data-index="${index}">
        ${index + 1}. ${item.type === 'slide' ? '🖥 ' : item.type === 'quiz' ? '❓ ' : ''}${escapeHtml(item.front)}
      </button>
    `).join('');
    $$('.card-row').forEach((row) => row.addEventListener('click', () => {
      study.index = Number(row.dataset.index);
      study.flipped = false;
      renderStudy();
    }));
  }

  function flipCard() {
    if (Live.on && Live.role === 'student') return;   // teacher drives the deck
    const card = currentCard();
    if (!card || isSlide(card)) return;
    study.flipped = !study.flipped;
    renderStudy();
    if (Live.on && Live.role === 'teacher') liveSend({ type: 'nav', index: study.index, flipped: study.flipped });
  }

  function moveCard(delta) {
    if (Live.on && Live.role === 'student') return;
    const cards = study.set?.cards || [];
    if (!cards.length) return;
    study.index = (study.index + delta + cards.length) % cards.length;
    study.flipped = false;
    renderStudy();
    if (Live.on && Live.role === 'teacher') liveSend({ type: 'nav', index: study.index, flipped: study.flipped });
  }

  function shuffleCards() {
    if (Live.on) return;   // shuffling would desync a live room
    if (!study.set?.cards?.length) return;
    study.set.cards = study.set.cards
      .map((card) => ({ card, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ card }) => card);
    study.index = 0;
    study.flipped = false;
    renderStudy();
  }

  async function openSet(setId) {
    try {
      const data = await api(`/api/sets/${setId}`);
      loadSetIntoStudy(data.set || data.quizlet);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  }

  /* ---------- Maximize ---------- */

  function toggleMaximize(panel, force) {
    const willMax = force !== undefined ? force : !panel.classList.contains('maximized');
    $$('.panel.maximized').forEach((other) => {
      other.classList.remove('maximized');
      other.querySelector('.max-btn').textContent = '⤢';
      other.querySelector('.max-btn').title = 'Maximize this panel';
    });
    panel.classList.toggle('maximized', willMax);
    document.body.classList.toggle('no-scroll', willMax);
    const button = panel.querySelector('.max-btn');
    button.textContent = willMax ? '⤡' : '⤢';
    button.title = willMax ? 'Exit full screen (Esc)' : 'Maximize this panel';
  }

  /* ---------- Guided chat ---------- */

  /* ---------- Guided chat (real planning agent) ---------- */

  function resetChat() {
    creator.chatMessages = [];
    creator.chatReady = false;
    creator.chatSeed = null;
    $('#chatBox').innerHTML = '';
    $('#chatReadyBanner').style.display = 'none';
    $('#chatInput').disabled = false;
    $('#chatSend').disabled = false;
    addMessage('bot', "Hi! Tell me what you'd like to study, and I'll ask a couple of quick questions to build the right set for you.");
  }

  function addMessage(kind, text) {
    const div = document.createElement('div');
    div.className = `message ${kind}`;
    div.textContent = text;
    $('#chatBox').appendChild(div);
    $('#chatBox').scrollTop = $('#chatBox').scrollHeight;
    return div;
  }

  async function sendChat() {
    if (creator.chatReady) return;
    const input = $('#chatInput');
    const answer = input.value.trim();
    if (!answer) return;
    addMessage('user', answer);
    creator.chatMessages.push({ role: 'user', content: answer });
    input.value = '';
    input.disabled = true;
    $('#chatSend').disabled = true;
    const thinking = addMessage('bot thinking', 'Thinking...');
    try {
      const data = await api('/api/chat/coach', {
        method: 'POST',
        body: JSON.stringify({ messages: creator.chatMessages })
      });
      thinking.remove();
      if (data.ready) {
        creator.chatReady = true;
        creator.chatSeed = data;
        addMessage('bot', `Got it — I have what I need to build "${data.title || 'your study set'}."`);
        $('#category').value = data.category;
        applySatPrepMode();
        $('#grade').value ||= data.grade || '';
        if (isSatPrep()) {
          if (['Reading and Writing', 'Math'].includes(data.subject)) $('#satSection').value = data.subject;
        } else {
          $('#subject').value ||= data.subject || '';
          $('#format').value = data.format || 'mixed';
          if (data.notes) $('#notes').value ||= data.notes;
        }
        $('#chatReadyBanner').style.display = '';
        $('#chatReadyBanner').textContent = 'Ready — review the settings below, then click Generate.';
      } else {
        creator.chatMessages.push({ role: 'assistant', content: data.message });
        addMessage('bot', data.message);
        input.disabled = false;
        $('#chatSend').disabled = false;
        input.focus();
      }
    } catch (error) {
      thinking.remove();
      addMessage('bot', `Sorry, I hit a snag: ${error.message}`);
      input.disabled = false;
      $('#chatSend').disabled = false;
    }
  }

  /* ---------- Wiring ---------- */

  function isSatPrep() {
    return $('#category').value === 'SAT prep';
  }

  function applySatPrepMode() {
    const satMode = isSatPrep();
    $('#satSectionLabel').style.display = satMode ? '' : 'none';
    $('#subject').closest('label').style.display = satMode ? 'none' : '';
    $('#format').closest('label').style.display = satMode ? 'none' : '';
    if (satMode) {
      $('#format').value = 'quiz';
      $('#pasteContent').placeholder = 'Optional: specific topics or skills to focus on (e.g., comma usage, quadratic equations, main-idea questions). Leave blank for a broad, real-exam-style mix across all content domains.';
      $('#generateBtn').textContent = 'Start Adaptive Practice';
      $('#cardCount').title = 'Total questions across both adaptive stages';
    } else {
      $('#pasteContent').placeholder = 'Paste your material here. Example: FinOps principles, a chapter summary, interview notes, SAT topic notes...';
      $('#generateBtn').textContent = 'Generate';
      $('#cardCount').title = '';
    }
  }

  // Create <-> Study view tabs (teacher builder). Switching also drops any
  // leftover maximized overlay so the two mechanisms never fight.
  function setAppView(view) {
    const grid = document.getElementById('appGrid');
    if (!grid) return;
    grid.dataset.view = view;
    $$('.view-tab').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel.maximized').forEach((p) => toggleMaximize(p, false));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindEvents() {
    $('#category').addEventListener('change', applySatPrepMode);
    $$('.view-tab').forEach((t) => t.addEventListener('click', () => setAppView(t.dataset.view)));
    $('#satSubmitStage').addEventListener('click', submitSatStage);
    $$('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    $('#extractBtn').addEventListener('click', extractDocument);
    $('#planBtn').addEventListener('click', planDocument);
    $('#buildPlanBtn').addEventListener('click', buildPlan);
    $('#generateBtn').addEventListener('click', generateSet);
    $('#flashcard').addEventListener('click', flipCard);
    $('#flipCard').addEventListener('click', flipCard);
    $('#prevCard').addEventListener('click', () => moveCard(-1));
    $('#nextCard').addEventListener('click', () => moveCard(1));
    $('#shuffleCards').addEventListener('click', shuffleCards);
    $('#chatSend').addEventListener('click', sendChat);
    $('#chatInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') sendChat(); });
    $('#resetChat').addEventListener('click', resetChat);
    $$('.max-btn').forEach((button) => button.addEventListener('click', () => toggleMaximize(document.getElementById(button.dataset.target))));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const maximized = $('.panel.maximized');
        if (maximized) toggleMaximize(maximized, false);
        return;
      }
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (typing || !study.set?.cards?.length) return;
      if (event.key === 'ArrowLeft') moveCard(-1);
      if (event.key === 'ArrowRight') moveCard(1);
      if (event.key === ' ') { event.preventDefault(); flipCard(); }
    });
  }

  // ===================== Live lesson sessions =====================
  const Live = { ws: null, role: null, on: false, setId: null, aggregate: null, questions: [] };
  const Audio = { room: null, enabled: false, url: null, on: false, checked: false };
  function liveSend(o) { try { if (Live.ws && Live.ws.readyState === 1) Live.ws.send(JSON.stringify(o)); } catch (_) {} }
  const wsLessonUrl = (setId) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/lesson?set=${encodeURIComponent(setId)}`;

  function connectLive(setId, role) {
    closeLive();
    Live.setId = setId; Live.role = role;
    const ws = new WebSocket(wsLessonUrl(setId));
    Live.ws = ws;
    ws.onopen = () => { Live.on = true; renderLiveChrome(); };
    ws.onclose = () => { Live.on = false; renderLiveChrome(); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handleLive(m); };
  }
  function closeLive() { if (Live.ws) { try { Live.ws.close(); } catch (_) {} } Live.ws = null; Live.on = false; Anno.reset(); }

  function handleLive(m) {
    if (m.type === 'sync') {
      if (m.youAre) Live.youAre = m.youAre;
      if (Live.role === 'student' && m.set) loadSetIntoStudy(m.set);
      applyRemoteState(m.state);
      Anno.loadAll(m.annotations);
      if (Live.role === 'student' && m.audioOn) joinStudentAudio(Live.setId, Live.youAre);
    } else if (m.type === 'nav') {
      applyRemoteState({ index: m.index, flipped: m.flipped });
    } else if (m.type === 'anno:start' || m.type === 'anno:point' || m.type === 'anno:end' || m.type === 'anno:clear' || m.type === 'laser') {
      // The teacher's own marks are drawn locally as they happen, so ignore the
      // server echo; students apply everything.
      if (Live.role === 'student') Anno.apply(m);
    } else if (m.type === 'audio') {
      if (Live.role === 'student') { if (m.on) joinStudentAudio(Live.setId, Live.youAre); else stopAudio(); }
    } else if (m.type === 'reaction') {
      floatEmoji(m.emoji);
    } else if (m.type === 'presence') {
      Live.count = m.count; Live.roster = m.roster || null; renderLiveChrome();
    } else if (m.type === 'quiz:aggregate') {
      Live.aggregate = m; renderLiveChrome();
    } else if (m.type === 'question') {
      Live.questions.unshift(m.question); renderLiveChrome();
    } else if (m.type === 'question:cleared') {
      Live.questions = Live.questions.filter((q) => q.id !== m.id); renderLiveChrome();
    } else if (m.type === 'ended') {
      closeLive(); stopAudio(); setStatus('The teacher ended the live session.', 'info'); renderLiveChrome();
    }
  }
  function applyRemoteState(st) { if (!st) return; study.index = Number(st.index) || 0; study.flipped = Boolean(st.flipped); renderStudy(); }

  function floatEmoji(emoji) {
    const host = document.getElementById('studyPanel') || document.body;
    const el = document.createElement('div');
    el.className = 'live-emoji'; el.textContent = emoji;
    el.style.left = `${20 + Math.random() * 60}%`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  async function teacherGoLive() {
    const set = study.set; if (!set) return;
    try { await api(`/api/sets/${set.id}/go-live`, { method: 'POST' }); }
    catch (e) { setStatus(e.message, 'error'); return; }
    if (study.set) study.set.isLive = true;
    Live.shareUrl = null;   // QR re-fetches the join link for this set
    connectLive(set.id, 'teacher');
    // Optional audio: only if the teacher ticked "with audio" and it's available.
    if (Audio.enabled && document.getElementById('audioOpt') && document.getElementById('audioOpt').checked) {
      startTeacherAudio(set.id).catch((e) => setStatus('Audio: ' + e.message, 'error'));
    }
    setStatus('You are live — share the link or QR so students can join.', 'success');
  }

  // ---- Optional LiveKit audio ----
  async function checkAudioConfig() {
    try { const d = await api('/api/live/config'); Audio.enabled = !!d.enabled; Audio.url = d.url; }
    catch (_) { Audio.enabled = false; }
    Audio.checked = true;
  }
  const LK = () => window.LivekitClient;
  function waitForLK(ms = 6000) {
    return new Promise((resolve, reject) => {
      if (LK()) return resolve(LK());
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (LK()) { clearInterval(iv); resolve(LK()); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('audio library did not load (check your network or ad blocker).')); }
      }, 120);
    });
  }

  async function getLiveToken(setId, label) {
    const d = await api('/api/live/token', { method: 'POST', body: JSON.stringify({ kind: 'lesson', id: setId, label: label || '' }) });
    return d;
  }
  let _audioUnlocked = false;
  let _lessonOptedOut = false;
  function unlockAudioPlayback() {
    _audioUnlocked = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const c = new Ctx();
        if (c.state === 'suspended') c.resume();
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      }
    } catch (_) {}
  }
  function playAllLkAudio() {
    const els = [...document.querySelectorAll('audio[data-lk="1"]')];
    return Promise.allSettled(els.map((el) => el.play()));
  }
  function attachRemoteAudio(track) {
    const el = track.attach(); el.autoplay = true; el.dataset.lk = '1';
    el.style.display = 'none'; el.setAttribute('playsinline', '');
    document.body.appendChild(el);
    // Desktop plays immediately; iOS blocks until the student taps the button.
    el.play().then(() => { Audio.hearing = true; renderLiveChrome(); })
      .catch(() => { renderLiveChrome(); });
  }
  function normalizeWsUrl(u) {
    let s = String(u || '').trim();
    if (!s) return s;
    if (/^https:/i.test(s)) return s.replace(/^https:/i, 'wss:');
    if (/^http:/i.test(s)) return s.replace(/^http:/i, 'ws:');
    if (/^wss?:/i.test(s)) return s;
    return `wss://${s}`;
  }
  // Probe the LiveKit host over HTTPS first so an unreachable server surfaces a
  // clear message instead of "could not establish signal connection: Failed to
  // fetch". no-cors: a reachable host resolves (opaque); only a real network/
  // DNS/TLS failure rejects.
  async function preflightAudio(wsUrl) {
    const httpUrl = wsUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
    let host = httpUrl; try { host = new URL(httpUrl).host; } catch (_) {}
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try { await fetch(httpUrl, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal }); }
    catch (_) { throw new Error(`can't reach the audio server at ${host}. Make sure the LiveKit server is running and reachable over HTTPS (DNS + TLS + nginx proxy for that host).`); }
    finally { clearTimeout(timer); }
  }
  async function connectAudioRoom(setId, label) {
    await waitForLK();
    const tok = await getLiveToken(setId, label);
    const token = tok.token;
    const url = normalizeWsUrl(tok.url);
    await preflightAudio(url);
    const room = new (LK().Room)({ adaptiveStream: true, dynacast: true });
    room.on(LK().RoomEvent.TrackSubscribed, (track) => { if (track.kind === 'audio') attachRemoteAudio(track); });
    room.on(LK().RoomEvent.ParticipantConnected, () => renderLiveChrome());
    room.on(LK().RoomEvent.ParticipantDisconnected, () => renderLiveChrome());
    room.on(LK().RoomEvent.TrackMuted, () => renderLiveChrome());
    room.on(LK().RoomEvent.TrackUnmuted, () => renderLiveChrome());
    room.on(LK().RoomEvent.ParticipantPermissionsChanged, () => {
      // If the teacher granted us the mic, start publishing; if revoked, stop.
      const canPub = room.localParticipant.permissions && room.localParticipant.permissions.canPublish;
      room.localParticipant.setMicrophoneEnabled(!!canPub).catch(() => {});
      renderLiveChrome();
    });
    try {
      await room.connect(url, token);
    } catch (e) {
      try { await room.disconnect(); } catch (_) {}
      let host = url; try { host = new URL(url.replace(/^ws/i, 'http')).host; } catch (_) {}
      const raw = (e && e.message) || String(e);
      if (/failed to fetch|signal connection|network|timeout/i.test(raw)) {
        throw new Error(`couldn't connect to the audio server at ${host}. Check that LiveKit is running and ${host} resolves over WSS.`);
      }
      throw new Error(raw);
    }
    Audio.room = room; Audio.on = true;
    return room;
  }
  async function startTeacherAudio(setId) {
    const room = await connectAudioRoom(setId, 'Teacher');
    await room.localParticipant.setMicrophoneEnabled(true);
    liveSend({ type: 'audio', on: true });   // tell students to start listening
    renderLiveChrome();
  }
  async function joinStudentAudio(setId, label) {
    if (_lessonOptedOut) { renderLiveChrome(); return; }
    try { await connectAudioRoom(setId, label || 'Student'); renderLiveChrome(); }
    catch (_) { /* audio is best-effort for attendees */ }
  }
  // Student speaker toggle (the tap iOS needs, and a way to stop).
  async function studentToggleAudio() {
    if (Audio.hearing || (Audio.on && _audioUnlocked)) {
      _lessonOptedOut = true; Audio.hearing = false;
      await stopAudio(); renderLiveChrome(); return;
    }
    _lessonOptedOut = false;
    unlockAudioPlayback();                 // inside the gesture
    try {
      if (!Audio.room) await connectAudioRoom(Live.setId, Live.youAre || 'Student');
      await playAllLkAudio();
      Audio.hearing = true;
    } catch (e) { setStatus('Audio: ' + (e.message || 'could not start listening'), 'error'); }
    renderLiveChrome();
  }
  async function stopAudio() {
    if (Audio.room) { try { await Audio.room.disconnect(); } catch (_) {} }
    Audio.room = null; Audio.on = false; Audio.hearing = false;
    document.querySelectorAll('audio[data-lk="1"]').forEach((el) => el.remove());
  }
  function toggleMyMic() {
    if (!Audio.room) return;
    const lp = Audio.room.localParticipant;
    lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled).catch(() => {}).finally(renderLiveChrome);
  }
  // Teacher grant/mute over LiveKit participant identity.
  async function grantMic(identity, allow) {
    try { await api('/api/live/grant', { method: 'POST', body: JSON.stringify({ kind: 'lesson', id: Live.setId, identity, allow }) }); }
    catch (e) { setStatus(e.message, 'error'); }
  }
  async function teacherEndLive() {
    const set = study.set; if (!set) return;
    liveSend({ type: 'end' });
    try { await api(`/api/sets/${set.id}/stop-live`, { method: 'POST' }); } catch (_) {}
    if (study.set) study.set.isLive = false;
    closeLive(); stopAudio(); Live.questions = []; Live.aggregate = null; renderLiveChrome();
    setStatus('Live session ended.', 'info');
  }

  // Renders the live strip/panel + reaction/question controls into #studyActions.
  function renderLiveChrome() {
    const actions = document.getElementById('studyActions');
    if (!actions) return;
    let strip = document.getElementById('liveStrip');
    if (!strip) { strip = document.createElement('div'); strip.id = 'liveStrip'; strip.className = 'live-strip'; actions.insertAdjacentElement('afterend', strip); }

    const isTeacher = Live.role === 'teacher';
    const ownsSet = study.set && state.user && study.set.ownerId === state.user.id;

    // Annotation toolbar + persistent QR are teacher-only, live-only.
    updateLessonAnnoChrome(isTeacher && Live.on);

    // Not connected: teacher (owner) sees "Go live" + "Share"; if the lesson is
    // already live, show "End live" so they always have the control.
    if (!Live.on) {
      if (ownsSet && !document.body.classList.contains('public-lesson')) {
        const canAudio = Audio.enabled && state.user && state.user.limits && state.user.limits.whiteboardLive;
        if (study.set.isLive) {
          strip.innerHTML = `<span class="live-dot">● LIVE</span>
            <button class="btn soft" id="resumeLiveBtn">Resume control</button>
            <button class="btn ghost" id="endLiveBtn2">End live</button>
            <button class="btn soft" id="shareLessonBtn">Share</button>`;
          document.getElementById('resumeLiveBtn').addEventListener('click', () => connectLive(study.set.id, 'teacher'));
          document.getElementById('endLiveBtn2').addEventListener('click', teacherEndLive);
        } else {
          strip.innerHTML = `<button class="btn primary" id="goLiveBtn">● Go live</button>
            ${canAudio ? '<label class="audio-opt"><input type="checkbox" id="audioOpt" /> 🎤 with audio</label>' : ''}
            <button class="btn soft" id="shareLessonBtn">Share</button>`;
          document.getElementById('goLiveBtn').addEventListener('click', teacherGoLive);
        }
        const sh = document.getElementById('shareLessonBtn'); if (sh) sh.addEventListener('click', openLessonShare);
      } else {
        strip.innerHTML = '';
      }
      return;
    }

    const react = `<span class="live-react">${['👍', '🎉', '❓', '😮', '👏'].map((e) => `<button class="react-btn" data-emoji="${e}">${e}</button>`).join('')}</span>`;

    if (isTeacher) {
      const agg = Live.aggregate;
      const aggHtml = (agg && agg.total) ? (() => {
        const pct = agg.correctIndex >= 0 ? Math.round((agg.correct / agg.total) * 100) : null;
        return `<span class="live-agg">${agg.total} answered${pct != null ? ` · ${pct}% correct (${agg.correct}/${agg.total})` : ''}</span>`;
      })() : '<span class="live-agg muted">No answers yet on this card</span>';
      const qs = Live.questions.length
        ? `<ul class="live-qs">${Live.questions.map((q) => `<li><strong>${escapeHtml(q.name || q.label)}</strong>: ${escapeHtml(q.text)} <button class="q-clear" data-id="${q.id}">✓</button></li>`).join('')}</ul>`
        : '<div class="live-qs-empty">No questions yet.</div>';
      let audioBlock = '';
      if (Audio.on && Audio.room) {
        const micOn = Audio.room.localParticipant && Audio.room.localParticipant.isMicrophoneEnabled;
        const parts = [...Audio.room.remoteParticipants.values()];
        const speakers = parts.map((p) => {
          const canPub = p.permissions && p.permissions.canPublish;
          return `<li>${escapeHtml(p.name || 'Student')} <button class="btn ghost small grant-mic" data-id="${p.identity}" data-allow="${canPub ? '0' : '1'}">${canPub ? 'Mute' : '🎤 Let speak'}</button></li>`;
        }).join('');
        audioBlock = `<div class="live-audio">
          <button class="btn soft small ${micOn ? 'primary' : ''}" id="micToggle">${micOn ? '🔇 Mute me' : '🎤 Unmute me'}</button>
          <div class="live-qtitle">Audio attendees${parts.length ? ` (${parts.length})` : ''}</div>
          <ul class="live-speakers">${speakers || '<li class="muted">No one has joined audio yet.</li>'}</ul></div>`;
      } else {
        const canAudio = Audio.enabled && state.user && state.user.limits && state.user.limits.whiteboardLive;
        if (canAudio) audioBlock = '<div class="live-audio"><button class="btn soft small" id="startAudioBtn">🎤 Start audio</button></div>';
      }
      strip.innerHTML = `
        <div class="live-head"><span class="live-dot">● LIVE</span> <span>${Live.count || 0} student${Live.count === 1 ? '' : 's'}</span>
          ${Audio.on ? '<span class="audio-live">🎤 audio on</span>' : ''}
          <button class="btn ghost small" id="endLiveBtn">End live</button></div>
        <div class="live-body">${aggHtml} ${react}${audioBlock}<div class="live-qtitle">Questions</div>${qs}</div>`;
      document.getElementById('endLiveBtn').addEventListener('click', teacherEndLive);
      strip.querySelectorAll('.q-clear').forEach((b) => b.addEventListener('click', () => liveSend({ type: 'question:clear', id: b.dataset.id })));
      const mt = document.getElementById('micToggle'); if (mt) mt.addEventListener('click', toggleMyMic);
      const sa = document.getElementById('startAudioBtn'); if (sa) sa.addEventListener('click', () => { if (study.set) startTeacherAudio(study.set.id).catch((e) => setStatus('Audio: ' + e.message, 'error')); });
      strip.querySelectorAll('.grant-mic').forEach((b) => b.addEventListener('click', () => grantMic(b.dataset.id, b.dataset.allow === '1')));
    } else {
      // Student: following the teacher, can react + ask a question. Nav is locked.
      const canSpeak = Audio.on && Audio.room && Audio.room.localParticipant && Audio.room.localParticipant.permissions && Audio.room.localParticipant.permissions.canPublish;
      const micOn = canSpeak && Audio.room.localParticipant.isMicrophoneEnabled;
      const listenBtn = `<button class="btn soft small" id="lessonAudioBtn">${Audio.hearing ? '🔊 Stop listening' : '🔈 Tap to hear teacher'}</button>`;
      const audioNote = Audio.on
        ? `<div class="live-audio">${listenBtn}${canSpeak
            ? ` <span class="audio-live">🎤 The teacher unmuted you</span> <button class="btn soft small" id="micToggle">${micOn ? '🔇 Mute' : '🎤 Speak'}</button>`
            : ''}</div>`
        : '';
      strip.innerHTML = `
        <div class="live-head"><span class="live-dot">● LIVE</span> <span>Following the teacher</span></div>
        <div class="live-body">
          ${audioNote}
          ${react}
          <div class="live-ask"><input id="liveQ" placeholder="Ask a question…" maxlength="400" /><button class="btn soft small" id="liveQSend">Ask</button></div>
        </div>`;
      const sendQ = () => { const v = document.getElementById('liveQ').value.trim(); if (!v) return; liveSend({ type: 'question:ask', text: v }); document.getElementById('liveQ').value = ''; setStatus('Question sent to the teacher.', 'success'); };
      document.getElementById('liveQSend').addEventListener('click', sendQ);
      document.getElementById('liveQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendQ(); });
      const mt = document.getElementById('micToggle'); if (mt) mt.addEventListener('click', toggleMyMic);
      const la = document.getElementById('lessonAudioBtn'); if (la) la.addEventListener('click', studentToggleAudio);
    }
    strip.querySelectorAll('.react-btn').forEach((b) => b.addEventListener('click', () => liveSend({ type: 'reaction', emoji: b.dataset.emoji })));
    // Lock nav for students.
    document.body.classList.toggle('live-student', Live.on && Live.role === 'student');
    document.body.classList.toggle('live-on', Live.on);
  }

  // ---- Live annotation toolbar + persistent QR (teacher) ----
  let annoBarWired = false;
  let lessonQrCollapsed = false;
  function wireAnnoBar() {
    if (annoBarWired) return;
    const bar = document.getElementById('lessonAnnobar');
    if (!bar) return;
    annoBarWired = true;
    bar.querySelectorAll('.anno-btn[data-annotool]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.annotool;
      Anno.setTool(t);
      bar.querySelectorAll('.anno-btn[data-annotool]').forEach((x) => x.classList.toggle('active', x === b));
    }));
    bar.querySelectorAll('.anno-swatch').forEach((b) => b.addEventListener('click', () => {
      Anno.setColor(b.dataset.annocolor);
      bar.querySelectorAll('.anno-swatch').forEach((x) => x.classList.toggle('active', x === b));
    }));
    document.getElementById('annoClearBtn')?.addEventListener('click', () => Anno.clearCurrent());
    document.getElementById('lessonQrCollapse')?.addEventListener('click', () => { lessonQrCollapsed = true; renderLessonQr(); });
    document.getElementById('lessonQrReopen')?.addEventListener('click', () => { lessonQrCollapsed = false; renderLessonQr(); });
  }

  function updateLessonAnnoChrome(showTeacher) {
    const bar = document.getElementById('lessonAnnobar');
    if (bar) {
      wireAnnoBar();
      bar.hidden = !showTeacher;
      if (showTeacher) {
        Anno.resize();
        // Default to the "hand" (interact) tool so the first live moment doesn't
        // trap taps behind a drawing surface.
        if (!bar.querySelector('.anno-btn.active')) {
          const off = bar.querySelector('.anno-btn[data-annotool="off"]');
          if (off) off.classList.add('active');
          Anno.setTool('off');
        }
      } else {
        Anno.setTool('off');
      }
    }
    renderLessonQr(showTeacher);
  }

  async function renderLessonQr(showTeacher) {
    const dock = document.getElementById('lessonSessionQr');
    const reopen = document.getElementById('lessonQrReopen');
    if (!dock || !reopen) return;
    const show = showTeacher === undefined ? !dock.hidden : showTeacher;
    if (!show) { dock.hidden = true; reopen.hidden = true; return; }
    // Make sure we have a public join link for the QR; reuse the share token.
    if (!Live.shareUrl && study.set) {
      try { const d = await api(`/api/sets/${study.set.id}/share-link`, { method: 'POST' }); Live.shareUrl = `${window.location.origin}/l/${d.token}`; }
      catch (_) { /* leave QR hidden if we can't get a link */ }
    }
    if (!Live.shareUrl) { dock.hidden = true; reopen.hidden = true; return; }
    const img = document.getElementById('lessonQrImg');
    if (img && img.dataset.url !== Live.shareUrl) { img.src = `/qr?d=${encodeURIComponent(Live.shareUrl)}`; img.dataset.url = Live.shareUrl; }
    const host = document.getElementById('lessonQrHost');
    if (host) host.textContent = Live.shareUrl.replace(/^https?:\/\//, '');
    dock.hidden = lessonQrCollapsed;
    reopen.hidden = !lessonQrCollapsed;
  }

  // Share a lesson by link + QR + email (parity with the whiteboard share).
  async function openLessonShare() {
    const set = study.set; if (!set) return;
    let token; let url;
    try {
      const d = await api(`/api/sets/${set.id}/share-link`, { method: 'POST' });
      token = d.token; url = `${window.location.origin}/l/${token}`;
    } catch (e) { setStatus(e.message, 'error'); return; }
    let m = document.getElementById('lessonShareModal');
    if (!m) { m = document.createElement('div'); m.id = 'lessonShareModal'; m.className = 'study-modal'; document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.classList.contains('study-close')) m.classList.remove('open'); }); }
    m.innerHTML = `<div class="study-card share-card"><button class="study-close" aria-label="Close">×</button>
      <h3>Share this lesson</h3>
      <p class="share-sub">Anyone with the link can open and study it — no login. If you go live, they can join the live session from the same link.</p>
      <div class="share-linkrow"><input id="lessonShareUrl" readonly value="${url}" /><button class="btn primary small" id="lessonShareCopy">Copy</button></div>
      <div class="share-qr"><img src="/qr?d=${encodeURIComponent(url)}" alt="QR code" width="160" height="160" /><span>Scan or project this in class</span></div>
      <div class="share-email">
        <label>Email it to your class<textarea id="lessonShareEmails" placeholder="student1@school.edu, student2@school.edu"></textarea></label>
        <label>Note (optional)<input id="lessonShareNote" placeholder="Join my live lesson at 2pm — scan to open." /></label>
        <button class="btn primary" id="lessonShareSend">Send links</button>
        <div class="form-status" id="lessonShareStatus"></div>
      </div></div>`;
    m.classList.add('open');
    document.getElementById('lessonShareCopy').addEventListener('click', () => {
      const inp = document.getElementById('lessonShareUrl'); inp.select();
      navigator.clipboard?.writeText(inp.value).then(() => { document.getElementById('lessonShareCopy').textContent = 'Copied'; }).catch(() => {});
    });
    document.getElementById('lessonShareSend').addEventListener('click', async () => {
      const emails = document.getElementById('lessonShareEmails').value.trim();
      const note = document.getElementById('lessonShareNote').value.trim();
      const st = document.getElementById('lessonShareStatus'); const btn = document.getElementById('lessonShareSend');
      if (!emails) { st.className = 'form-status err'; st.textContent = 'Add at least one email.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const d = await api(`/api/sets/${set.id}/share-email`, { method: 'POST', body: JSON.stringify({ emails, note }) });
        st.className = 'form-status ok';
        st.textContent = d.sent ? `Sent to ${d.sent} of ${d.total}.` : 'Links prepared. (Email is not configured on the server.)';
      } catch (e) { st.className = 'form-status err'; st.textContent = e.message; }
      finally { btn.disabled = false; btn.textContent = 'Send links'; }
    });
  }

  // Prefill from the "New lesson" / "Start lesson" dialog (Library) or the
  // public Learning hand-off. Category always defaults to General learning;
  // grade/subject/topic come from the previous dialog. Then we fill the
  // "Paste content" box: a curriculum topic (topicId) uses stored content and
  // defaults to Slides; an arbitrary typed topic is drafted by AI.
  async function applyNewLessonPrefill() {
    const p = new URLSearchParams(location.search);
    const keys = [...p.keys()];
    if (!keys.some((k) => ['subject', 'grade', 'topic', 'topicId', 'public'].includes(k))) return;

    // 1) Category always General learning for lessons started this way.
    if ($('#category')) $('#category').value = 'General learning';

    // 2) Grade / subject come straight from the previous dialog.
    if (p.get('subject') && $('#subject')) $('#subject').value = p.get('subject');
    if (p.get('grade') && $('#grade')) $('#grade').value = /^\d+$/.test(p.get('grade')) ? `Grade ${p.get('grade')}` : p.get('grade');

    const topic = (p.get('topic') || '').trim();
    const topicId = (p.get('topicId') || '').trim();
    pendingLessonMeta = { topic, topicId, public: p.get('public') === '1' };
    try { history.replaceState(null, '', location.pathname); } catch (_) {}

    const pasteEl = $('#pasteContent');
    if (!pasteEl || pasteEl.value.trim()) return;   // don't clobber typed content

    if (topicId) {
      // Curriculum topic: stored content, default to Slides.
      if ($('#format')) $('#format').value = 'slides';
      pasteEl.placeholder = 'Loading a ready-made starting point for this topic…';
      try {
        const t = await api(`/api/learning/topic-content?id=${encodeURIComponent(topicId)}`);
        if (t && t.content && !pasteEl.value.trim()) pasteEl.value = t.content;
        if (t && t.subject && $('#subject') && !$('#subject').value) $('#subject').value = t.subject;
      } catch (_) { /* leave blank; teacher can paste their own */ }
    } else if (topic) {
      // Arbitrary typed topic (New lesson): draft with AI (falls back to a scaffold).
      pasteEl.placeholder = 'Drafting a starting point for “' + topic + '”…';
      try {
        const d = await api('/api/lesson/draft-content', { method: 'POST', body: JSON.stringify({
          topic, grade: $('#grade')?.value || '', subject: $('#subject')?.value || ''
        }) });
        if (d && d.content && !pasteEl.value.trim()) pasteEl.value = d.content;
      } catch (_) { /* leave blank */ }
    }
    pasteEl.placeholder = 'Paste your material here. Example: FinOps principles, a chapter summary, interview notes, SAT topic notes...';
  }

  async function init() {
    bindEvents();
    applyNewLessonPrefill();
    resetChat();
    renderEmptyStudy();
    applySatPrepMode();
    await initCommon();
    // Learn whether live audio is available, then refresh any live controls.
    checkAudioConfig().then(() => renderLiveChrome()).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    if (params.get('signedIn') === 'google') {
      setStatus('Signed in with Google.', 'success');
      params.delete('signedIn');
      const rest = params.toString();
      window.history.replaceState({}, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
    }
    // Public lesson viewer (/l/:id) — no login. Reuse the full study viewer
    // (interactive quiz, slide deck, flip/shuffle/fullscreen) with a public set.
    if (window.location.pathname.startsWith('/l/')) {
      document.body.classList.add('public-lesson');
      const token = decodeURIComponent(window.location.pathname.split('/').pop());
      try {
        const data = await api(`/api/public/lesson/${token}`);
        loadSetIntoStudy(data.set);
        mountPublicRating(data.set, token);
        // If the lesson is live right now, join the session as a student.
        if (data.set.isLive) connectLive(token, 'student');
      } catch (error) {
        setStatus(error.message || 'This lesson is not available.', 'error');
      }
      return;
    }
    const setId = params.get('set');
    if (setId) await openSet(setId);
  }

  // Rating bar + back link shown under the study viewer for public lessons.
  function mountPublicRating(set, token) {
    const panel = document.getElementById('studyPanel');
    if (!panel) return;
    const bar = document.createElement('div');
    bar.className = 'public-lesson-bar';
    const rate = (set.rating && set.rating.count) ? (set.rating.sum / set.rating.count) : 0;
    const count = set.rating ? set.rating.count : 0;
    let stars = '';
    for (let n = 1; n <= 5; n += 1) stars += `<button class="pl-star${n <= Math.round(rate) ? ' on' : ''}" data-stars="${n}">★</button>`;
    bar.innerHTML = `
      <a class="btn ghost" href="/lessons">← Public Lessons</a>
      <span class="pl-bar-rate"><span class="pl-rate-label">Rate this:</span> ${stars}
        <span class="pl-rating-count" id="plRateCount">${count ? rate.toFixed(1) + ' (' + count + ')' : ''}</span></span>
      <a class="btn primary" href="/pricing">Sign in / Plans</a>`;
    panel.insertAdjacentElement('afterend', bar);
    bar.querySelectorAll('.pl-star').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await api('/api/public/rate', { method: 'POST', body: JSON.stringify({ type: 'lesson', id: token, stars: Number(b.dataset.stars) }) });
        if (d.rating) {
          const avg = d.rating.count ? d.rating.sum / d.rating.count : 0;
          bar.querySelectorAll('.pl-star').forEach((s, i) => s.classList.toggle('on', i < Math.round(avg)));
          document.getElementById('plRateCount').textContent = avg.toFixed(1) + ' (' + d.rating.count + ')';
        }
      } catch (_) {}
    }));
  }

  init().catch((error) => setStatus(error.message, 'error'));
})();
