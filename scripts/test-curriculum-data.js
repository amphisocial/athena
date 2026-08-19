/* Data-integrity test for the MA curriculum catalog. Verifies the file parses,
 * every grade 5–12 has math AND science topics, templates reference real board
 * templates, and the server gate (MAX_GRADE) actually admits grades 11–12.
 * Run: node scripts/test-curriculum-data.js */
const assert = require('assert');
const fs = require('fs');
const { CURRICULUM } = require('../server/curriculum-data.js');

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, label); passed += 1; console.log('  ✓', label); };

const VALID_TEMPLATES = new Set(['quadratic', 'linear', 'solid', 'globe', 'newton', 'molecule', 'incline', 'pendulum', 'reflection']);

console.log('shape + provenance');
{
  ok('CURRICULUM is a non-empty array', Array.isArray(CURRICULUM) && CURRICULUM.length > 0);
  ok('every strand has grade, subject, strand, and topics[]', CURRICULUM.every((g) => Number.isInteger(g.grade) && ['math', 'science'].includes(g.subject) && typeof g.strand === 'string' && Array.isArray(g.topics) && g.topics.length));
  ok('every topic has a title and a standard code', CURRICULUM.every((g) => g.topics.every((t) => t.title && t.standard)));
  const bad = [];
  CURRICULUM.forEach((g) => g.topics.forEach((t) => { if (t.template && !VALID_TEMPLATES.has(t.template)) bad.push(`${g.grade} ${t.title} -> ${t.template}`); }));
  ok('all template links are real board templates', bad.length === 0 || bad.join(', '));
}

console.log('coverage: grades 5–12, both subjects');
{
  const has = (grade, subject) => CURRICULUM.some((g) => g.grade === grade && g.subject === subject && g.topics.length);
  for (let grade = 5; grade <= 12; grade += 1) {
    ok(`grade ${grade} has math topics`, has(grade, 'math'));
    ok(`grade ${grade} has science topics`, has(grade, 'science'));
  }
}

console.log('grades 11–12 are substantial and MA-aligned');
{
  const topicsFor = (grade, subject) => CURRICULUM.filter((g) => g.grade === grade && g.subject === subject).reduce((n, g) => n + g.topics.length, 0);
  ok('grade 11 math has a real course worth of topics (>= 15)', topicsFor(11, 'math') >= 15);
  ok('grade 12 math has a real course worth of topics (>= 15)', topicsFor(12, 'math') >= 15);
  ok('grade 11 science has a real course worth of topics (>= 12)', topicsFor(11, 'science') >= 12);
  ok('grade 12 science has a real course worth of topics (>= 12)', topicsFor(12, 'science') >= 12);
  const strand = (grade, subject, needle) => CURRICULUM.some((g) => g.grade === grade && g.subject === subject && g.strand.toLowerCase().includes(needle));
  ok('grade 11 math includes logarithms/exponentials', strand(11, 'math', 'exponential'));
  ok('grade 11 math includes trigonometric functions', strand(11, 'math', 'trigonometric'));
  ok('grade 12 math includes an introduction to calculus', strand(12, 'math', 'calculus'));
  ok('grade 12 science includes astronomy', strand(12, 'science', 'astronomy'));
}

console.log('server gate admits grades 11–12');
{
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server', 'curriculum.js'), 'utf8');
  const m = src.match(/const MAX_GRADE = (\d+)/);
  ok('MAX_GRADE is 12', m && Number(m[1]) === 12);
}

console.log('client grade lists include 11 and 12');
{
  const learning = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'learning.js'), 'utf8');
  const library = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'library.js'), 'utf8');
  ok('learning.js GRADES ends at 12', /GRADES = \[5, 6, 7, 8, 9, 10, 11, 12\]/.test(learning));
  ok('library.js LC_GRADES ends at 12', /LC_GRADES = \[5, 6, 7, 8, 9, 10, 11, 12\]/.test(library));
  ok('learning lede says grades 5–12', /grades 5&ndash;12/.test(learning));
}

console.log(`\nAll ${passed} assertions passed.`);
process.exit(0);
