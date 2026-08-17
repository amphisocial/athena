/*
 * export-pdf.js — one-click "Export PDF" for a lesson (slides, quiz, or
 * flashcards). Builds a clean, print-optimized document in a new window and
 * opens the browser's print dialog, where the teacher chooses "Save as PDF".
 * No server round-trip, no dependencies, and it embeds the slide images.
 *
 * Usage:  window.ExportPdf.export(set)   // set = { title, subject, grade, topic, cards:[...] }
 */
(function () {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const bulletsFrom = (back) => String(back || '')
    .split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);

  function slidePage(c) {
    const layout = c.layout || 'content';
    const bullets = bulletsFrom(c.back);
    const showBullets = bullets.length && layout !== 'stat' && layout !== 'quote';
    const hasImg = layout !== 'quote' && layout !== 'chart' && c.imageUrl;
    const kicker = c.kicker ? `<div class="pk">${esc(c.kicker)}</div>` : '';
    const title = `<h2>${esc(c.front)}</h2>`;
    const body = [];
    if (showBullets) body.push(`<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
    if (c.stat && c.stat.value) body.push(`<div class="stat"><strong>${esc(c.stat.value)}</strong><span>${esc(c.stat.label || '')}</span></div>`);
    if (c.quote && c.quote.text) body.push(`<blockquote>“${esc(c.quote.text)}”${c.quote.attribution ? `<cite>— ${esc(c.quote.attribution)}</cite>` : ''}</blockquote>`);
    const textCol = `<div class="col text">${kicker}${title}${body.join('')}</div>`;
    const imgCol = hasImg ? `<div class="col media"><img src="${esc(c.imageUrl)}" alt="" /></div>` : '';
    const cls = hasImg ? 'pg slide two-col' : 'pg slide one-col';
    // image on the left for content, matching the app; full-width when no image
    return `<section class="${cls} layout-${esc(layout)}">${imgCol}${textCol}</section>`;
  }

  function quizPage(c, n) {
    const choices = c.choices || [];
    let correct = Number.isInteger(c.answerIndex) ? c.answerIndex : -1;
    if (correct < 0) correct = choices.findIndex((ch) => String(ch).trim().toLowerCase() === String(c.back || '').trim().toLowerCase());
    const opts = choices.map((ch, i) =>
      `<li class="${i === correct ? 'correct' : ''}">${esc(ch)}${i === correct ? ' <span class="tag">✓ answer</span>' : ''}</li>`).join('');
    return `<section class="pg card">
      <div class="q-num">Question ${n}</div>
      <h3>${esc(c.front)}</h3>
      <ul class="opts">${opts}</ul>
      ${c.explanation ? `<div class="expl">${esc(c.explanation)}</div>` : ''}
    </section>`;
  }

  function flashPage(c, n) {
    return `<section class="pg card flash">
      <div class="q-num">Card ${n}</div>
      <div class="flash-front">${esc(c.front)}</div>
      <div class="flash-back">${esc(c.back)}</div>
      ${c.explanation ? `<div class="expl">${esc(c.explanation)}</div>` : ''}
    </section>`;
  }

  function pageFor(c, i) {
    const type = c.type || (Array.isArray(c.choices) && c.choices.length >= 2 ? 'quiz' : 'flashcard');
    if (type === 'slide') return slidePage(c);
    if (type === 'quiz' || (Array.isArray(c.choices) && c.choices.length >= 2)) return quizPage(c, i);
    return flashPage(c, i);
  }

  const STYLES = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #0f1e35; }
    @page { size: A4 landscape; margin: 0; }
    .pg { width: 100%; min-height: 100vh; padding: 46px 54px; page-break-after: always; break-after: page; overflow: hidden; }
    .pg:last-child { page-break-after: auto; }

    /* slides */
    .slide { display: grid; gap: 40px; align-content: center; }
    .slide.two-col { grid-template-columns: 1fr 1.1fr; }
    .slide.one-col { grid-template-columns: 1fr; }
    .slide .col.media { display: flex; align-items: center; justify-content: center; }
    .slide .col.media img { width: 100%; height: 100%; max-height: 78vh; object-fit: cover; border-radius: 18px; }
    .slide .pk { color: #12b5a6; font-weight: 800; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 10px; }
    .slide h2 { font-family: "Space Grotesk", Inter, sans-serif; font-size: 40px; line-height: 1.08; margin: 0 0 20px; color: #0f1e35; }
    .slide ul { margin: 0; padding: 0; list-style: none; }
    .slide li { font-size: 21px; line-height: 1.5; margin: 0 0 16px; padding-left: 26px; position: relative; }
    .slide li::before { content: ""; position: absolute; left: 0; top: 12px; width: 10px; height: 10px; border-radius: 999px; background: #12b5a6; }
    .slide.layout-title h2 { font-size: 52px; }
    .slide.layout-title, .slide.layout-closing, .slide.layout-section { text-align: left; }
    .slide .stat strong { display: block; font-family: "Space Grotesk", Inter, sans-serif; font-size: 92px; line-height: 1; color: #0f1e35; }
    .slide .stat span { display: block; margin-top: 14px; font-size: 20px; color: #5a6b85; }
    .slide blockquote { font-size: 30px; font-style: italic; line-height: 1.35; margin: 0; }
    .slide blockquote cite { display: block; margin-top: 16px; font-size: 18px; font-style: normal; color: #5a6b85; }

    /* quiz + flashcards (portrait-ish, but keep landscape page) */
    .card { display: flex; flex-direction: column; justify-content: center; }
    .card .q-num { color: #2563ff; font-weight: 800; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 12px; }
    .card h3 { font-family: "Space Grotesk", Inter, sans-serif; font-size: 34px; margin: 0 0 26px; }
    .card .opts { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; max-width: 900px; }
    .card .opts li { font-size: 22px; padding: 16px 20px; border: 2px solid #dce6f5; border-radius: 12px; }
    .card .opts li.correct { border-color: #12b5a6; background: #eafaf5; font-weight: 600; }
    .card .opts li .tag { color: #0f9c8f; font-weight: 700; font-size: 15px; margin-left: 8px; }
    .card .flash-front { font-family: "Space Grotesk", Inter, sans-serif; font-size: 34px; margin-bottom: 20px; }
    .card .flash-back { font-size: 24px; line-height: 1.5; padding: 20px 24px; background: #f3f7ff; border-radius: 14px; max-width: 1000px; }
    .card .expl { margin-top: 22px; font-size: 18px; color: #5a6b85; max-width: 1000px; }

    .cover { display: flex; flex-direction: column; justify-content: center; }
    .cover .brand { font-family: "Space Grotesk", Inter, sans-serif; font-weight: 700; font-size: 20px; color: #2563ff; margin-bottom: 24px; }
    .cover h1 { font-family: "Space Grotesk", Inter, sans-serif; font-size: 56px; line-height: 1.05; margin: 0 0 16px; }
    .cover .meta { font-size: 20px; color: #5a6b85; }
  `;

  function buildDoc(set) {
    const cards = Array.isArray(set.cards) ? set.cards : [];
    const meta = [set.grade ? ('Grade ' + set.grade) : '', set.subject, set.topic].filter(Boolean).join('  ·  ');
    const cover = `<section class="pg cover">
      <div class="brand">Boardsy</div>
      <h1>${esc(set.title || 'Lesson')}</h1>
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
    </section>`;
    const pages = cards.map((c, i) => pageFor(c, i + 1)).join('');
    return `<!doctype html><html><head><meta charset="utf-8">
      <title>${esc(set.title || 'Lesson')}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
      <style>${STYLES}</style></head>
      <body>${cover}${pages}</body></html>`;
  }

  function exportSet(set) {
    if (!set || !Array.isArray(set.cards) || !set.cards.length) { alert('Nothing to export yet.'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to export the PDF.'); return; }
    w.document.open();
    w.document.write(buildDoc(set));
    w.document.close();
    // Wait for images + fonts, then open the print dialog.
    const go = () => {
      const imgs = Array.from(w.document.images || []);
      const pending = imgs.filter((im) => !im.complete);
      let left = pending.length;
      const fire = () => { try { w.focus(); w.print(); } catch (_) {} };
      if (!left) { setTimeout(fire, 350); return; }
      pending.forEach((im) => {
        const done = () => { left -= 1; if (left <= 0) setTimeout(fire, 250); };
        im.addEventListener('load', done); im.addEventListener('error', done);
      });
      // safety timeout in case an image hangs
      setTimeout(fire, 4000);
    };
    if (w.document.readyState === 'complete') go();
    else w.addEventListener('load', go);
  }

  window.ExportPdf = { export: exportSet, buildDoc };
})();
