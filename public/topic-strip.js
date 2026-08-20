/* topic-strip.js — a compact, topic-aware navigation bar shared by the lesson
 * player (app.js) and the whiteboard (board.js). When a page is opened on a
 * curriculum topic, it shows the topic + key metadata and one-tap links to the
 * teacher's Slides / Flashcards / Quiz / Whiteboard for that SAME topic, so the
 * user can move between all four content types without leaving the topic.
 *
 *   window.TopicStrip.mount({
 *     mode: 'inline' | 'floating',   // inline = normal flow (lesson page)
 *     currentKind: 'lesson' | 'board',
 *     currentId: '<set or board id>',
 *     topicId, topic, subject, grade  // hints; the server also infers from id
 *   });
 *
 * It self-manages: called with no topic (or a topic-less item) it removes any
 * existing strip. It de-dupes so repeated calls for the same item don't reflow.
 */
(function () {
  'use strict';

  const C = window.AppCommon || {};
  const api = C.api;
  const esc = C.escapeHtml || ((v) => String(v == null ? '' : v));

  const FORMATS = [
    { key: 'slides', label: 'Slides', icon: '🖥', start: 'lesson', fmt: 'slides' },
    { key: 'flashcard', label: 'Flashcards', icon: '🗂', start: 'lesson', fmt: 'flashcard' },
    { key: 'quiz', label: 'Quiz', icon: '❓', start: 'lesson', fmt: 'quiz' },
    { key: 'whiteboard', label: 'Whiteboard', icon: '🖊', start: 'whiteboard', fmt: '' }
  ];

  let lastKey = null;

  const CAP = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
  const gradeLabel = (g) => (g === '' || g == null ? '' : (/^grade/i.test(String(g)) ? String(g) : `Grade ${g}`));

  function hrefFor(entry) {
    if (!entry || !entry.id) return '';
    return entry.kind === 'board' ? `/board/${encodeURIComponent(entry.id)}` : `/app?set=${encodeURIComponent(entry.id)}`;
  }

  // Where a missing format should send a signed-in teacher to create it: the
  // Library's topic handoff, which opens the prefilled New dialog.
  function createHref(fmtDef, topic) {
    const p = new URLSearchParams({ start: fmtDef.start });
    if (topic.id) p.set('id', topic.id);
    if (topic.title) p.set('topic', topic.title);
    if (topic.grade !== '' && topic.grade != null) p.set('grade', String(topic.grade));
    if (topic.subject) p.set('subject', String(topic.subject).toLowerCase());
    if (fmtDef.fmt) p.set('format', fmtDef.fmt);
    return `/library?${p.toString()}`;
  }

  function removeStrip() {
    const existing = document.querySelector('.topic-strip');
    if (existing) existing.remove();
  }

  function place(node, mode) {
    if (mode === 'floating') {
      node.classList.add('floating');
      document.body.appendChild(node);
      return;
    }
    // Inline: sit at the very top of the page's main content.
    const main = document.querySelector('main.app-page') || document.querySelector('main') || document.body;
    main.insertBefore(node, main.firstChild);
  }

  function render(opts, data) {
    removeStrip();
    const topic = data.topic;
    const nav = data.nav || {};
    const currentId = opts.currentId || '';

    const metaBits = [gradeLabel(topic.grade), CAP(topic.subject), topic.standard].filter(Boolean).join(' · ');

    const chips = FORMATS.map((f) => {
      const entry = nav[f.key];
      const isCurrent = Boolean(entry && (entry.current || (entry.id && entry.id === currentId)));
      if (entry && entry.id) {
        const cls = `ts-chip has${isCurrent ? ' current' : ''}${entry.owned ? '' : ' shared'}`;
        const title = isCurrent ? `You're viewing this ${f.label.toLowerCase()}`
          : (entry.owned ? `Open your ${f.label.toLowerCase()} for this topic` : `Open a shared ${f.label.toLowerCase()} for this topic`);
        return `<a class="${cls}" href="${hrefFor(entry)}" title="${esc(title)}"${isCurrent ? ' aria-current="true"' : ''}>
          <span class="ts-ico">${f.icon}</span><span class="ts-lbl">${f.label}</span></a>`;
      }
      // Missing: signed-in teachers get a create link; others see a muted chip.
      if (data.signedIn) {
        return `<a class="ts-chip make" href="${createHref(f, topic)}" title="Create ${f.label.toLowerCase()} for this topic">
          <span class="ts-ico">＋</span><span class="ts-lbl">${f.label}</span></a>`;
      }
      return `<span class="ts-chip off" title="Not available yet"><span class="ts-ico">${f.icon}</span><span class="ts-lbl">${f.label}</span></span>`;
    }).join('');

    const node = document.createElement('div');
    node.className = 'topic-strip';
    node.innerHTML = `
      <div class="ts-inner">
        <div class="ts-topic">
          <span class="ts-kicker">Topic</span>
          <span class="ts-title" title="${esc(topic.title)}">${esc(topic.title)}</span>
          ${metaBits ? `<span class="ts-meta">${esc(metaBits)}</span>` : ''}
        </div>
        <nav class="ts-chips" aria-label="Content for this topic">${chips}</nav>
      </div>`;

    if (opts.mode === 'floating') {
      const collapse = document.createElement('button');
      collapse.className = 'ts-collapse';
      collapse.type = 'button';
      collapse.title = 'Hide topic bar';
      collapse.setAttribute('aria-label', 'Hide topic bar');
      collapse.textContent = '✕';
      collapse.addEventListener('click', () => node.classList.toggle('collapsed'));
      node.querySelector('.ts-inner').appendChild(collapse);
    }

    place(node, opts.mode || 'inline');
  }

  async function mount(opts) {
    if (!api || !opts) return;
    const key = `${opts.currentKind || ''}:${opts.currentId || ''}:${opts.topicId || ''}:${opts.topic || ''}`;
    // No topic context at all → clear any existing strip and stop.
    if (!opts.topicId && !opts.topic) { removeStrip(); lastKey = null; return; }
    if (key === lastKey && document.querySelector('.topic-strip')) return; // already showing

    let data;
    try {
      const qs = new URLSearchParams();
      if (opts.topicId) qs.set('topicId', opts.topicId);
      if (opts.topic) qs.set('topic', opts.topic);
      if (opts.subject) qs.set('subject', String(opts.subject).toLowerCase());
      if (opts.grade !== '' && opts.grade != null) qs.set('grade', String(opts.grade));
      if (opts.currentId) qs.set('currentId', opts.currentId);
      if (opts.currentKind) qs.set('currentKind', opts.currentKind);
      data = await api(`/api/topic/nav?${qs.toString()}`);
    } catch (_) { return; }

    if (!data || !data.topic) { removeStrip(); lastKey = null; return; }
    lastKey = key;
    render(opts, data);
  }

  window.TopicStrip = { mount, remove: () => { removeStrip(); lastKey = null; } };
})();
