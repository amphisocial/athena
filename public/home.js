/*
 * home.js — Boardsy homepage behaviour.
 *  - the scrolling product-headline ticker
 *  - the hero "stage" that auto-cycles gravity (3D physics) <-> parabola (graph),
 *    pausable so a visitor can stop on one and play with it
 *  - lazy-mounted 3D demos in the "See it live" grid
 *  - the Founding-30 application modal + form post
 * Reuses the dependency-free engines: window.AthenaViz3D and window.AthenaGraphDemo.
 */
(function () {
  'use strict';

  document.getElementById('yr').textContent = new Date().getFullYear();

  /* ---------------- scrolling headline ticker ---------------- */
  (function ticker() {
    const track = document.getElementById('tickerTrack');
    if (!track) return;
    const items = Array.from(track.children);
    if (items.length < 2) return;
    const step = () => items[0].getBoundingClientRect().height || 34;
    let idx = 0;
    setInterval(() => {
      idx = (idx + 1) % items.length;
      track.style.transition = 'transform .5s ease';
      track.style.transform = `translateY(-${idx * step()}px)`;
      // When we wrap to the top, snap without animation on the next tick.
      if (idx === 0) {
        setTimeout(() => { track.style.transition = 'none'; track.style.transform = 'translateY(0)'; }, 520);
      }
    }, 2600);
  })();

  /* ---------------- hero stage: gravity <-> parabola ---------------- */
  (function heroStage() {
    const stage = document.getElementById('heroStage');
    if (!stage) return;

    const ACETIC_ACID = null; // hero doesn't use molecule
    const mounts = {
      gravity: { el: document.getElementById('mountGravity'), handle: null,
        mount() { if (window.AthenaViz3D) this.handle = window.AthenaViz3D.mount(this.el, { kind: 'physics', type: 'freefall' }); } },
      parabola: { el: document.getElementById('mountParabola'), handle: null,
        mount() { if (window.AthenaGraphDemo) this.handle = window.AthenaGraphDemo.mount(this.el, { family: 'parabola' }); } }
    };
    const order = ['gravity', 'parabola'];
    const titles = { gravity: 'boardsy · free fall · F = mg', parabola: 'boardsy · y = ax² + bx + c' };

    const slides = Array.from(stage.querySelectorAll('.stage-slide'));
    const tabs = Array.from(stage.querySelectorAll('.stage-tab'));
    const titleEl = document.getElementById('stageTitle');
    const hintEl = document.getElementById('stageHint');
    const playBtn = document.getElementById('stagePlay');
    let cur = 'gravity';
    let playing = true;
    let timer = null;

    // Mount both engines up front so switching is instant; they're light.
    mounts.gravity.mount();
    mounts.parabola.mount();

    function show(name) {
      cur = name;
      slides.forEach((s) => s.classList.toggle('active', s.dataset.slide === name));
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.go === name));
      if (titleEl) titleEl.textContent = titles[name];
    }
    function advance() {
      const next = order[(order.indexOf(cur) + 1) % order.length];
      show(next);
    }
    function start() {
      playing = true; playBtn.textContent = '⏸ Pause'; playBtn.setAttribute('aria-pressed', 'false');
      hintEl.textContent = 'auto-cycling · tap a tab to play';
      clearInterval(timer); timer = setInterval(advance, 5200);
    }
    function stop() {
      playing = false; playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-pressed', 'true');
      hintEl.textContent = 'paused — drag the sliders / hit ▶ Drop';
      clearInterval(timer);
    }

    playBtn.addEventListener('click', () => (playing ? stop() : start()));
    tabs.forEach((t) => t.addEventListener('click', () => { show(t.dataset.go); stop(); }));

    // Pause auto-cycle while the visitor is interacting inside the stage body.
    const body = stage.querySelector('.stage-body');
    body.addEventListener('pointerdown', () => { if (playing) stop(); });

    show('gravity');
    start();
  })();

  /* ---------------- "See it live" 3D demos (lazy) ---------------- */
  (function demos() {
    if (!window.AthenaViz3D) return;
    const ACETIC_ACID = {
      kind: 'molecule', name: 'acetic acid', formula: 'CH3COOH',
      atoms: [
        { el: 'C', x: -0.86, y: 0.00, z: 0.00 }, { el: 'H', x: -1.24, y: 1.02, z: 0.00 },
        { el: 'H', x: -1.24, y: -0.51, z: 0.89 }, { el: 'H', x: -1.24, y: -0.51, z: -0.89 },
        { el: 'C', x: 0.66, y: 0.00, z: 0.00 }, { el: 'O', x: 1.29, y: 1.05, z: 0.00 },
        { el: 'O', x: 1.31, y: -1.16, z: 0.00 }, { el: 'H', x: 2.27, y: -1.06, z: 0.00 }
      ],
      bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1],[4,5,2],[4,6,1],[6,7,1]]
    };
    const specFor = (kind) => {
      if (kind === 'molecule') return ACETIC_ACID;
      if (kind === 'solid') return { kind: 'solid', shape: 'cube', dims: { a: 2 }, label: 'Cube' };
      if (kind === 'pendulum') return { kind: 'physics', type: 'pendulum' };
      return { kind: 'physics', type: 'freefall' };
    };
    const holders = Array.from(document.querySelectorAll('.demo-holder'));
    const mounted = new WeakSet();
    const handles = [];
    function mountInto(el) {
      if (mounted.has(el)) return; mounted.add(el);
      try {
        const h = window.AthenaViz3D.mount(el, specFor(el.dataset.demo));
        handles.push(h);
        while (handles.length > 4) { try { handles.shift().dispose(); } catch (_) {} }
      } catch (_) {}
    }
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { mountInto(e.target); io.unobserve(e.target); } });
      }, { rootMargin: '140px' });
      holders.forEach((h) => io.observe(h));
    } else {
      holders.forEach(mountInto);
    }
  })();

  /* ---------------- Founding-30 modal + form ---------------- */
  (function founding() {
    const modal = document.getElementById('foundingModal');
    const openers = ['ctaFounding', 'ctaFoundingPricing', 'footerContact', 'navPlans']
      .map((id) => document.getElementById(id)).filter(Boolean);
    // navPlans is a link to /board; only intercept the pure-contact triggers.
    ['ctaFounding', 'ctaFoundingPricing', 'footerContact'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => { e.preventDefault(); open(); });
    });
    function open() { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
    function close() { modal.classList.remove('open'); document.body.style.overflow = ''; }
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const form = document.getElementById('foundingForm');
    const status = document.getElementById('foundingStatus');
    const submit = document.getElementById('foundingSubmit');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.className = 'form-status'; status.textContent = '';
      const data = Object.fromEntries(new FormData(form).entries());
      if (data.company_website) { status.textContent = 'Thanks!'; return; } // honeypot
      if (!data.email || !data.firstName) { status.className = 'form-status err'; status.textContent = 'Please add your name and school email.'; return; }
      submit.disabled = true; submit.textContent = 'Sending…';
      try {
        const res = await fetch('/api/founding/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) {
          status.className = 'form-status ok';
          status.textContent = "You're in the queue — we'll email you shortly. Thank you!";
          form.reset();
        } else {
          status.className = 'form-status err';
          status.textContent = out.error || 'Something went wrong. Please try again.';
        }
      } catch (_) {
        status.className = 'form-status err';
        status.textContent = 'Network error. Please try again in a moment.';
      } finally {
        submit.disabled = false; submit.textContent = 'Apply as a founding teacher';
      }
    });
  })();
})();
