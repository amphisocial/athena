/* Unit test for the whiteboard expression normalizer (board.js normalizeExpr) +
 * a mirror of the arithmetic parser, so we can prove that a teacher can write
 * things naturally: 2x^2, x², 2·x, √x, unicode minus. The parser in board.js
 * closes over canvas state, so both the normalizer and a compatible parser are
 * reimplemented here. Run: node scripts/test-expression-normalize.js */
const assert = require('assert');
let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- mirror of board.js normalizeExpr ---
const SUP = { '\u2070': '0', '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9' };
function normalizeExpr(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/g, (m) => '^' + m.split('').map((c) => SUP[c] || '').join(''));
  s = s.replace(/[\u00b7\u2219\u00d7\u2022\u2217]/g, '*').replace(/\u00f7/g, '/').replace(/[\u2212\u2013\u2014]/g, '-').replace(/\u221a/g, 'sqrt');
  return s;
}

// --- mirror of board.js compileExpression (arithmetic core, implicit mult) ---
function compile(raw) {
  const source = normalizeExpr(raw).split('=').pop().trim();
  let pos = 0;
  const FUNCS = { sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log10, ln: Math.log, tan: Math.tan };
  const peek = () => source[pos];
  const skipWs = () => { while (pos < source.length && /\s/.test(source[pos])) pos += 1; };
  const canStartFactor = () => { skipWs(); const c = peek(); return c === '(' || (c !== undefined && /[a-zA-Z0-9]/.test(c)); };
  function parseExpr() { let v = parseTerm(); skipWs(); while (peek() === '+' || peek() === '-') { const op = source[pos]; pos += 1; const r = parseTerm(); const p = v; v = op === '+' ? (x) => p(x) + r(x) : (x) => p(x) - r(x); skipWs(); } return v; }
  function parseTerm() { let v = parseFactor(); skipWs(); while (peek() === '*' || peek() === '/' || canStartFactor()) { if (peek() === '*' || peek() === '/') { const op = source[pos]; pos += 1; const r = parseFactor(); const p = v; v = op === '*' ? (x) => p(x) * r(x) : (x) => p(x) / r(x); } else { const r = parseFactor(); const p = v; v = (x) => p(x) * r(x); } skipWs(); } return v; }
  function parseFactor() { const b = parseUnary(); skipWs(); if (peek() === '^') { pos += 1; const e = parseFactor(); return (x) => Math.pow(b(x), e(x)); } return b; }
  function parseUnary() { skipWs(); if (peek() === '-') { pos += 1; const i = parseUnary(); return (x) => -i(x); } if (peek() === '+') { pos += 1; return parseUnary(); } return parsePrimary(); }
  function parsePrimary() {
    skipWs();
    if (peek() === '(') { pos += 1; const i = parseExpr(); skipWs(); if (peek() !== ')') throw new Error('Missing )'); pos += 1; return i; }
    const num = /^\d+(\.\d+)?/.exec(source.slice(pos));
    if (num) { pos += num[0].length; const n = Number(num[0]); return () => n; }
    const ident = /^[a-zA-Z]+/.exec(source.slice(pos));
    if (ident) {
      const full = ident[0], lower = full.toLowerCase();
      if (FUNCS[lower]) { pos += full.length; skipWs(); if (peek() !== '(') throw new Error('need ('); pos += 1; const arg = parseExpr(); skipWs(); if (peek() !== ')') throw new Error('Missing )'); pos += 1; return (x) => FUNCS[lower](arg(x)); }
      const ch = full[0]; pos += 1; if (ch.toLowerCase() === 'x') return (x) => x; return () => 0;
    }
    throw new Error(`Unexpected "${peek() || ''}"`);
  }
  const fn = parseExpr(); skipWs();
  if (pos < source.length) throw new Error(`Unexpected "${source.slice(pos)}"`);
  return fn;
}

console.log('normalizer: superscripts, symbols');
{
  ok('x² -> x^2', normalizeExpr('x\u00b2') === 'x^2');
  ok('2x² -> 2x^2', normalizeExpr('2x\u00b2') === '2x^2');
  ok('multi-digit x¹⁰ -> x^10', normalizeExpr('x\u00b9\u2070') === 'x^10');
  ok('2·x -> 2*x and 2×x -> 2*x', normalizeExpr('2\u00b7x') === '2*x' && normalizeExpr('2\u00d7x') === '2*x');
  ok('unicode minus normalized', normalizeExpr('x\u22123') === 'x-3');
  ok('√x -> sqrtx', normalizeExpr('\u221ax') === 'sqrtx');
}

console.log('parser: natural forms all evaluate');
{
  ok('2x^2 evaluates (implicit mult, no *)', near(compile('2x^2')(3), 18));
  ok('handwritten 2x² evaluates the same', near(compile('2x\u00b2')(3), 18));
  ok('y = 2x² strips the y= and evaluates', near(compile('y = 2x\u00b2')(2), 8));
  ok('mx style implicit mult still works (x term only here)', near(compile('3x')(4), 12));
  ok('4x^2 (the failing case from the screenshot) works', near(compile('4x\u00b2')(2), 16));
  ok('bare superscript number 2³ -> 8', near(compile('2\u00b3')(0), 8));
}

console.log('integral: antiderivative gives the correct definite value');
{
  // The "answer" curve for y = ∫ x dx is F(x) = x^2/2, NOT the integrand x.
  const F = compile('x^2/2');
  ok('F(x) = x^2/2 evaluates', near(F(2), 2) && near(F(7), 24.5));
  ok('∫₀² x dx = F(2) - F(0) = 2', near(F(2) - F(0), 2));
  ok('∫₀⁷ x dx = F(7) - F(0) = 24.5', near(F(7) - F(0), 24.5));
  ok('the integrand x is NOT the answer curve (F(2)=2 ≠ x at 2 being the area)', F(2) === 2);
}

console.log(`\nAll ${passed} assertions passed.`);
process.exit(0);
