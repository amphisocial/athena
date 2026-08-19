/*
 * Athena Whiteboard (Phase 1+)
 * -----------------------------------------------------------------------
 * A teacher can have several SAVED boards (like documents), but only ever
 * one LIVE board at a time — going live on one automatically takes any
 * other board off live. Viewers (people on the teacher's team roster, see
 * server/team.js) can only join a board that is both `shared: true` and
 * currently live; saved-but-not-live boards are private editing space for
 * the teacher only.
 *
 * Board data lives in its own file, data/board-data.json, kept separate
 * from data/store.json (users/sessions/study sets) so frequent drawing
 * writes never contend with the file everything else depends on.
 *
 * Exposes:
 *   attachBoardRoutes(app, deps)         - REST endpoints
 *   attachBoardWebSocket(server, deps)   - live sync + presence + AI actions
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board-data.json');

const MAX_STROKES_PER_PAGE = 4000;
const MAX_BOARDS_PER_TEACHER = 20;
const MAX_PAGES_PER_BOARD = 20;
const MAX_BACKGROUND_CHARS = 2_800_000; // ~2MB once base64-encoded

const db = require('./db');

function ensureBoardStore() { /* schema created in db.init() */ }

// Boards created by the first whiteboard release predate the title/shared/
// isLive fields. Backfill them on read so old boards don't render blank or
// behave as though those flags were explicitly set to something.
function normalizeBoard(board, index) {
  if (typeof board.title !== 'string' || !board.title.trim()) {
    board.title = `Whiteboard ${index + 1}`;
  }
  board.shared = Boolean(board.shared);
  board.isLive = Boolean(board.isLive);
  board.aiNotes ||= [];
  migrateBoardShape(board);
  return board;
}

function readBoardStore() {
  const store = db.readBoardStore();
  (store.boards || []).forEach(normalizeBoard);
  return store;
}

function writeBoardStore(store) {
  db.writeBoardStore(store);
}

function boardId(prefix = 'brd') {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

// Template catalog shared with the client picker. Seeding a board writes a
// starter text object (equation or label) plus an instruction note onto the
// first page, so the teacher lands on a canvas ready to Analyze.
let BOARD_TEMPLATES = [];
try {
  ({ BOARD_TEMPLATES } = require('../public/board-templates.js'));
} catch (_) { BOARD_TEMPLATES = []; }

function seedBoardFromTemplate(board, templateId) {
  if (!templateId || templateId === 'blank') return;
  const tpl = BOARD_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl || !tpl.seed) return;
  const page = board.pages[0];
  const mkObj = (text, x, y, opts = {}) => ({
    id: `obj_${crypto.randomBytes(6).toString('hex')}`,
    type: opts.note ? 'note' : 'text',
    x, y,
    w: opts.note ? 300 : 420,
    h: opts.note ? 120 : 48,
    text,
    color: opts.note ? '#ffcc66' : '#eef6ff'
  });
  const objs = [];
  const main = tpl.seed.equation || tpl.seed.label;
  if (main) objs.push(mkObj(main, 120, 120));
  if (tpl.seed.instruction) objs.push(mkObj(tpl.seed.instruction, 120, 220, { note: true }));
  page.objects.push(...objs);
  // Give math templates a coordinate grid, science a blank surface.
  if (['quadratic', 'linear'].includes(templateId)) page.template = 'coordinate';
  board.seededFrom = templateId;
}

function nowIso() {
  return new Date().toISOString();
}

function newPage(template) {
  return {
    id: boardId('pg'),
    template: template || 'blank',
    background: null,
    strokes: [],
    objects: []
  };
}

// Boards used to be a single flat surface (`board.strokes`). Multi-page moves
// that content into `pages[0]` so existing boards keep every stroke they had.
function migrateBoardShape(board) {
  if (!Array.isArray(board.pages) || !board.pages.length) {
    const first = newPage('blank');
    if (Array.isArray(board.strokes)) first.strokes = board.strokes;
    board.pages = [first];
  }
  delete board.strokes;
  board.pages.forEach((page) => {
    page.id ||= boardId('pg');
    page.template ||= 'blank';
    page.background ||= null;
    page.strokes ||= [];
    page.objects ||= [];
  });
  // AI Notes generated during any session are archived on the board itself,
  // so they survive the teacher going offline and are visible to students
  // whenever the board is open to them.
  board.insights ||= [];
  return board;
}

function boardSummary(board) {
  return {
    id: board.id,
    teacherId: board.teacherId,
    title: board.title,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    shared: Boolean(board.shared),
    isLive: Boolean(board.isLive),
    publicToken: board.publicToken || null,
    subject: board.subject || null,
    grade: board.grade || '',
    topic: board.topic || '',
    topicId: board.topicId || '',
    public: Boolean(board.public),
    rating: board.rating || { sum: 0, count: 0 },
    pageCount: board.pages.length,
    strokeCount: board.pages.reduce((n, p) => n + p.strokes.length, 0)
  };
}

// Only an allowlisted character set is ever compiled/rendered client-side
// for a plotted expression (see public/board.js compileExpression) — this
// mirrors that allowlist so a bad AI extraction from "read the equation on
// this selection" fails loudly server-side rather than reaching a viewer's
// browser as unvalidated text.
const SAFE_EXPRESSION_RE = /^[a-zA-Z0-9\s.+\-*/^()=]+$/;

function isSafeExpression(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (!SAFE_EXPRESSION_RE.test(trimmed)) return false;
  return true;
}

