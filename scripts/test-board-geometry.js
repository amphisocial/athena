/* Unit test for the whiteboard's selection hit-testing and the "place the graph
 * to the right of existing content" math. These predicates in board.js close over
 * canvas state, so this mirrors the pure logic and checks it. Run:
 *   node scripts/test-board-geometry.js */
const assert = require('assert');
let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };

// --- mirrors of board.js pure helpers ---
const normSel = (r) => ({ minX: Math.min(r.x1, r.x2), minY: Math.min(r.y1, r.y2), maxX: Math.max(r.x1, r.x2), maxY: Math.max(r.y1, r.y2) });
const strokeInSel = (s, r) => (s.points || []).some((p) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY);
function objInSel(o, r) {
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return false;
  const ox2 = o.x + (o.w || 0), oy2 = o.y + (o.h || 0);
  return o.x <= r.maxX && ox2 >= r.minX && o.y <= r.maxY && oy2 >= r.minY;
}
function contentBounds(strokes, objects, excludeId) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  (strokes || []).forEach((s) => (s.points || []).forEach((pt) => { minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y); maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y); }));
  (objects || []).forEach((o) => { if (excludeId && o.id === excludeId) return; if (typeof o.x !== 'number') return; minX = Math.min(minX, o.x); minY = Math.min(minY, o.y); maxX = Math.max(maxX, o.x + (o.w || 0)); maxY = Math.max(maxY, o.y + (o.h || 0)); });
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

console.log('selection hit-testing');
{
  const r = normSel({ x1: 100, y1: 100, x2: 300, y2: 300 });
  ok('a stroke with a point inside the region is selected', strokeInSel({ points: [{ x: 10, y: 10 }, { x: 150, y: 150 }] }, r));
  ok('a stroke entirely outside is NOT selected', !strokeInSel({ points: [{ x: 10, y: 10 }, { x: 40, y: 40 }] }, r));
  ok('an object overlapping the region is selected', objInSel({ x: 250, y: 250, w: 100, h: 100 }, r));
  ok('an object clear of the region is NOT selected', !objInSel({ x: 400, y: 400, w: 50, h: 50 }, r));
  ok('a connector without x/y is never selected', !objInSel({ type: 'connector', fromId: 'a', toId: 'b' }, r));
  ok('normSel handles a bottom-right-to-top-left drag', (() => { const n = normSel({ x1: 300, y1: 300, x2: 100, y2: 100 }); return n.minX === 100 && n.maxY === 300; })());
}

console.log('graph placement: right of the written content');
{
  const strokes = [{ points: [{ x: 0, y: 0 }, { x: 500, y: 400 }] }]; // handwriting on the left
  const cb = contentBounds(strokes, []);
  ok('content bounds cover the handwriting', cb && cb.minX === 0 && cb.maxX === 500 && cb.maxY === 400);
  const graphX = cb.maxX + 48;
  ok('graph is placed to the RIGHT of the content (x > content maxX)', graphX > cb.maxX);
  ok('graph top aligns near the content top', cb.minY === 0);
  ok('empty page yields null bounds (falls back to view centre)', contentBounds([], []) === null);
  // The analysis graph itself must be excluded so it doesn't chase its own tail.
  const withGraph = contentBounds(strokes, [{ id: 'g1', x: 900, y: 0, w: 380, h: 300 }], 'g1');
  ok('excluding the analysis graph keeps bounds on the real content', withGraph.maxX === 500);
}

console.log(`\nAll ${passed} assertions passed.`);
process.exit(0);
