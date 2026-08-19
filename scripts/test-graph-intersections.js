/* Unit test for the whiteboard intersection finder. The board's computeIntersections
 * closes over canvas state, so this reimplements the SAME numeric algorithm on
 * plain functions and checks known crossings (parabola/parabola, line/parabola,
 * no-intersection). Guards the math and the bisection refinement. Run:
 *   node scripts/test-graph-intersections.js */
const assert = require('assert');
let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// Mirror of board.js computeIntersections' core (domain scan + bisection).
function intersections(fns, xMin = -10, xMax = 10, N = 480) {
  const out = [];
  const push = (x, y, i, j) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rx = Math.round(x * 1000) / 1000, ry = Math.round(y * 1000) / 1000;
    if (out.some((p) => Math.abs(p.x - rx) < 0.02 && Math.abs(p.y - ry) < 0.02)) return;
    out.push({ x: rx, y: ry, i, j });
  };
  for (let i = 0; i < fns.length; i += 1) {
    for (let j = i + 1; j < fns.length; j += 1) {
      const d = (x) => fns[i](x) - fns[j](x);
      let prevX = xMin, prevD = d(xMin);
      for (let k = 1; k <= N; k += 1) {
        const x = xMin + ((xMax - xMin) * k) / N;
        const dv = d(x);
        if (Number.isFinite(prevD) && Number.isFinite(dv)) {
          if (prevD === 0) push(prevX, fns[i](prevX), i, j);
          else if (prevD * dv < 0) {
            let lo = prevX, hi = x, flo = prevD;
            for (let it = 0; it < 40; it += 1) {
              const mid = (lo + hi) / 2, fm = d(mid);
              if (!Number.isFinite(fm)) break;
              if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
            }
            const rx = (lo + hi) / 2;
            push(rx, fns[i](rx), i, j);
          }
        }
        prevX = x; prevD = dv;
      }
    }
  }
  return out;
}

console.log('line x parabola: y=x+1 and y=x^2  ->  x=(1±√5)/2');
{
  const pts = intersections([(x) => x + 1, (x) => x * x]);
  ok('finds two intersections', pts.length === 2);
  const xs = pts.map((p) => p.x).sort((a, b) => a - b);
  ok('roots match (1-√5)/2 and (1+√5)/2', near(xs[0], (1 - Math.sqrt(5)) / 2) && near(xs[1], (1 + Math.sqrt(5)) / 2));
  ok('y lies on both curves', pts.every((p) => near(p.y, p.x + 1) && near(p.y, p.x * p.x)));
}

console.log('parabola x parabola: y=4x^2 and y=-2x^2  ->  touch at origin only');
{
  // These only meet at x=0 (6x^2=0). It's a tangential touch (no sign change),
  // so the scan may or may not catch it — the important property is it never
  // reports a spurious crossing elsewhere.
  const pts = intersections([(x) => 4 * x * x, (x) => -2 * x * x]);
  ok('no spurious intersections away from origin', pts.every((p) => Math.abs(p.x) < 0.05));
}

console.log('two lines that cross: y=2x-1 and y=-x+5  ->  (2,3)');
{
  const pts = intersections([(x) => 2 * x - 1, (x) => -x + 5]);
  ok('exactly one crossing', pts.length === 1);
  ok('crossing at (2,3)', near(pts[0].x, 2) && near(pts[0].y, 3));
}

console.log('parallel lines: y=x and y=x+3  ->  never meet');
{
  const pts = intersections([(x) => x, (x) => x + 3]);
  ok('no intersection reported', pts.length === 0);
}

console.log('three curves: pairwise crossings are all found');
{
  const pts = intersections([(x) => x, (x) => -x, (x) => 3]);
  // y=x & y=-x -> (0,0); y=x & y=3 -> (3,3); y=-x & y=3 -> (-3,3)
  const has = (x, y) => pts.some((p) => near(p.x, x) && near(p.y, y));
  ok('y=x ∩ y=-x at (0,0)', has(0, 0));
  ok('y=x ∩ y=3 at (3,3)', has(3, 3));
  ok('y=-x ∩ y=3 at (-3,3)', has(-3, 3));
}

// Mirror of board.js linear solver (linearParts + toExplicitY math).
function coefOf(t) { if (t === '' || t === '+') return 1; if (t === '-') return -1; const n = Number(t); return Number.isFinite(n) ? n : NaN; }
function linearParts(side) {
  if (!side) return { a: 0, b: 0, c: 0 };
  if (/[\^]|sqrt|sin|cos|tan|log|ln|exp|abs|\//i.test(side)) return null;
  let a = 0, b = 0, c = 0;
  const terms = side.replace(/-/g, '+-').split('+').filter((t) => t !== '');
  for (const term of terms) {
    if (/x/i.test(term) && /y/i.test(term)) return null;
    if (/y/i.test(term)) { const co = coefOf(term.replace(/y/i, '')); if (!Number.isFinite(co)) return null; b += co; }
    else if (/x/i.test(term)) { const co = coefOf(term.replace(/x/i, '')); if (!Number.isFinite(co)) return null; a += co; }
    else { const n = Number(term); if (!Number.isFinite(n)) return null; c += n; }
  }
  return { a, b, c };
}
function solveForY(raw) {
  const s = String(raw).replace(/\s+/g, '');
  if (!s.includes('=')) return null;
  const [lhs, rhs] = s.split('=');
  const L = linearParts(lhs), R = linearParts(rhs);
  if (!L || !R) return null;
  const a = L.a - R.a, b = L.b - R.b, c = L.c - R.c;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-9) return null;
  return (x) => (-c - a * x) / b;
}

console.log('implicit linear system: 2x+3y=12 and 5x-3y=9  ->  (3,2)');
{
  const f = solveForY('2x + 3y = 12');
  const g = solveForY('5x - 3y = 9');
  ok('both implicit lines solve for y', typeof f === 'function' && typeof g === 'function');
  ok('2x+3y=12 passes through (0,4) and (3,2)', near(f(0), 4) && near(f(3), 2));
  ok('5x-3y=9 passes through (0,-3) and (3,2)', near(g(0), -3) && near(g(3), 2));
  const pts = intersections([f, g]);
  ok('the system intersects at (3,2)', pts.length === 1 && near(pts[0].x, 3) && near(pts[0].y, 2));
}

console.log('non-linear implicit is skipped (returns null)');
{
  ok('x^2 + y^2 = 25 (circle) is not solved as y=f(x)', solveForY('x^2 + y^2 = 25') === null);
  ok('xy = 1 (product term) is not linearised', solveForY('xy = 1') === null);
}

console.log(`\nAll ${passed} assertions passed.`);
process.exit(0);