// ---------------------------------------------------------------------
// REST routes
// ---------------------------------------------------------------------
function attachBoardRoutes(app, deps) {
  const { requireUser, readStore, emailOnRoster, canViewTeachersContent, userHasWhiteboardAccess, userHasLiveAccess, boardLimitFor, notifyTeamOfShare, APP_BASE_URL, askVisionAI, generateWithProvider, saveGeneratedSet, canCreateSet } = deps;
  // canViewTeachersContent = on the team roster OR invited under the older
  // per-study-set model. Whiteboard access used to be granted purely by the
  // latter, so checking only the roster silently cut off every student who
  // already had access before the roster existed.
  const viewerAllowed = canViewTeachersContent || ((store, teacherId, email) => emailOnRoster(store, teacherId, email));

  function requireWhiteboardPlan(req, res) {
    if (!userHasWhiteboardAccess(req.user)) {
      res.status(403).json({ error: 'Whiteboards are on the Pro and Teams plans. Start a free 7-day trial to try them.' });
      return false;
    }
    return true;
  }

  // Live collaboration (go live, questions, real-time viewers) is Teams-only.
  function requireLivePlan(req, res) {
    if (!(userHasLiveAccess && userHasLiveAccess(req.user))) {
      res.status(403).json({ error: 'Live classrooms are on the Teams plan. Pro can still share a static board link. Start a free 7-day Teams trial to go live.' });
      return false;
    }
    return true;
  }

  // Every shared board gets a stable public token so anyone with the link can
  // open a no-login, read-only copy (and study from it). Idempotent.
  function ensurePublicToken(board) {
    if (!board.publicToken) board.publicToken = boardId('pub').replace('pub_', 'pub');
    return board.publicToken;
  }

  // Normalize teacher-supplied metadata (subject / grade / topic / public).
  function sanitizeBoardMeta(body) {
    const subjectRaw = String(body.subject || '').toLowerCase();
    const subject = ['math', 'science'].includes(subjectRaw) ? subjectRaw : null;
    return {
      subject,
      grade: String(body.grade || '').trim().slice(0, 40),
      topic: String(body.topic || '').trim().slice(0, 80),
      // Curriculum topic id (set when the board was started from a topic), so
      // in-session polls/team quizzes can be scoped to this exact topic — the
      // same way lessons are keyed by topicId.
      topicId: String(body.topicId || '').trim().slice(0, 80),
      public: Boolean(body.public)
    };
  }

  function findBoard(store, boardIdParam) {
    return store.boards.find((b) => b.id === boardIdParam);
  }

  // ---- Teacher: manage saved boards --------------------------------------
  app.get('/api/board/mine/list', requireUser, (req, res) => {
    if (!requireWhiteboardPlan(req, res)) return;
    const store = readBoardStore();
    const boards = store.boards
      .filter((b) => b.teacherId === req.user.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(boardSummary);
    res.json({ boards });
  });

  app.post('/api/board/mine/new', requireUser, (req, res) => {
    if (!requireWhiteboardPlan(req, res)) return;
    const store = readBoardStore();
    const existing = store.boards.filter((b) => b.teacherId === req.user.id);
    const limit = (boardLimitFor && boardLimitFor(req.user)) || MAX_BOARDS_PER_TEACHER;
    if (existing.length >= limit) {
      const msg = limit === 1
        ? 'The Free plan includes 1 whiteboard. Delete it, or start a free trial of Pro/Teams for more.'
        : `You've reached your ${limit}-board limit. Delete an old board to make room.`;
      return res.status(400).json({ error: msg });
    }
    const title = String(req.body.title || '').trim().slice(0, 80) || `Untitled board ${existing.length + 1}`;
    const meta = sanitizeBoardMeta(req.body);
    const board = {
      id: boardId(),
      teacherId: req.user.id,
      title,
      subject: meta.subject,
      grade: meta.grade,
      topic: meta.topic,
      topicId: meta.topicId,
      public: meta.public,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      shared: false,
      isLive: false,
      strokes: [],
      aiNotes: []
    };
    if (board.public) ensurePublicToken(board);
    migrateBoardShape(board); // gives it pages[0]
    // Seed starter content from the chosen template (if any).
    seedBoardFromTemplate(board, req.body.template);
    store.boards.push(board);
    writeBoardStore(store);
    // Creating a board is a qualifying action for referral rewards.
    if (deps.onContentCreated) deps.onContentCreated(req.user);
    res.json({ board: boardSummary(board) });
  });

  app.post('/api/board/:boardId/save', requireUser, (req, res) => {
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    if (req.body.title !== undefined) board.title = String(req.body.title).trim().slice(0, 80) || board.title;
    if (req.body.subject !== undefined) { const s = String(req.body.subject).toLowerCase(); board.subject = ['math', 'science'].includes(s) ? s : null; }
    if (req.body.grade !== undefined) board.grade = String(req.body.grade).trim().slice(0, 40);
    if (req.body.topic !== undefined) board.topic = String(req.body.topic).trim().slice(0, 80);
    if (req.body.public !== undefined) {
      board.public = Boolean(req.body.public);
      // A public board is discoverable, so it also needs a public link.
      if (board.public) ensurePublicToken(board);
    }
    board.updatedAt = nowIso();
    writeBoardStore(store);
    res.json({ board: boardSummary(board) });
  });

  app.delete('/api/board/:boardId', requireUser, (req, res) => {
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    store.boards = store.boards.filter((b) => b.id !== req.params.boardId);
    writeBoardStore(store);
    res.json({ ok: true });
  });

  app.post('/api/board/:boardId/share-toggle', requireUser, (req, res) => {
    if (!requireWhiteboardPlan(req, res)) return;
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    const wasShared = Boolean(board.shared);
    board.shared = Boolean(req.body.shared);
    if (board.shared) ensurePublicToken(board);
    board.updatedAt = nowIso();
    writeBoardStore(store);
    if (board.shared && !wasShared && notifyTeamOfShare) {
      notifyTeamOfShare({
        store: readStore(),
        owner: req.user,
        title: board.title,
        url: `${APP_BASE_URL}/board/${board.id}`,
        kind: 'whiteboard'
      });
    }
    res.json({ board: boardSummary(board) });
  });

  // Going live on one board automatically takes any other board this
  // teacher owns off live — a teacher can only ever broadcast one board.
  app.post('/api/board/:boardId/go-live', requireUser, (req, res) => {
    if (!requireLivePlan(req, res)) return;
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    store.boards.forEach((b) => { if (b.teacherId === req.user.id) b.isLive = false; });
    const wasShared = Boolean(board.shared);
    board.isLive = true;
    // Going live on a board nobody can see is never what's intended, so
    // going live also shares it. Unshare/stop-live remain separate.
    board.shared = true;
    ensurePublicToken(board);
    board.updatedAt = nowIso();
    writeBoardStore(store);
    if (!wasShared && notifyTeamOfShare) {
      notifyTeamOfShare({
        store: readStore(),
        owner: req.user,
        title: board.title,
        url: `${APP_BASE_URL}/board/${board.id}`,
        kind: 'live whiteboard'
      });
    }
    res.json({ board: boardSummary(board) });
  });

  app.post('/api/board/:boardId/stop-live', requireUser, (req, res) => {
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    board.isLive = false;
    board.updatedAt = nowIso();
    writeBoardStore(store);
    res.json({ board: boardSummary(board) });
  });

  // ---- Fetch a specific board (owner, or invited viewer of a live+shared board) ----
  app.get('/api/board/:boardId', requireUser, (req, res) => {
    const boardStore = readBoardStore();
    const board = findBoard(boardStore, req.params.boardId);
    if (!board) return res.status(404).json({ error: 'Board not found.' });

    const isOwner = req.user.id === board.teacherId;
    const mainStore = readStore();
    const teacher = mainStore.users.find((u) => u.id === board.teacherId);
    if (!teacher) return res.status(404).json({ error: 'Board owner no longer exists.' });
    const teacherInfo = { id: teacher.id, name: [teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || teacher.email };

    if (!isOwner) {
      // A shared board is viewable by students whether or not it's currently
      // live. When it isn't live they simply see the last saved snapshot
      // (read-only). Live only controls real-time updates, not visibility.
      const allowed = board.shared && viewerAllowed(mainStore, board.teacherId, req.user.email);
      if (!allowed) return res.status(403).json({ error: 'This whiteboard has not been shared with you.' });
    }
    res.json({ board, teacher: teacherInfo, isOwner });
  });

  // Every board shared with me, live or not — Library lists these so a
  // student has somewhere to see what a teacher shared even between
  // sessions. Only live ones are joinable (enforced in the fetch route).
  app.get('/api/board/shared/mine', requireUser, (req, res) => {
    const mainStore = readStore();
    const boardStore = readBoardStore();
    const boards = boardStore.boards
      .filter((b) => b.shared && b.teacherId !== req.user.id && viewerAllowed(mainStore, b.teacherId, req.user.email))
      .sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.updatedAt.localeCompare(a.updatedAt))
      .map((b) => {
        const teacher = mainStore.users.find((u) => u.id === b.teacherId);
        return {
          boardId: b.id,
          title: b.title,
          isLive: Boolean(b.isLive),
          updatedAt: b.updatedAt,
          teacherName: teacher ? ([teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || teacher.email) : 'Unknown teacher'
        };
      });
    res.json({ boards });
  });

  // ---- Page management -------------------------------------------------
  function ownedBoard(req, res) {
    const store = readBoardStore();
    const board = store.boards.find((b) => b.id === req.params.boardId);
    if (!board || board.teacherId !== req.user.id) {
      res.status(404).json({ error: 'Board not found.' });
      return {};
    }
    return { store, board };
  }

  app.post('/api/board/:boardId/pages', requireUser, (req, res) => {
    const { store, board } = ownedBoard(req, res);
    if (!board) return;
    if (board.pages.length >= MAX_PAGES_PER_BOARD) {
      return res.status(400).json({ error: `A board can hold up to ${MAX_PAGES_PER_BOARD} pages.` });
    }
    const page = newPage(req.body.template);
    board.pages.push(page);
    board.updatedAt = nowIso();
    writeBoardStore(store);
    res.json({ page, pageCount: board.pages.length });
  });

  app.patch('/api/board/:boardId/pages/:pageId', requireUser, (req, res) => {
    const { store, board } = ownedBoard(req, res);
    if (!board) return;
    const page = board.pages.find((p) => p.id === req.params.pageId);
    if (!page) return res.status(404).json({ error: 'Page not found.' });
    if (req.body.template !== undefined) page.template = String(req.body.template);
    if (req.body.background !== undefined) {
      const bg = req.body.background;
      // Backgrounds are stored inline as data URLs. Cap them so one imported
      // photo can't bloat board-data.json for everyone on the board.
      if (bg && String(bg).length > MAX_BACKGROUND_CHARS) {
        return res.status(413).json({ error: 'That image is too large. Try one under ~2MB.' });
      }
      page.background = bg || null;
    }
    board.updatedAt = nowIso();
    writeBoardStore(store);
    res.json({ page });
  });

  app.delete('/api/board/:boardId/pages/:pageId', requireUser, (req, res) => {
    const { store, board } = ownedBoard(req, res);
    if (!board) return;
    if (board.pages.length <= 1) return res.status(400).json({ error: 'A board needs at least one page.' });
    board.pages = board.pages.filter((p) => p.id !== req.params.pageId);
    board.updatedAt = nowIso();
    writeBoardStore(store);
    res.json({ pageCount: board.pages.length });
  });

  // ---- Analyze: classify what's on the page, then answer in kind --------
  // One vision call returns a typed result so the panel can render the right
  // shape of answer (worked steps, a definition, formulas...) instead of a
  // wall of prose. Everything is optional in the response; the client renders
  // whichever fields come back.
  const ANALYZE_INSTRUCTIONS = [
    'You are looking at a photo of a classroom whiteboard.',
    'Identify what is on it and respond with a SINGLE JSON object, no markdown fences, no prose outside the JSON.',
    'Schema:',
    '{',
    '  "kind": one of "algebra","calculus","system","arithmetic","word","geometry","solid","chemistry","physics","diagram","sketch","empty","unknown",',
    '  "title": short label for what this is,',
    '  "summary": 1-2 sentence plain-language description,',
    '  "method": name of the technique where relevant (e.g. "u-substitution", "elimination"), else null,',
    '  "steps": [ { "step": "what to do", "why": "why this step is valid" } ],',
    '  "answer": final result as a string, or null,',
    '  "facts": [ { "label": "...", "value": "..." } ],',
    '  "formulas": ["relevant formula strings"],',
    '  "plots": ["EVERY equation on the board that can be graphed, each rearranged into explicit y = f(x) form. For a system such as 2x+3y=12 include \\"y = (12 - 2x)/3\\", and for 5x-3y=9 include \\"y = (5x - 9)/3\\". Always include ALL the lines/curves (not just one) so they can be drawn in one coordinate system and their intersection shown. Omit only when nothing is graphable."],',
    '  "integrals": [ { "integrand": "the function of x being integrated, e.g. \\"x\\" or \\"x^2+1\\"", "antiderivative": "the antiderivative F(x) WITHOUT +C, e.g. for x it is \\"x^2/2\\", for x^2 it is \\"x^3/3\\"", "from": lower limit number or null if indefinite, "to": upper limit number or null, "value": the evaluated definite result as a number or null } ] - include ONE entry per integral on the board (there may be several) so each area and each antiderivative can be drawn together,',
    '  "viz3d": null OR { "shape": one of "cube","cuboid","sphere","cylinder","cone","pyramid","prism","tetrahedron","earth", "dims": { "a": number, "b": number, "c": number, "r": number, "h": number }, "label": "short caption" },',
    '  "molecule": null OR { "name": "compound name", "formula": "e.g. H2O", "smiles": "SMILES string if known e.g. O for water, CCO for ethanol", "atoms": [{"el":"O","x":0,"y":0,"z":0}], "bonds": [[0,1,1]] },',
    '  "physicsSim": null OR { "type": one of "freefall","projectile","pendulum","incline","collision","orbit","welldeath","reflection","circuit","fourforces","lift","dragcurve","stall","weightbalance","glide","cdi", "g": number (9.8 Earth, 1.6 Moon), "air": true|false } - pick the type that matches the board,',
    '  "warnings": ["anything wrong, ambiguous, or dimensionally inconsistent"]',
    '}',
    'Guidance by kind:',
    '- algebra/arithmetic/calculus/system: fill "steps" with a full worked solution, each with a justification. For calculus set "method". For EACH integral on the board add an entry to "integrals" with the integrand, its antiderivative F(x) (e.g. the antiderivative of x is x^2/2), the limits, and the definite value - so the antiderivative curve AND the shaded area are drawn together, and several integrals appear in the same coordinate system. For systems state which method and why, AND always populate "plots" with every equation solved for y so the lines/curves can be graphed together and their intersection shown.',
    '- word: "facts" should carry part of speech, definition, example sentence, and etymology.',
    '- geometry: "facts" for labeled properties, "formulas" for area/perimeter/theorems that apply.',
    '- solid: use this kind when the board shows (or labels) a 3D shape - a cube, box, sphere/ball, cylinder, cone, pyramid, prism, or a circle labeled "Earth"/"globe". Fill "viz3d" with the shape and any dimensions written on the board (side length a, width/height/depth a/b/c, radius r, height h). For a circle containing the word Earth or globe, use shape "earth". Also fill "formulas" with surface-area and volume formulas and "facts" with computed values when dimensions are given.',
    '- chemistry: compound name in "title", balanced equation in "answer", structural observations in "facts". If a molecule or compound is shown or named, ALSO fill "molecule" with its formula and, when you know it, a SMILES string and an explicit atoms+bonds list (bond order 1/2/3). Keep atoms to the real structure; small molecules only.',
    '- physics: name the concept in "title", governing formulas in "formulas", and CHECK UNITS. ALSO fill "physicsSim" when the board matches a known simulation: "freefall" for gravity/falling/feather-hammer; "projectile" for a ball/cannon launched at an angle, range, or trajectory; "pendulum" for a swinging bob or period questions; "incline" for a block on a ramp/wedge with friction (mu); "collision" for two masses colliding, momentum, or elastic/inelastic; "orbit" for satellites/planets/circular or escape velocity; "welldeath" for a bike/car on the inside of a vertical circular wall (wall of death); "reflection" for light rays on flat/concave/convex mirrors and focal points; "circuit" for batteries, resistors, capacitors, Ohms law or current flow; "fourforces" for the four forces of flight; "lift" for the lift equation, airspeed or angle of attack; "dragcurve" for parasite vs induced drag or best-glide speed; "stall" for stalls and critical angle of attack; "weightbalance" for center of gravity and loading; "glide" for glide ratio or engine-out. Set g (Earth 9.8, Moon 1.6) and air where relevant.',
    '- diagram: summarize structure in "summary" and list what is missing or unclear in "warnings".',
    '- sketch: identify the drawing in "title" and describe how to finish it in "steps".',
    'If the board is blank, use kind "empty".'
  ].join('\n');

  function parseAnalysis(raw) {
    const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The model did not return a readable analysis.');
    return JSON.parse(text.slice(start, end + 1));
  }

  app.post('/api/board/:boardId/analyze', requireUser, async (req, res) => {
    const store = readBoardStore();
    const board = store.boards.find((b) => b.id === req.params.boardId);
    if (!board) return res.status(404).json({ error: 'Board not found.' });
    // The teacher can always analyze. A student may analyze a board that's
    // shared with them, for their own independent study - the result is
    // returned only to them, not broadcast to the room.
    const isTeacher = board.teacherId === req.user.id;
    const isViewer = board.shared && viewerAllowed(readStore(), board.teacherId, req.user.email);
    if (!isTeacher && !isViewer) return res.status(403).json({ error: 'This whiteboard has not been shared with you.' });
    if (!req.body.snapshot) return res.status(400).json({ error: 'No board snapshot provided.' });
    try {
      const raw = await askVisionAI({ instructions: ANALYZE_INSTRUCTIONS, imageDataUrl: req.body.snapshot });
      const analysis = parseAnalysis(raw);
      analysis.id = boardId('an');
      analysis.createdAt = nowIso();
      res.json({ analysis });
    } catch (error) {
      res.status(502).json({ error: error.message || 'Could not analyze the board.' });
    }
  });

  // ---- Guest (no-login sandbox) analyze --------------------------------
  // The /sandbox board has no account, so it can't use the board-scoped
  // analyze above. This endpoint reuses the same vision model but caps usage
  // per IP so anonymous traffic can't run up the AI bill. Only successful
  // analyses count toward the cap.
  const GUEST_ANALYZE_MAX = Number(process.env.GUEST_ANALYZE_MAX || 3);
  const GUEST_ANALYZE_WINDOW_MS = 24 * 60 * 60 * 1000;
  const guestAnalyzeHits = new Map();
  app.post('/api/guest/analyze', async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const hits = (guestAnalyzeHits.get(ip) || []).filter((t) => now - t < GUEST_ANALYZE_WINDOW_MS);
    if (hits.length >= GUEST_ANALYZE_MAX) {
      return res.status(429).json({ error: 'Free AI limit reached.', capReached: true, remaining: 0 });
    }
    if (!req.body.snapshot) return res.status(400).json({ error: 'No board snapshot provided.' });
    try {
      const raw = await askVisionAI({ instructions: ANALYZE_INSTRUCTIONS, imageDataUrl: req.body.snapshot });
      const analysis = parseAnalysis(raw);
      analysis.id = boardId('an');
      analysis.createdAt = nowIso();
      hits.push(now);
      guestAnalyzeHits.set(ip, hits);
      res.json({ analysis, remaining: Math.max(0, GUEST_ANALYZE_MAX - hits.length) });
    } catch (error) {
      res.status(502).json({ error: error.message || 'Could not analyze the board.' });
    }
  });

  // ---- Public (no-login) shared board ----------------------------------
  // Anyone with the share link opens a read-only copy of the board — Pro
  // shares are a static snapshot (viewer refreshes to get the latest), Teams
  // shares can also be joined live (that path is handled by the socket). No
  // account is ever required, and students never pay.
  function findByPublicToken(store, token) {
    if (!token) return null;
    return store.boards.find((b) => b.publicToken === token && b.shared);
  }

  app.get('/api/public/board/:token', (req, res) => {
    const store = readBoardStore();
    const board = findByPublicToken(store, req.params.token);
    if (!board) return res.status(404).json({ error: 'This board link is no longer available.' });
    // Read-only projection — pages/strokes/objects only, no owner internals.
    res.json({
      board: {
        id: board.id,
        title: board.title,
        pages: board.pages,
        insights: Array.isArray(board.insights) ? board.insights : []
      },
      mode: board.isLive ? 'live' : 'snapshot',
      public: Boolean(board.public),
      rating: board.rating || { sum: 0, count: 0 },
      updatedAt: board.updatedAt
    });
  });

  // Students turn the shared board into flashcards / quiz / slides to study —
  // no login, no account, generated in-session and returned (never saved to a
  // teacher's library). Rate-limited per IP so it can't run up the AI bill.
  const PUBLIC_SET_MAX = Number(process.env.PUBLIC_SET_MAX || 4);
  const PUBLIC_SET_WINDOW_MS = 24 * 60 * 60 * 1000;
  const publicSetHits = new Map();
  app.post('/api/public/to-study-set', async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const hits = (publicSetHits.get(ip) || []).filter((t) => now - t < PUBLIC_SET_WINDOW_MS);
    if (hits.length >= PUBLIC_SET_MAX) {
      return res.status(429).json({ error: 'Free study-set limit reached. Sign in (free) to keep going.', capReached: true });
    }
    const snapshots = Array.isArray(req.body.snapshots) ? req.body.snapshots.slice(0, MAX_PAGES_PER_BOARD) : [];
    if (!snapshots.length) return res.status(400).json({ error: 'No board pages were captured.' });
    try {
      const extracted = [];
      for (let i = 0; i < snapshots.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const text = await askVisionAI({
          instructions: 'Transcribe and describe everything on this whiteboard page as plain study material: equations, definitions, diagrams, labels, worked steps. Write it as clean prose and lists a student could revise from. No preamble.',
          imageDataUrl: snapshots[i]
        });
        if (text && text.trim()) extracted.push(`--- Page ${i + 1} ---\n${text.trim()}`);
      }
      const content = extracted.join('\n\n');
      if (content.trim().length < 20) return res.status(400).json({ error: 'There was not enough on the board to build a study set.' });
      const format = ['flashcard', 'quiz', 'mixed', 'slides'].includes(req.body.format) ? req.body.format : 'mixed';
      const cardCount = Math.max(1, Math.min(40, Number(req.body.cardCount || 10)));
      const generated = await generateWithProvider({ content, cardCount, format, subject: req.body.subject || 'Study set' });
      hits.push(now); publicSetHits.set(ip, hits);
      // Returned only — not saved to any account.
      res.json({ set: { title: generated.title || 'Study set', cards: generated.cards, format } });
    } catch (error) {
      console.error('Public to-study-set failed:', error.message);
      res.status(500).json({ error: error.message || 'Could not build a study set from this board.' });
    }
  });

  // Teacher emails the share link (+ QR) to their class. Owner-only.
  app.post('/api/board/:boardId/share-email', requireUser, async (req, res) => {
    if (!requireWhiteboardPlan(req, res)) return;
    const store = readBoardStore();
    const board = findBoard(store, req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });
    if (!board.shared) { board.shared = true; }
    ensurePublicToken(board);
    writeBoardStore(store);

    const emails = String(req.body.emails || '')
      .split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (!emails.length) return res.status(400).json({ error: 'Add at least one valid email address.' });
    if (emails.length > 60) return res.status(400).json({ error: 'Please send to at most 60 addresses at a time.' });

    const url = `${APP_BASE_URL}/s/${board.publicToken}`;
    const qr = `${APP_BASE_URL}/qr?d=${encodeURIComponent(url)}`;
    const teacher = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'Your teacher';
    const note = String(req.body.note || '').slice(0, 500);
    const subject = `${teacher} shared a Boardsy whiteboard: ${board.title}`;
    const text = `${teacher} shared a whiteboard with you on Boardsy.\n\n${board.title}\nOpen it: ${url}\n\n${note}\n\nNo login needed — you can view it, export a PDF, and make flashcards or a quiz to study.`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0f1e35">
      <p><strong>${escapeHtmlSafe(teacher)}</strong> shared a whiteboard with you on Boardsy.</p>
      <p style="font-size:18px;margin:12px 0"><strong>${escapeHtmlSafe(board.title)}</strong></p>
      <p><a href="${url}" style="background:#2563ff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open the whiteboard</a></p>
      <p style="margin:16px 0"><img src="${qr}" alt="QR code" width="160" height="160" style="border:1px solid #dce6f5;border-radius:10px" /><br><span style="color:#5a6b85;font-size:13px">Scan to open on a phone</span></p>
      ${note ? `<p style="white-space:pre-wrap">${escapeHtmlSafe(note)}</p>` : ''}
      <p style="color:#5a6b85;font-size:13px">No login needed — view it, export a PDF, and make flashcards or a quiz to study.</p>
    </div>`;

    let sent = 0;
    for (const to of emails) {
      // eslint-disable-next-line no-await-in-loop
      const r = deps.sendShareEmail
        ? await deps.sendShareEmail({ to, subject, text, html }).catch(() => ({ sent: false }))
        : { sent: false };
      if (r && r.sent) sent += 1;
    }
    res.json({ ok: true, url, sent, total: emails.length });
  });

  function escapeHtmlSafe(v) {
    return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Board -> study set ----------------------------------------------
  // Reads every page with the vision model, then hands the extracted text to
  // the same generator the rest of the app uses, so a lesson on the board
  // becomes flashcards/quiz/slides sharable with the same roster.
  app.post('/api/board/:boardId/to-study-set', requireUser, async (req, res) => {
    const store = readBoardStore();
    const board = store.boards.find((b) => b.id === req.params.boardId);
    if (!board || board.teacherId !== req.user.id) return res.status(404).json({ error: 'Board not found.' });

    const usage = canCreateSet(req.user);
    if (!usage.ok) return res.status(429).json({ error: `You've used all ${usage.limit} study sets for today.` });

    const snapshots = Array.isArray(req.body.snapshots) ? req.body.snapshots.slice(0, MAX_PAGES_PER_BOARD) : [];
    if (!snapshots.length) return res.status(400).json({ error: 'No board pages were captured.' });

    try {
      const extracted = [];
      for (let i = 0; i < snapshots.length; i += 1) {
        // Sequential on purpose: parallel vision calls across 20 pages is a
        // good way to get rate-limited by every provider at once.
        // eslint-disable-next-line no-await-in-loop
        const text = await askVisionAI({
          instructions: 'Transcribe and describe everything on this whiteboard page as plain study material: equations, definitions, diagrams, labels, worked steps. Write it as clean prose and lists a student could revise from. No preamble.',
          imageDataUrl: snapshots[i]
        });
        if (text && text.trim()) extracted.push(`--- Page ${i + 1} ---\n${text.trim()}`);
      }
      const content = extracted.join('\n\n');
      if (content.trim().length < 20) return res.status(400).json({ error: 'There was not enough on the board to build a study set.' });

      const format = ['flashcard', 'quiz', 'mixed', 'slides'].includes(req.body.format) ? req.body.format : 'mixed';
      const cardCount = Math.max(1, Math.min(60, Number(req.body.cardCount || 10)));
      const generated = await generateWithProvider({ content, cardCount, format, subject: req.body.subject || board.title });
      const studySet = saveGeneratedSet(req.user, {
        title: generated.title || `${board.title} — study set`,
        cards: generated.cards,
        subject: req.body.subject || board.title,
        format,
        sourceType: 'whiteboard'
      });
      res.json({ set: studySet });
    } catch (error) {
      console.error('Board to study set failed:', error);
      res.status(500).json({ error: error.message || 'Could not build a study set from this board.' });
    }
  });

  // ---- Viewer discovery: which of MY teachers are live right now? -------
  app.get('/api/board/live/mine', requireUser, (req, res) => {
    const mainStore = readStore();
    const boardStore = readBoardStore();
    const live = boardStore.boards
      .filter((b) => b.isLive && b.shared && viewerAllowed(mainStore, b.teacherId, req.user.email))
      .map((b) => {
        const teacher = mainStore.users.find((u) => u.id === b.teacherId);
        return {
          boardId: b.id,
          teacherId: b.teacherId,
          teacherName: teacher ? ([teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || teacher.email) : 'Unknown teacher',
          title: b.title,
          updatedAt: b.updatedAt
        };
      });
    res.json({ live });
  });
}

