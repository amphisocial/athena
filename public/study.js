/* study.js — no-login viewer to study a PUBLIC lesson (/l/:id): renders the
 * flashcards/quiz/slides and lets anyone rate it 1–5. */
(() => {
  const { $, escapeHtml, api } = window.AppCommon;
  const setId = window.location.pathname.split('/').pop();

  const esc = (v) => escapeHtml(String(v == null ? '' : v));

  // ---- Slide deck viewer (PowerPoint-style: one slide, Prev/Next, fullscreen) ----
  function renderDeck(set) {
    const cards = (set.cards || []).filter(Boolean);
    const host = $('#studyCards');
    host.innerHTML = `
      <div class="deck" id="deck">
        <div class="deck-stage" id="deckStage"></div>
        <div class="deck-bar">
          <button class="deck-btn" id="deckPrev" aria-label="Previous slide">‹</button>
          <span class="deck-counter" id="deckCounter"></span>
          <button class="deck-btn" id="deckNext" aria-label="Next slide">›</button>
          <span class="deck-spacer"></span>
          <button class="deck-btn deck-full" id="deckFull" title="Fullscreen">⛶ Present</button>
        </div>
        <div class="deck-progress"><div class="deck-progress-fill" id="deckFill"></div></div>
      </div>`;
    const deck = $('#deck'), stage = $('#deckStage');
    let idx = 0;
    function show(i) {
      idx = Math.max(0, Math.min(cards.length - 1, i));
      stage.innerHTML = deckSlideHtml(cards[idx]);
      $('#deckCounter').textContent = `${idx + 1} / ${cards.length}`;
      $('#deckPrev').disabled = idx === 0;
      $('#deckNext').disabled = idx === cards.length - 1;
      $('#deckFill').style.width = `${((idx + 1) / cards.length) * 100}%`;
    }
    $('#deckPrev').addEventListener('click', () => show(idx - 1));
    $('#deckNext').addEventListener('click', () => show(idx + 1));
    $('#deckFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else deck.requestFullscreen ? deck.requestFullscreen() : deck.webkitRequestFullscreen && deck.webkitRequestFullscreen();
    });
    document.addEventListener('keydown', (e) => {
      if (!document.body.contains(deck)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(idx + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(idx - 1); }
    });
    // tap left/right thirds of the stage to navigate (nice on projectors/phones)
    stage.addEventListener('click', (e) => {
      const r = stage.getBoundingClientRect();
      if (e.clientX < r.left + r.width * 0.35) show(idx - 1);
      else if (e.clientX > r.left + r.width * 0.65) show(idx + 1);
    });
    show(0);
  }

  function deckSlideHtml(c) {
    const layout = c.layout || 'content';
    const bullets = String(c.back || '').split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    const showBullets = bullets.length && layout !== 'stat' && layout !== 'quote';
    const hasImg = layout !== 'quote' && c.imageUrl;
    return `<div class="deck-slide layout-${esc(layout)}">
      ${c.kicker ? `<div class="ds-kicker">${esc(c.kicker)}</div>` : ''}
      <h2 class="ds-title">${esc(c.front)}</h2>
      <div class="ds-body${hasImg ? ' has-media' : ''}">
        ${hasImg ? `<figure class="ds-media"><img src="${esc(c.imageUrl)}" alt="" />${c.imageCredit ? `<figcaption>${esc(c.imageCredit)}</figcaption>` : ''}</figure>` : ''}
        <div class="ds-text">
          ${showBullets ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          ${c.stat && c.stat.value ? `<div class="ds-stat"><strong>${esc(c.stat.value)}</strong><span>${esc(c.stat.label || '')}</span></div>` : ''}
          ${c.quote && c.quote.text ? `<blockquote class="ds-quote">“${esc(c.quote.text)}”${c.quote.attribution ? `<cite>— ${esc(c.quote.attribution)}</cite>` : ''}</blockquote>` : ''}
        </div>
      </div>
      ${c.explanation ? `<p class="ds-notes">${esc(c.explanation)}</p>` : ''}
    </div>`;
  }

  function renderCards(set) {
    const cards = Array.isArray(set.cards) ? set.cards : [];
    if (!cards.length) { $('#studyCards').innerHTML = '<p class="pl-empty">This lesson has no items yet.</p>'; return; }
    $('#studyCards').innerHTML = cards.map((c, i) => {
      const type = c.type || (Array.isArray(c.choices) && c.choices.length >= 2 ? 'quiz' : 'flashcard');
      if (type === 'slide') return slideHtml(c, i);
      if (type === 'quiz' || (Array.isArray(c.choices) && c.choices.length >= 2)) return quizHtml(c, i);
      return flashHtml(c, i);
    }).join('');
  }

  function bulletsFrom(back) {
    return String(back || '').split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  }

  function slideHtml(c, i) {
    const layout = c.layout || 'content';
    const bullets = bulletsFrom(c.back);
    const showBullets = bullets.length && layout !== 'stat' && layout !== 'quote';
    const hasImg = layout !== 'quote' && c.imageUrl;
    return `<div class="study-slide">
      ${c.kicker ? `<div class="ss-kicker">${esc(c.kicker)}</div>` : ''}
      <h3 class="ss-title">${i + 1}. ${esc(c.front)}</h3>
      <div class="ss-body${hasImg ? ' has-media' : ''}">
        ${hasImg ? `<figure class="ss-media"><img src="${esc(c.imageUrl)}" alt="" loading="lazy" />${c.imageCredit ? `<figcaption>${esc(c.imageCredit)}</figcaption>` : ''}</figure>` : ''}
        <div class="ss-text">
          ${showBullets ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          ${c.stat && c.stat.value ? `<div class="ss-stat"><strong>${esc(c.stat.value)}</strong><span>${esc(c.stat.label || '')}</span></div>` : ''}
          ${c.quote && c.quote.text ? `<blockquote class="ss-quote">“${esc(c.quote.text)}”${c.quote.attribution ? `<cite>— ${esc(c.quote.attribution)}</cite>` : ''}</blockquote>` : ''}
          ${c.explanation ? `<p class="ss-notes">${esc(c.explanation)}</p>` : ''}
        </div>
      </div>
    </div>`;
  }

  function flashHtml(c, i) {
    return `<div class="study-item flip">
      <div class="sc-front">${i + 1}. ${esc(c.front)}</div>
      <div class="sc-back">${esc(c.back)}</div>
      ${c.explanation ? `<div class="sc-note">${esc(c.explanation)}</div>` : ''}
    </div>`;
  }

  function quizHtml(c, i) {
    const choices = c.choices || [];
    let correct = Number.isInteger(c.answerIndex) ? c.answerIndex : -1;
    if (correct < 0) correct = choices.findIndex((ch) => String(ch).trim().toLowerCase() === String(c.back || '').trim().toLowerCase());
    const opts = choices.map((ch, n) => `<li class="${n === correct ? 'correct' : ''}">${esc(ch)}${n === correct ? ' <span class="qa-tag">✓ answer</span>' : ''}</li>`).join('');
    return `<div class="study-item">
      <div class="sc-q">${i + 1}. ${esc(c.front)}</div>
      <ul class="sc-opts">${opts}</ul>
      ${c.explanation ? `<div class="sc-ans">${esc(c.explanation)}</div>` : ''}
    </div>`;
  }

  function renderRating(set) {
    const avg = set.rating && set.rating.count ? set.rating.avg : 0;
    const count = set.rating ? set.rating.count : 0;
    let html = '<span class="pl-rate-label">Was this helpful?</span><span class="pl-stars big">';
    for (let n = 1; n <= 5; n += 1) html += `<button class="pl-star${n <= Math.round(avg) ? ' on' : ''}" data-stars="${n}">★</button>`;
    html += `<span class="pl-rating-count">${count ? avg.toFixed(1) + ' from ' + count : 'Be the first to rate'}</span></span>`;
    $('#studyRate').innerHTML = html;
    $('#studyRate').querySelectorAll('.pl-star').forEach((b) => b.addEventListener('click', async () => {
      try {
        const d = await api('/api/public/rate', { method: 'POST', body: JSON.stringify({ type: 'lesson', id: setId, stars: Number(b.dataset.stars) }) });
        if (d.rating) renderRating({ rating: d.rating });
      } catch (_) {}
    }));
  }

  (async () => {
    try {
      const data = await api(`/api/public/lesson/${encodeURIComponent(setId)}`);
      const set = data.set;
      const subj = set.subject === 'math' ? '<span class="subj-badge math">Math</span>'
        : set.subject === 'science' ? '<span class="subj-badge science">Science</span>' : '';
      $('#studyHead').innerHTML = `
        <span class="eyebrow">Public lesson</span>
        <h1>${esc(set.title)} ${subj}</h1>
        <p class="pl-by">${esc([set.grade ? 'Grade ' + set.grade : '', set.topic].filter(Boolean).join(' • '))}
          ${set.creator ? '• by ' + esc(set.creator) : ''}</p>
        <div class="study-actions"><button class="btn small ghost" id="exportPdfBtn">⬇ Export PDF</button></div>`;
      $('#exportPdfBtn')?.addEventListener('click', () => { try { window.ExportPdf.export(set); } catch (e) { alert('Export unavailable.'); } });
      const isDeck = set.format === 'slides' ||
        (Array.isArray(set.cards) && set.cards.length && set.cards.every((c) => c.type === 'slide'));
      if (isDeck) renderDeck(set); else renderCards(set);
      renderRating(set);
    } catch (e) {
      $('#studyCards').innerHTML = `<p class="pl-empty">${esc(e.message)}</p>`;
    }
  })();
})();
