/*
 * board.js — the Boardsy sandbox board.
 *
 * Everything here is client-only: a visitor can open any Math/Science board,
 * run the live simulation, and draw over it — with no login and no server.
 * Signing in (to save / go live) routes to the full app; the Plans modal shows
 * Pro vs Teams, a 7-day trial, and the Founding-30 contact.
 */
(function () {
  'use strict';

  // Where the full product (auth, billing, save, live) lives. The server can
  // inject window.BOARDSY_APP_BASE; if it's absent we route sign-in/trial CTAs
  // to the Founding-30 contact so nothing dead-ends.
  const APP_BASE = (window.BOARDSY_APP_BASE || '').replace(/\/+$/, '');
  const appUrl = (target) => (APP_BASE ? `${APP_BASE}/${target}` : '/#founding');

  const ACETIC_ACID = {
    kind: 'molecule', name: 'acetic acid', formula: 'CH3COOH',
    atoms: [
      { el: 'C', x: -0.86, y: 0, z: 0 }, { el: 'H', x: -1.24, y: 1.02, z: 0 },
      { el: 'H', x: -1.24, y: -0.51, z: 0.89 }, { el: 'H', x: -1.24, y: -0.51, z: -0.89 },
      { el: 'C', x: 0.66, y: 0, z: 0 }, { el: 'O', x: 1.29, y: 1.05, z: 0 },
      { el: 'O', x: 1.31, y: -1.16, z: 0 }, { el: 'H', x: 2.27, y: -1.06, z: 0 }
    ],
    bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1],[4,5,2],[4,6,1],[6,7,1]]
  };

  // ---- The catalog: Math & Science only. Each maps to a live engine. ----
  const TEMPLATES = [
    // Math
    { id: 'quadratic', subject: 'Math', name: 'Quadratic graph', std: 'Common Core 8.F / A-REI',
      blurb: 'y = ax² + bx + c. Drag a, b, c and watch the parabola move.',
      instruction: 'Drag the <b>a</b>, <b>b</b> and <b>c</b> sliders and watch the parabola open, tilt and lift.',
      render: { engine: 'graph', family: 'parabola' } },
    { id: 'linear', subject: 'Math', name: 'Straight line', std: 'Common Core 8.F',
      blurb: 'y = mx + b. Sliders for slope and intercept.',
      instruction: 'Drag <b>m</b> (slope) and <b>b</b> (intercept) to see how each moves the line.',
      render: { engine: 'graph', family: 'line' } },
    { id: 'sine', subject: 'Math', name: 'Sine wave', std: 'Common Core F-TF',
      blurb: 'y = A·sin(Bx) + D. Amplitude, frequency, shift.',
      instruction: 'Change <b>A</b>, <b>B</b> and <b>D</b> to stretch, squeeze and lift the wave.',
      render: { engine: 'graph', family: 'sine' } },
    { id: 'solid', subject: 'Math', name: '3D solid', std: 'Common Core 6.G / 7.G',
      blurb: 'A rotatable cube with surface area & volume.',
      instruction: 'Drag to rotate the solid. Surface area and volume are worked out alongside.',
      render: { engine: 'viz', spec: { kind: 'solid', shape: 'cube', dims: { a: 2 }, label: 'Cube (a = 2)' } } },

    // Science
    { id: 'newton', subject: 'Science', name: "Newton's laws · free fall", std: 'NGSS MS-PS2-2',
      blurb: 'Drop a stone and a feather in real gravity.',
      instruction: 'Hit <b>▶ Drop</b>. Toggle air resistance and switch to Moon gravity to compare.',
      render: { engine: 'viz', spec: { kind: 'physics', type: 'freefall' } } },
    { id: 'incline', subject: 'Science', name: 'Block on a wedge', std: 'NGSS MS-PS2-2',
      blurb: 'a = g(sinθ − μcosθ). Change angle, friction, mass.',
      instruction: 'Run it, then change the angle, friction (μ) and mass — the slide point ignores mass.',
      render: { engine: 'viz', spec: { kind: 'physics', type: 'incline' } } },
    { id: 'pendulum', subject: 'Science', name: 'Pendulum', std: 'NGSS MS-PS2 / MS-PS3',
      blurb: 'T = 2π√(L/g). Change length and gravity.',
      instruction: 'Run it and change length and gravity — the period ignores the bob\'s mass.',
      render: { engine: 'viz', spec: { kind: 'physics', type: 'pendulum' } } },
    { id: 'projectile', subject: 'Science', name: 'Projectile motion', std: 'NGSS MS-PS2',
      blurb: 'Launch angle & speed trace a real parabola.',
      instruction: 'Launch it. Change the angle and speed and watch the arc — a parabola in the air.',
      render: { engine: 'viz', spec: { kind: 'physics', type: 'projectile' } } },
    { id: 'reflection', subject: 'Science', name: 'Laws of reflection', std: 'NGSS MS-PS4-2',
      blurb: 'Rays on flat, concave and convex mirrors.',
      instruction: 'Send parallel rays at the mirrors and find the focus (f = R/2 for concave).',
      render: { engine: 'viz', spec: { kind: 'physics', type: 'reflection' } } },
    { id: 'molecule', subject: 'Science', name: '3D molecule', std: 'NGSS MS-PS1',
      blurb: 'Rotate acetic acid; click an atom for its shells.',
      instruction: 'Drag to rotate the molecule, then click any atom to zoom into its electron shells.',
      render: { engine: 'viz', spec: ACETIC_ACID } }
  ];

  const bySubject = (s) => TEMPLATES.filter((t) => t.subject === s);
  const findTpl = (id) => TEMPLATES.find((t) => t.id === id);

  // ---- DOM ----
  const els = {
    title: document.getElementById('btTitle'),
    picker: document.getElementById('picker'),
    pickerSubj: document.getElementById('pickerSubj'),
    pickerGrid: document.getElementById('pickerGrid'),
    board: document.getElementById('board'),
    instruction: document.getElementById('boardInstruction'),
    std: document.getElementById('boardStd'),
    simMount: document.getElementById('simMount'),
    canvasWrap: document.getElementById('canvasWrap'),
    annot: document.getElementById('annotCanvas'),
    subjTabs: document.getElementById('subjTabs'),
    tplList: document.getElementById('tplList'),
    toolsSec: document.getElementById('toolsSec'),
    drawToggle: document.getElementById('drawToggle'),
    drawToggleLabel: document.getElementById('drawToggleLabel'),
    modeHint: document.getElementById('modeHint'),
    penTools: document.getElementById('penTools'),
    swatches: document.getElementById('swatches'),
    undoBtn: document.getElementById('undoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    plansBtn: document.getElementById('btPlans'),
    plansModal: document.getElementById('plansModal')
  };

  let currentSubject = 'Math';
  let currentSim = null;   // dispose handle from the engine

  // ---------------- picker + rail rendering ----------------
  function renderPickerGrid() {
    els.pickerGrid.innerHTML = '';
    bySubject(currentSubject).forEach((t) => {
      const card = document.createElement('button');
      card.className = 'pcard';
      card.innerHTML =
        `<span class="pc-name">${t.name}</span>` +
        `<span class="pc-blurb">${t.blurb}</span>` +
        `<span class="pc-std">${t.std}</span>` +
        `<span class="pc-go">Open the board →</span>`;
      card.addEventListener('click', () => loadTemplate(t.id));
      els.pickerGrid.appendChild(card);
    });
  }
  function renderRailList() {
    els.tplList.innerHTML = '';
    bySubject(currentSubject).forEach((t) => {
      const item = document.createElement('button');
      item.className = 'tpl-item' + (activeId === t.id ? ' active' : '');
      item.dataset.id = t.id;
      item.innerHTML = `<span class="t-name">${t.name}</span><span class="t-std">${t.std}</span>`;
      item.addEventListener('click', () => loadTemplate(t.id));
      els.tplList.appendChild(item);
    });
  }
  function setSubject(s) {
    currentSubject = s;
    els.pickerSubj.querySelectorAll('.psubj').forEach((b) => b.classList.toggle('active', b.dataset.subj === s));
    els.subjTabs.querySelectorAll('.subj-tab').forEach((b) => b.classList.toggle('active', b.dataset.subj === s));
    renderPickerGrid();
    renderRailList();
  }
  els.pickerSubj.addEventListener('click', (e) => { const b = e.target.closest('.psubj'); if (b) setSubject(b.dataset.subj); });
  els.subjTabs.addEventListener('click', (e) => { const b = e.target.closest('.subj-tab'); if (b) setSubject(b.dataset.subj); });

  // ---------------- loading a template ----------------
  let activeId = null;
  function loadTemplate(id) {
    const t = findTpl(id);
    if (!t) return;
    activeId = id;
    if (t.subject !== currentSubject) setSubject(t.subject); else renderRailList();

    els.picker.hidden = true;
    els.board.hidden = false;
    els.title.textContent = t.name;
    els.instruction.innerHTML = t.instruction;
    els.std.textContent = t.std;

    // clear any annotation strokes for the new board
    strokes.length = 0; redraw();

    // dispose the previous engine and mount the new one
    if (currentSim && currentSim.dispose) { try { currentSim.dispose(); } catch (_) {} }
    els.simMount.innerHTML = '';
    try {
      if (t.render.engine === 'graph' && window.AthenaGraphDemo) {
        currentSim = window.AthenaGraphDemo.mount(els.simMount, { family: t.render.family });
      } else if (window.AthenaViz3D) {
        currentSim = window.AthenaViz3D.mount(els.simMount, t.render.spec);
      }
    } catch (_) { /* a failed sim shouldn't break the page */ }

    // Reset to interact mode on each new board.
    setDraw(false);
    sizeCanvas();
    // reflect selection in the URL without a reload
    try { history.replaceState(null, '', `/board?subject=${t.subject.toLowerCase()}&template=${t.id}`); } catch (_) {}
  }

  // ---------------- annotation layer ----------------
  const ctx = els.annot.getContext('2d');
  let drawMode = false;
  let tool = 'pen';
  let color = '#22e0cf';
  const strokes = [];        // [{ tool, color, size, pts:[{x,y}] }]
  let drawing = null;
  let dpr = 1;

  const COLORS = ['#22e0cf', '#ffffff', '#ffd27a', '#4d8cff', '#ff8fa3'];
  (function buildSwatches() {
    COLORS.forEach((c, i) => {
      const s = document.createElement('button');
      s.className = 'swatch' + (i === 0 ? ' active' : '');
      s.style.background = c; s.dataset.color = c; s.title = 'Ink';
      s.addEventListener('click', () => {
        color = c; tool = 'pen';
        els.swatches.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === s));
        els.penTools.querySelectorAll('.tool-btn').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'pen'));
      });
      els.swatches.appendChild(s);
    });
  })();

  function setDraw(on) {
    drawMode = on;
    els.canvasWrap.classList.toggle('draw', on);
    els.drawToggle.setAttribute('aria-pressed', String(on));
    els.drawToggleLabel.textContent = `Draw mode: ${on ? 'on' : 'off'}`;
    els.penTools.hidden = !on;
    els.swatches.hidden = !on;
    els.modeHint.textContent = on
      ? 'Pointer draws on the board. Turn off to rotate / run the simulation.'
      : 'Pointer controls the simulation. Turn on Draw to write over the board.';
  }
  els.drawToggle.addEventListener('click', () => setDraw(!drawMode));
  els.penTools.addEventListener('click', (e) => {
    const b = e.target.closest('.tool-btn'); if (!b) return;
    if (b.dataset.tool) {
      tool = b.dataset.tool;
      els.penTools.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
    }
  });
  els.undoBtn.addEventListener('click', () => { strokes.pop(); redraw(); });
  els.clearBtn.addEventListener('click', () => { strokes.length = 0; redraw(); });

  function sizeCanvas() {
    const r = els.canvasWrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.annot.width = Math.max(1, Math.round(r.width * dpr));
    els.annot.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  window.addEventListener('resize', sizeCanvas);

  function redraw() {
    const r = els.annot.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    for (const s of strokes) drawStroke(s);
  }
  function drawStroke(s) {
    if (s.pts.length < 1) return;
    ctx.save();
    ctx.lineJoin = ctx.lineCap = 'round';
    if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 26; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.shadowColor = s.color; ctx.shadowBlur = 6; }
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
    ctx.stroke();
    ctx.restore();
  }
  function pos(e) {
    const r = els.annot.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  els.annot.addEventListener('pointerdown', (e) => {
    if (!drawMode) return;
    els.annot.setPointerCapture(e.pointerId);
    drawing = { tool, color, size: 3, pts: [pos(e)] };
    strokes.push(drawing);
  });
  els.annot.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    drawing.pts.push(pos(e));
    redraw();
  });
  const endStroke = () => { drawing = null; };
  els.annot.addEventListener('pointerup', endStroke);
  els.annot.addEventListener('pointercancel', endStroke);
  els.annot.addEventListener('pointerleave', endStroke);

  // ---------------- plans modal ----------------
  function openPlans() { els.plansModal.classList.add('open'); }
  function closePlans() { els.plansModal.classList.remove('open'); }
  els.plansBtn.addEventListener('click', openPlans);
  els.plansModal.addEventListener('click', (e) => {
    if (e.target === els.plansModal || e.target.hasAttribute('data-close')) closePlans();
    const app = e.target.closest('[data-app]');
    if (app) { e.preventDefault(); window.location.href = appUrl(app.dataset.app); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlans(); });

  // ---------------- boot: honour ?subject / ?template ----------------
  function boot() {
    const params = new URLSearchParams(location.search);
    const wantSubj = (params.get('subject') || '').toLowerCase();
    const wantTpl = params.get('template');
    if (params.get('plan')) openPlans();

    if (wantSubj === 'science') setSubject('Science'); else setSubject('Math');

    if (wantTpl && findTpl(wantTpl)) {
      loadTemplate(wantTpl);
    } else if (wantSubj && (wantSubj === 'math' || wantSubj === 'science')) {
      // subject given but no template — show the picker on that subject
      setSubject(wantSubj === 'science' ? 'Science' : 'Math');
    }
    // otherwise the picker stays up on Math
  }
  boot();
})();
