/* study.js — no-login viewer to study a PUBLIC lesson (/l/:id): renders the
 * flashcards/quiz/slides and lets anyone rate it 1–5. */
(() => {
  const { $, escapeHtml, api } = window.AppCommon;
  const setId = window.location.pathname.split('/').pop();

  const esc = (v) => escapeHtml(String(v == null ? '' : v));

  function renderCards(set) {
    const cards = Array.isArray(set.cards) ? set.cards : [];
    if (!cards.length) { $('#studyCards').innerHTML = '<p class="pl-empty">This lesson has no items yet.</p>'; return; }
    $('#studyCards').innerHTML = cards.map((c, i) => {
      if (c.options || c.choices) {
        const opts = (c.options || c.choices || []).map((o) => `<li>${esc(o)}</li>`).join('');
        const ans = c.answer != null ? `<div class="sc-ans">Answer: ${esc(c.answer)}</div>` : '';
        return `<div class="study-item"><div class="sc-q">${i + 1}. ${esc(c.question || c.prompt || c.front || '')}</div><ul class="sc-opts">${opts}</ul>${ans}</div>`;
      }
      if (c.bullets || c.points) {
        const b = (c.bullets || c.points || []).map((x) => `<li>${esc(x)}</li>`).join('');
        return `<div class="study-item"><div class="sc-title">${esc(c.title || c.heading || 'Slide ' + (i + 1))}</div><ul>${b}</ul></div>`;
      }
      const front = c.term || c.front || c.question || c.prompt || '';
      const back = c.definition || c.back || c.answer || c.explanation || '';
      return `<div class="study-item flip"><div class="sc-front">${esc(front)}</div><div class="sc-back">${esc(back)}</div></div>`;
    }).join('');
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
          ${set.creator ? '• by ' + esc(set.creator) : ''}</p>`;
      renderCards(set);
      renderRating(set);
    } catch (e) {
      $('#studyCards').innerHTML = `<p class="pl-empty">${esc(e.message)}</p>`;
    }
  })();
})();
