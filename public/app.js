/* App page: build a study set + study it (flashcards, graded quiz, slides). */
(() => {
  const { state, $, $$, escapeHtml, setStatus, api, updateUsagePill, initCommon } = window.AppCommon;

  const study = { set: null, index: 0, flipped: false, answers: {} };
  const creator = { activeTab: 'paste', chatMessages: [], chatReady: false, chatSeed: null, plan: null };

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
      loadSetIntoStudy(data.set || data.quizlet);
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
      const studyPanel = $('#studyPanel');
      if (!studyPanel.classList.contains('maximized')) toggleMaximize(studyPanel, true);
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
    const shouldAutoMaximize = set.category === 'SAT prep' || set.format === 'slides';
    const studyPanel = $('#studyPanel');
    if (shouldAutoMaximize && !studyPanel.classList.contains('maximized')) {
      toggleMaximize(studyPanel, true);
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

    if (isSlide(card)) {
      renderSlide(card);
    } else {
      renderCard(card);
    }
    renderCardList(set);
    if (sat.sessionId) renderSatStageBar();
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
    if (usesMedia && card.imageUrl) {
      media.style.display = '';
      media.style.backgroundImage = `url("${card.imageUrl}")`;
      $('#mediaIcon').style.display = 'none';
    } else if (usesMedia) {
      media.style.display = '';
      media.style.backgroundImage = '';
      $('#mediaIcon').style.display = '';
      $('#mediaIcon').textContent = SLIDE_ICONS[layout] || '💡';
    } else {
      media.style.display = 'none';
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

  function bindEvents() {
    $('#category').addEventListener('change', applySatPrepMode);
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
  function closeLive() { if (Live.ws) { try { Live.ws.close(); } catch (_) {} } Live.ws = null; Live.on = false; }

  function handleLive(m) {
    if (m.type === 'sync') {
      if (m.youAre) Live.youAre = m.youAre;
      if (Live.role === 'student' && m.set) loadSetIntoStudy(m.set);
      applyRemoteState(m.state);
      if (Live.role === 'student' && m.audioOn) joinStudentAudio(Live.setId, Live.youAre);
    } else if (m.type === 'nav') {
      applyRemoteState({ index: m.index, flipped: m.flipped });
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

  async function getLiveToken(setId, label) {
    const d = await api('/api/live/token', { method: 'POST', body: JSON.stringify({ kind: 'lesson', id: setId, label: label || '' }) });
    return d;
  }
  function attachRemoteAudio(track) {
    const el = track.attach(); el.autoplay = true; el.dataset.lk = '1';
    el.style.display = 'none'; document.body.appendChild(el);
  }
  async function connectAudioRoom(setId, label) {
    if (!LK()) throw new Error('audio library not loaded');
    const { token, url } = await getLiveToken(setId, label);
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
    await room.connect(url, token);
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
    try { await connectAudioRoom(setId, label || 'Student'); renderLiveChrome(); }
    catch (_) { /* audio is best-effort for attendees */ }
  }
  async function stopAudio() {
    if (Audio.room) { try { await Audio.room.disconnect(); } catch (_) {} }
    Audio.room = null; Audio.on = false;
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
    closeLive(); Live.questions = []; Live.aggregate = null; renderLiveChrome();
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

    // Not connected: teacher (owner) sees "Go live" + "Share"; others see nothing.
    if (!Live.on) {
      const canAudio = Audio.enabled && state.user && state.user.limits && state.user.limits.whiteboardLive;
      strip.innerHTML = (ownsSet && !document.body.classList.contains('public-lesson'))
        ? `<button class="btn primary" id="goLiveBtn">● Go live</button>
           ${canAudio ? '<label class="audio-opt"><input type="checkbox" id="audioOpt" /> 🎤 with audio</label>' : ''}
           <button class="btn soft" id="shareLessonBtn">Share</button>`
        : '';
      const gl = document.getElementById('goLiveBtn'); if (gl) gl.addEventListener('click', teacherGoLive);
      const sh = document.getElementById('shareLessonBtn'); if (sh) sh.addEventListener('click', openLessonShare);
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
          <button class="btn soft small" id="micToggle">${micOn ? '🔇 Mute me' : '🎤 Unmute me'}</button>
          <div class="live-qtitle">Audio attendees${parts.length ? ` (${parts.length})` : ''}</div>
          <ul class="live-speakers">${speakers || '<li class="muted">No one has joined audio yet.</li>'}</ul></div>`;
      }
      strip.innerHTML = `
        <div class="live-head"><span class="live-dot">● LIVE</span> <span>${Live.count || 0} student${Live.count === 1 ? '' : 's'}</span>
          ${Audio.on ? '<span class="audio-live">🎤 audio on</span>' : ''}
          <button class="btn ghost small" id="endLiveBtn">End live</button></div>
        <div class="live-body">${aggHtml} ${react}${audioBlock}<div class="live-qtitle">Questions</div>${qs}</div>`;
      document.getElementById('endLiveBtn').addEventListener('click', teacherEndLive);
      strip.querySelectorAll('.q-clear').forEach((b) => b.addEventListener('click', () => liveSend({ type: 'question:clear', id: b.dataset.id })));
      const mt = document.getElementById('micToggle'); if (mt) mt.addEventListener('click', toggleMyMic);
      strip.querySelectorAll('.grant-mic').forEach((b) => b.addEventListener('click', () => grantMic(b.dataset.id, b.dataset.allow === '1')));
    } else {
      // Student: following the teacher, can react + ask a question. Nav is locked.
      const canSpeak = Audio.on && Audio.room && Audio.room.localParticipant && Audio.room.localParticipant.permissions && Audio.room.localParticipant.permissions.canPublish;
      const micOn = canSpeak && Audio.room.localParticipant.isMicrophoneEnabled;
      const audioNote = Audio.on
        ? (canSpeak
          ? `<div class="live-audio"><span class="audio-live">🎤 The teacher unmuted you</span> <button class="btn soft small" id="micToggle">${micOn ? '🔇 Mute' : '🎤 Speak'}</button></div>`
          : '<div class="live-audio-note">🔊 Listening to the teacher. Ask a question and they may unmute you.</div>')
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
    }
    strip.querySelectorAll('.react-btn').forEach((b) => b.addEventListener('click', () => liveSend({ type: 'reaction', emoji: b.dataset.emoji })));
    // Lock nav for students.
    document.body.classList.toggle('live-student', Live.on && Live.role === 'student');
  }

  // Share a lesson by link + QR + email (parity with the whiteboard share).
  async function openLessonShare() {
    const set = study.set; if (!set) return;
    let token; let url;
    try {
      const d = await api(`/api/sets/${set.id}/share`, { method: 'POST' });
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

  async function init() {
    bindEvents();
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