// ---------------------------------------------------------------------
// WebSocket: live drawing sync, presence, and AI actions
// ---------------------------------------------------------------------
// Protocol (JSON messages both directions):
//   client -> server:
//     { type: 'stroke:add' | 'stroke:shape', stroke }
//     { type: 'board:clear' }
//     { type: 'ai:explain', snapshot }             // full-board PNG data URL
//     { type: 'ai:plot', expression }               // pure client-side math
//     { type: 'ai:read-equation', snapshot }        // cropped selection PNG
//   server -> client:
//     { type: 'sync', board, isOwner }
//     { type: 'stroke:add' | 'stroke:shape', stroke }
//     { type: 'board:clear' }
//     { type: 'ai:result', note }
//     { type: 'presence', viewers: [{ name, email }] }
//     { type: 'error', message }
//
// Only the owning teacher may draw/clear/trigger AI actions. A non-owner
// may only connect at all if the board is currently shared AND live.
function attachBoardWebSocket(httpServer, deps) {
  const { getUserFromCookieHeader, readStore, emailOnRoster, canViewTeachersContent, userHasWhiteboardAccess, askVisionAI } = deps;
  const viewerAllowed = canViewTeachersContent || ((store, teacherId, email) => emailOnRoster(store, teacherId, email));
  // Immersive in-session activities (polls + team quiz), shared with the lesson
  // surface. On the whiteboard, viewer names are already public to the room, so
  // teammate labels here carry real names.
  const { createLiveActivities } = require('./live-activities');
  const activities = createLiveActivities();

  // noServer: upgrades are routed centrally in server.js. Attaching multiple
  // WebSocketServers to the same http.Server with { server, path } makes each
  // one add its own 'upgrade' listener; the non-matching server then calls
  // abortHandshake() and destroys the socket the matching server just upgraded,
  // which manifested as an endless "Reconnecting…" loop. Central routing fixes
  // it. httpServer is unused here now but kept for signature stability.
  void httpServer;
  const wss = new WebSocketServer({ noServer: true });

  // boardId -> Set of { ws, user, isOwner }
  const rooms = new Map();
  // boardId -> Set of removed participant names (best-effort rejoin block for
  // anonymous, no-login students — mirrors the lesson surface).
  const removedNames = new Map();
  function removedFor(id) { if (!removedNames.has(id)) removedNames.set(id, new Set()); return removedNames.get(id); }

  function roomFor(id) {
    if (!rooms.has(id)) rooms.set(id, new Set());
    return rooms.get(id);
  }

  function broadcast(id, payload, exceptWs) {
    const room = rooms.get(id);
    if (!room) return;
    const data = JSON.stringify(payload);
    for (const client of room) {
      if (client.ws !== exceptWs && client.ws.readyState === 1) client.ws.send(data);
    }
  }

  function broadcastLostCount(id) {
    const room = rooms.get(id);
    if (!room) return;
    const count = Array.from(room).filter((c) => !c.isOwner && c.lost).length;
    broadcast(id, { type: 'lost:count', count }, null);
  }

  function broadcastPresence(id) {
    const room = rooms.get(id);
    if (!room) return;
    const viewers = Array.from(room)
      .filter((c) => !c.isOwner)
      .map((c) => ({ id: c.cid, name: [c.user.firstName, c.user.lastName].filter(Boolean).join(' ') || c.user.email, email: c.user.email || '', anon: !!c.user.anon }));
    broadcast(id, { type: 'presence', viewers }, null);
  }

  function getBoard(boardIdValue) {
    const store = readBoardStore();
    return store.boards.find((b) => b.id === boardIdValue)
      || store.boards.find((b) => b.publicToken === boardIdValue);
  }

  // Adapts a board room (a Set of clients) to the activities engine. The
  // "roster" is the non-owner viewers; each carries a stable per-connection id
  // (client.cid) so team membership survives across messages. Names are already
  // shared to the whole room via presence, so mates use the full display name.
  function displayName(user) { return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email; }
  function boardActivityBus(boardIdValue, actorWs) {
    const room = rooms.get(boardIdValue) || new Set();
    const findByCid = (cid) => [...room].find((c) => c.cid === cid);
    const teacher = [...room].find((c) => c.isOwner);
    const send = (ws, o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (_) {} };
    return {
      toTeacher: (o) => { if (teacher) send(teacher.ws, o); },
      toActor: (o) => send(actorWs, o),
      toParticipant: (cid, o) => { const c = findByCid(cid); if (c) send(c.ws, o); },
      toParticipants: (ids, o) => ids.forEach((cid) => { const c = findByCid(cid); if (c) send(c.ws, o); }),
      toStudents: (o) => { for (const c of room) if (!c.isOwner) send(c.ws, o); },
      toAll: (o) => { for (const c of room) send(c.ws, o); },
      roster: () => [...room].filter((c) => !c.isOwner).map((c) => ({ id: c.cid, name: displayName(c.user), label: displayName(c.user) }))
    };
  }

  function saveBoard(board) {
    const store = readBoardStore();
    const idx = store.boards.findIndex((b) => b.id === board.id);
    board.updatedAt = nowIso();
    if (idx >= 0) store.boards[idx] = board;
    writeBoardStore(store);
  }

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const joinKey = url.searchParams.get('boardId');
      if (!joinKey) return ws.close(4001, 'Missing boardId');

      const user = getUserFromCookieHeader(req.headers.cookie);
      const board = getBoard(joinKey);
      if (!board) return ws.close(4004, 'Board not found');
      const targetBoardId = board.id; // canonical room key even if joined via public token

      const isOwner = Boolean(user && user.id === board.teacherId);
      let participant = user;
      const cid = `c_${crypto.randomBytes(6).toString('hex')}`;
      if (isOwner) {
        if (!userHasWhiteboardAccess(user)) return ws.close(4003, 'Teams plan required');
      } else if (user) {
        // Signed-in student: must be on the roster / shared with.
        const mainStore = readStore();
        const allowed = board.shared && viewerAllowed(mainStore, board.teacherId, user.email);
        if (!allowed) return ws.close(4003, 'This whiteboard has not been shared with you');
        const dn = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
        if (dn && removedFor(targetBoardId).has(dn.toLowerCase())) return ws.close(4008, 'Removed by teacher');
      } else {
        // Anonymous student joining by code: allowed only on a LIVE, shared
        // board, and only with a name (mirrors the lesson surface). No login.
        if (!board.isLive || !board.shared) return ws.close(4003, 'This whiteboard is not live');
        const raw = (url.searchParams.get('name') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (!raw) return ws.close(4005, 'Name required');
        if (removedFor(targetBoardId).has(raw.toLowerCase())) return ws.close(4008, 'Removed by teacher');
        const parts = raw.split(' ');
        participant = { id: cid, firstName: parts[0], lastName: parts.slice(1).join(' '), email: '', anon: true };
      }

      const client = { ws, user: participant, isOwner, lost: false, cid };
      roomFor(targetBoardId).add(client);

      ws.send(JSON.stringify({ type: 'sync', board, isOwner }));
      if (!isOwner) broadcastPresence(targetBoardId);
      // Catch a (re)joining client up to any activity already running.
      activities.resync({ roomId: targetBoardId, isTeacher: isOwner, actor: { id: client.cid, name: displayName(participant), label: displayName(participant) }, bus: boardActivityBus(targetBoardId, ws) });

      ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // Ephemeral signals never touch disk. Reactions and the "I'm lost"
        // flag come FROM viewers by design, so they're excluded from the
        // owner-only guard below.
        if (msg.type === 'reaction') {
          const emoji = String(msg.emoji || '').slice(0, 8);
          if (!emoji) return;
          broadcast(targetBoardId, { type: 'reaction', emoji, from: isOwner ? 'teacher' : 'student' }, null);
          return;
        }

        // Immersive activities (poll + team quiz). The engine gates teacher vs
        // student itself, so route before the owner-only mutation guard.
        if (typeof msg.type === 'string' && msg.type.startsWith('activity:')) {
          const actor = { id: client.cid, name: displayName(client.user), label: displayName(client.user) };
          activities.handle({ roomId: targetBoardId, isTeacher: isOwner, actor, bus: boardActivityBus(targetBoardId, ws), msg });
          return;
        }

        if (msg.type === 'lost:toggle') {
          if (isOwner) return;
          client.lost = !client.lost;
          ws.send(JSON.stringify({ type: 'lost:self', lost: client.lost }));
          broadcastLostCount(targetBoardId);
          return;
        }

        // Students ask questions / raise a hand. Broadcast to the whole room
        // so the teacher's queue and other students' views stay in sync;
        // questions are ephemeral (not persisted with the board).
        if (msg.type === 'question:ask') {
          if (isOwner) return;
          const text = String(msg.text || '').slice(0, 400).trim();
          const q = {
            id: `q_${Math.random().toString(16).slice(2)}`,
            text: text || '(raised hand)',
            raisedHand: !text,
            from: [client.user.firstName, client.user.lastName].filter(Boolean).join(' ') || client.user.email,
            createdAt: nowIso()
          };
          broadcast(targetBoardId, { type: 'question', question: q }, null);
          return;
        }

        // Teacher removes a viewer (fraud/safety). Tell them, close their
        // socket, and block that name from rejoining this session.
        if (msg.type === 'kick') {
          if (!isOwner) return;
          const room = rooms.get(targetBoardId);
          if (room) {
            const target = Array.from(room).find((c) => c.cid === msg.id && !c.isOwner);
            if (target) {
              const dn = [target.user.firstName, target.user.lastName].filter(Boolean).join(' ') || target.user.email;
              if (dn) removedFor(targetBoardId).add(dn.toLowerCase());
              try { target.ws.send(JSON.stringify({ type: 'kicked' })); } catch (_) {}
              try { target.ws.close(4008, 'Removed by teacher'); } catch (_) {}
              room.delete(target);
              broadcastPresence(targetBoardId);
              broadcastLostCount(targetBoardId);
            }
          }
          return;
        }

        // Teacher clears a question once addressed.
        if (msg.type === 'question:clear') {
          if (!isOwner) return;
          broadcast(targetBoardId, { type: 'question:cleared', id: msg.id }, null);
          return;
        }

        // Live interactive graphs: the teacher tweaks a slider and every
        // viewer's copy of that graph object updates in real time. These are
        // frequent, so they're broadcast without a disk write on every tick;
        // the object's committed state is saved via the normal object:update.
        if (msg.type === 'graph:live') {
          if (!isOwner) return;
          broadcast(targetBoardId, { type: 'graph:live', objectId: msg.objectId, pageId: msg.pageId, params: msg.params, transform: msg.transform, fnFamily: msg.fnFamily, fnParams: msg.fnParams, expression: msg.expression }, ws);
          return;
        }

        const mutating = ['stroke:add', 'stroke:shape', 'stroke:remove', 'page:clear', 'page:goto',
          'object:add', 'object:update', 'object:remove', 'laser', 'insight:push',
          'ai:explain', 'ai:plot', 'ai:read-equation'];
        if (mutating.includes(msg.type) && !isOwner) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Only the teacher can change this board.' }));
        }

        // Laser is pointer position during a live session: broadcast, never
        // stored, so it leaves no trace on the saved board.
        if (msg.type === 'laser') {
          broadcast(targetBoardId, { type: 'laser', x: msg.x, y: msg.y, pageIndex: msg.pageIndex, active: msg.active !== false }, ws);
          return;
        }

        // Teacher paging through the board pulls viewers along with them.
        if (msg.type === 'page:goto') {
          broadcast(targetBoardId, { type: 'page:goto', pageIndex: Number(msg.pageIndex) || 0 }, ws);
          return;
        }

        // Teacher reveals an analysis to the room. Persist it to the board's
        // AI Notes archive first (so it survives the teacher leaving and shows
        // for students who open the board later), then broadcast live.
        if (msg.type === 'insight:push') {
          const b = getBoard(targetBoardId);
          if (b) {
            b.insights ||= [];
            const entry = { ...msg.analysis };
            entry.id ||= boardId('ain');
            entry.archivedAt = nowIso();
            // De-dupe: don't archive the same analysis twice if re-pushed.
            if (!b.insights.some((x) => x.id === entry.id)) {
              b.insights.push(entry);
              if (b.insights.length > 200) b.insights = b.insights.slice(-200);
              saveBoard(b);
            }
            broadcast(targetBoardId, { type: 'insight', analysis: entry }, ws);
          }
          return;
        }

        // Teacher toggled live/offline. Tell the room so students' banners and
        // pills update in real time (they keep their read-only snapshot either
        // way; this just changes the "live vs snapshot" indicator).
        if (msg.type === 'live:changed') {
          if (!isOwner) return;
          broadcast(targetBoardId, { type: 'live:changed', isLive: !!msg.isLive }, ws);
          return;
        }

        // Teacher started/stopped broadcasting live audio (LiveKit). Relay the
        // on/off flag so viewers auto-join or leave the audio room. No media
        // travels over this socket — LiveKit carries the actual audio.
        if (msg.type === 'audio') {
          if (!isOwner) return;
          broadcast(targetBoardId, { type: 'audio', on: !!msg.on }, ws);
          return;
        }

        // Teacher erases the whole AI Notes archive for this board. It clears
        // for students too (broadcast), and is wiped from storage.
        if (msg.type === 'insight:clear') {
          if (!isOwner) return;
          const b = getBoard(targetBoardId);
          if (b) { b.insights = []; saveBoard(b); }
          broadcast(targetBoardId, { type: 'insight:cleared' }, null);
          return;
        }

        const withPage = (fn) => {
          const b = getBoard(targetBoardId);
          if (!b) return null;
          const page = b.pages.find((p) => p.id === msg.pageId) || b.pages[0];
          if (!page) return null;
          const result = fn(b, page);
          saveBoard(b);
          return result;
        };

        if (msg.type === 'stroke:add' || msg.type === 'stroke:shape') {
          const stroke = { ...msg.stroke, id: msg.stroke?.id || boardId('str'), createdAt: nowIso() };
          withPage((b, page) => {
            page.strokes.push(stroke);
            if (page.strokes.length > MAX_STROKES_PER_PAGE) page.strokes = page.strokes.slice(-MAX_STROKES_PER_PAGE);
          });
          broadcast(targetBoardId, { type: msg.type, pageId: msg.pageId, stroke }, ws);
          return;
        }

        // Undo/redo is expressed as remove/re-add of a specific stroke id so
        // every connected client converges on the same page contents.
        if (msg.type === 'stroke:remove') {
          withPage((b, page) => { page.strokes = page.strokes.filter((st) => st.id !== msg.strokeId); });
          broadcast(targetBoardId, { type: 'stroke:remove', pageId: msg.pageId, strokeId: msg.strokeId }, ws);
          return;
        }

        if (msg.type === 'object:add' || msg.type === 'object:update') {
          const object = { ...msg.object, id: msg.object?.id || boardId('obj') };
          withPage((b, page) => {
            const idx = page.objects.findIndex((o) => o.id === object.id);
            if (idx >= 0) page.objects[idx] = object;
            else page.objects.push(object);
          });
          broadcast(targetBoardId, { type: 'object:add', pageId: msg.pageId, object }, ws);
          return;
        }

        if (msg.type === 'object:remove') {
          withPage((b, page) => { page.objects = page.objects.filter((o) => o.id !== msg.objectId); });
          broadcast(targetBoardId, { type: 'object:remove', pageId: msg.pageId, objectId: msg.objectId }, ws);
          return;
        }

        if (msg.type === 'page:clear') {
          withPage((b, page) => { page.strokes = []; page.objects = []; });
          broadcast(targetBoardId, { type: 'page:clear', pageId: msg.pageId }, null);
          return;
        }

        if (msg.type === 'ai:explain') {
          try {
            const result = await askVisionAI({
              instructions: 'You are looking at a classroom whiteboard. Briefly explain, in plain language a student could follow, what is written or drawn. If it is a math expression, state the result. Under 120 words.',
              imageDataUrl: msg.snapshot
            });
            const note = { id: boardId('note'), kind: 'explain', result, createdAt: nowIso() };
            const b = getBoard(targetBoardId);
            if (b) { b.aiNotes.push(note); saveBoard(b); }
            broadcast(targetBoardId, { type: 'ai:result', note }, null);
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message || 'AI explain failed.' }));
          }
          return;
        }

        if (msg.type === 'ai:plot') {
          const note = { id: boardId('note'), kind: 'graph', expression: String(msg.expression || '').slice(0, 200), createdAt: nowIso() };
          const b = getBoard(targetBoardId);
          if (b) { b.aiNotes.push(note); saveBoard(b); }
          broadcast(targetBoardId, { type: 'ai:result', note }, null);
          return;
        }

        // "Select an equation, hit Plot": a vision call extracts the equation
        // text, which is then validated against the same character allowlist
        // the client's safe parser enforces, so a bad extraction fails here
        // rather than reaching a viewer's browser as unvalidated text.
        if (msg.type === 'ai:read-equation') {
          try {
            const raw2 = await askVisionAI({
              instructions: 'Extract ONLY the mathematical equation or expression shown in this image selection. Respond with just the equation (e.g. "y = 2x + 3"), no words, no markdown. If none is visible, respond exactly: NONE',
              imageDataUrl: msg.snapshot
            });
            const cleaned = String(raw2 || '').trim();
            if (!cleaned || cleaned.toUpperCase() === 'NONE' || !isSafeExpression(cleaned)) {
              ws.send(JSON.stringify({ type: 'error', message: "Couldn't read an equation there — try a tighter box around just the equation." }));
              return;
            }
            broadcast(targetBoardId, { type: 'equation:read', expression: cleaned, rect: msg.rect, pageId: msg.pageId }, null);
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: error.message || 'Could not read the selection.' }));
          }
          return;
        }
      });

      ws.on('close', () => {
        const room = rooms.get(targetBoardId);
        if (room) {
          room.delete(client);
          if (room.size === 0) { rooms.delete(targetBoardId); activities.clearRoom(targetBoardId); }
          else if (!isOwner) { broadcastPresence(targetBoardId); broadcastLostCount(targetBoardId); }
        }
      });
    } catch (error) {
      console.error('Board WS connection error:', error);
      try { ws.close(1011, 'Internal error'); } catch {}
    }
  });

  // Non-owner viewers currently connected to a board's live room. Used to
  // report live seat occupancy for public webinars.
  wss.getLiveCount = (boardIdValue) => {
    const room = rooms.get(boardIdValue);
    if (!room) return 0;
    return Array.from(room).filter((c) => !c.isOwner).length;
  };

  return wss;
}

// Returns the id of the board a teacher should land on when they just click
// "Whiteboard": their most recently updated one, creating a first board if
// they have none. Before multi-board support, clicking Whiteboard always
// dropped you straight onto a canvas; without this you land on an empty list
// and have to create a board before you can draw anything.
function getOrCreateCurrentBoardId(teacherId) {
  const store = readBoardStore();
  const mine = store.boards
    .filter((b) => b.teacherId === teacherId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (mine.length) return mine[0].id;

  const board = {
    id: boardId(),
    teacherId,
    title: 'My Whiteboard',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shared: false,
    isLive: false,
    pages: [newPage('blank')],
    aiNotes: []
  };
  store.boards.push(board);
  writeBoardStore(store);
  return board.id;
}

module.exports = { attachBoardRoutes, attachBoardWebSocket, getOrCreateCurrentBoardId, readBoardStore, writeBoardStore };
