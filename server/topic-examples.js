/*
 * topic-examples.js — builds concrete, slide-ready lesson content for a topic.
 *
 * The goal: when a teacher clicks "Start lesson" on a curriculum topic, the
 * "Paste content" box is already filled with real, teachable material — a
 * definition slide, a concept slide, and one or two WORKED examples with actual
 * numbers (e.g. "evaluate 12 − 4 × 2 + 2 × (13 − 2 × 2)"), plus a common-mistake
 * slide and practice. Everything is editable.
 *
 * Coverage is by concept pattern (matched from the topic title). Common math and
 * science concepts get hand-written, correct worked examples. Anything not
 * matched falls back to a still-slide-structured template that frames a concrete
 * example for the teacher to complete. The AI backfill can replace any of this
 * with fully researched content stored in the DB.
 */

const gradeText = (g) => (g ? (/^grade/i.test(String(g)) ? String(g) : `Grade ${g}`) : '');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---- worked-example library -------------------------------------------------
// Each entry: def, idea, examples:[{title, body}], trap?, practice:[], vocab:[], checks:[{q,a}]
const LIB = {
  order_ops: {
    def: 'The **order of operations** is the agreed sequence for evaluating an expression so everyone gets the same answer: **P**arentheses/grouping symbols → **E**xponents → **M**ultiplication & **D**ivision (left→right) → **A**ddition & **S**ubtraction (left→right).',
    idea: 'Work grouping symbols first, then exponents, then all multiplication and division from left to right, and finally all addition and subtraction from left to right. Multiplication is **not** always before division — do whichever comes first left to right.',
    examples: [{
      title: 'Evaluate 12 − 4 × 2 + 2 × (13 − 2 × 2)',
      body: '1. **Grouping first:** inside the parentheses, 2 × 2 = 4, so 13 − 4 = **9** → 12 − 4 × 2 + 2 × **9**\n2. **Multiply:** 4 × 2 = 8 and 2 × 9 = 18 → 12 − **8** + **18**\n3. **Add/subtract left→right:** 12 − 8 = 4, then 4 + 18 = **22**\n\n**Answer: 22**'
    }, {
      title: 'Evaluate 20 − 2 × 3²',
      body: '1. **Exponent:** 3² = 9 → 20 − 2 × 9\n2. **Multiply:** 2 × 9 = 18 → 20 − 18\n3. **Subtract:** = **2**'
    }],
    trap: {
      setup: 'Michael evaluated 12 − 4 × 2 + 2 × (13 − 2 × 2) straight left to right: 12 − 4 = 8, then 8 × 2 = 16… and got the wrong answer.',
      fix: 'You can\'t just go left to right across different operations. Do the grouping symbols and every multiplication before you add or subtract.'
    },
    practice: ['8 + 3 × (10 − 6)  (=20)', '(15 − 3) ÷ 4 + 5  (=8)', '6 + 2 × 5 − 4²  (=0)', '30 ÷ (2 + 3) × 2  (=12)'],
    vocab: ['expression — numbers and operations with no equals sign', 'evaluate — find the single value of an expression', 'grouping symbols — parentheses ( ), brackets [ ]'],
    checks: [{ q: 'In 5 + 2 × 3, what do you do first?', a: '2 × 3 = 6, then 5 + 6 = 11' }, { q: 'True or false: multiplication always comes before division.', a: 'False — do whichever is left-most first.' }]
  },

  frac_addsub: {
    def: 'To **add or subtract fractions** the pieces must be the same size — so first rewrite them with a **common denominator**, then add or subtract the numerators.',
    idea: 'Find a common denominator (the least common multiple of the denominators works well), make equivalent fractions, add/subtract the numerators, keep the denominator, then simplify.',
    examples: [{
      title: 'Add 2/3 + 1/4',
      body: '1. **Common denominator:** LCM(3, 4) = 12\n2. **Equivalent fractions:** 2/3 = 8/12 and 1/4 = 3/12\n3. **Add numerators:** 8/12 + 3/12 = **11/12**'
    }, {
      title: 'Subtract 5/6 − 1/4',
      body: '1. **Common denominator:** LCM(6, 4) = 12\n2. 5/6 = 10/12 and 1/4 = 3/12\n3. 10/12 − 3/12 = **7/12**'
    }],
    trap: {
      setup: 'A student wrote 2/3 + 1/4 = 3/7 by adding the tops and the bottoms.',
      fix: 'You can only add numerators once the denominators match. 2/3 + 1/4 = 8/12 + 3/12 = 11/12, not 3/7.'
    },
    practice: ['1/2 + 3/8  (=7/8)', '3/5 + 1/2  (=1 1/10)', '7/8 − 1/3  (=13/24)', '2/3 + 5/6  (=1 1/2)'],
    vocab: ['numerator — top number (how many parts)', 'denominator — bottom number (size of each part)', 'common denominator — a shared bottom number', 'equivalent fractions — different names for the same amount'],
    checks: [{ q: 'Why do you need a common denominator?', a: 'So the parts are the same size and can be combined.' }, { q: 'Rewrite 1/2 with denominator 6.', a: '3/6' }]
  },

  frac_multiply: {
    def: 'To **multiply fractions**, multiply the numerators together and the denominators together — no common denominator needed. Then simplify.',
    idea: 'a/b × c/d = (a×c)/(b×d). Simplify before or after multiplying. Multiplying by a fraction less than 1 makes the result smaller.',
    examples: [{
      title: 'Multiply 2/3 × 3/5',
      body: '1. **Multiply across:** (2 × 3)/(3 × 5) = 6/15\n2. **Simplify:** 6/15 = **2/5**'
    }, {
      title: 'Multiply 1 1/2 × 4/5',
      body: '1. **Rewrite the mixed number:** 1 1/2 = 3/2\n2. 3/2 × 4/5 = 12/10 = **1 1/5**'
    }],
    practice: ['3/4 × 2/3  (=1/2)', '5/6 × 3/10  (=1/4)', '2/3 × 9  (=6)', '2 × 3/8  (=3/4)'],
    vocab: ['numerator, denominator', 'simplify — write in lowest terms', 'mixed number — whole part plus a fraction'],
    checks: [{ q: 'Is 2/3 × 4/5 bigger or smaller than 4/5?', a: 'Smaller — multiplying by less than 1 shrinks it.' }]
  },

  frac_divide: {
    def: 'To **divide by a fraction**, multiply by its reciprocal — "keep, change, flip."',
    idea: 'a/b ÷ c/d = a/b × d/c. Dividing by a number less than 1 gives a bigger result (how many halves fit in 3? — six).',
    examples: [{
      title: 'Divide 3/4 ÷ 1/2',
      body: '1. **Keep–change–flip:** 3/4 × 2/1\n2. **Multiply:** 6/4 = **1 1/2**  (there are one-and-a-half halves in three-quarters)'
    }, {
      title: 'Divide 1/3 ÷ 4',
      body: '1. Write 4 as 4/1, flip it: 1/3 × 1/4\n2. = **1/12**'
    }],
    trap: { setup: 'A student divided 3/4 ÷ 1/2 by flipping the first fraction instead of the second.', fix: 'Keep the first fraction, flip the one you\'re dividing BY: 3/4 × 2/1.' },
    practice: ['2/3 ÷ 1/6  (=4)', '5/8 ÷ 1/4  (=2 1/2)', '6 ÷ 1/3  (=18)', '1/2 ÷ 3  (=1/6)'],
    vocab: ['reciprocal — flip of a fraction (2/3 → 3/2)', 'quotient — the answer to a division'],
    checks: [{ q: 'What is the reciprocal of 5/8?', a: '8/5' }, { q: 'How many 1/4s are in 2?', a: '8' }]
  },

  decimals: {
    def: 'A **decimal** shows parts of a whole using place value to the right of the decimal point (tenths, hundredths, thousandths).',
    idea: 'To add or subtract, line up the decimal points. To multiply, multiply as whole numbers then count total decimal places. To divide, make the divisor a whole number by shifting both points.',
    examples: [{
      title: 'Add 3.4 + 12.75',
      body: 'Line up the points:\n```\n  3.40\n+12.75\n------\n 16.15\n```\n**Answer: 16.15**'
    }, {
      title: 'Multiply 1.2 × 0.3',
      body: '1. Ignore points: 12 × 3 = 36\n2. Total decimal places: 1 + 1 = 2 → **0.36**'
    }],
    trap: { setup: 'A student added 3.4 + 12.75 as 3.4 + 12.7 lined up on the left, getting 4.61.', fix: 'Align the DECIMAL POINTS (place value), not the left edges. Write 3.40 to match hundredths.' },
    practice: ['5.6 + 0.85  (=6.45)', '10 − 2.37  (=7.63)', '0.4 × 0.5  (=0.20)', '4.8 ÷ 0.6  (=8)'],
    vocab: ['tenths, hundredths — first two places after the point', 'decimal point — separates whole from parts'],
    checks: [{ q: 'In 5.63, what is the value of the 3?', a: 'Three hundredths (0.03).' }]
  },

  place_value: {
    def: '**Place value** is the value a digit has because of its position — each place is 10 times the place to its right.',
    idea: 'Moving left multiplies by 10 (ones → tens → hundreds …); moving right divides by 10 (ones → tenths → hundredths …).',
    examples: [{
      title: 'Name the value of the 4 in 3,452,178',
      body: 'The 4 sits in the **hundred-thousands** place, so its value is **400,000**.'
    }, {
      title: 'Name the value of the 3 in 5.63',
      body: 'The 3 is in the **hundredths** place, so its value is **0.03** (three hundredths).'
    }],
    practice: ['Value of 7 in 1,743,000?  (7 hundred-thousands = 700,000)', 'Value of 9 in 12.09?  (9 hundredths = 0.09)', 'Write 40,000 + 2,000 + 5 in standard form  (42,005)'],
    vocab: ['digit — a single symbol 0–9', 'standard form — the ordinary way to write a number'],
    checks: [{ q: 'How many times bigger is the hundreds place than the tens place?', a: '10 times.' }]
  },

  rounding: {
    def: '**Rounding** replaces a number with a nearby, simpler one to a chosen place value.',
    idea: 'Find the digit in the rounding place, look at the digit just to its right: 5 or more rounds up, less than 5 keeps it the same. Drop/zero the digits after.',
    examples: [{
      title: 'Round 3.472 to the nearest tenth',
      body: 'Tenths digit is 4; the next digit is 7 (≥ 5), so round up → **3.5**'
    }, {
      title: 'Round 1,548 to the nearest hundred',
      body: 'Hundreds digit is 5; next digit is 4 (< 5), keep it → **1,500**'
    }],
    practice: ['Round 6.28 to the nearest tenth  (6.3)', 'Round 47 to the nearest ten  (50)', 'Round 0.849 to the hundredth  (0.85)'],
    vocab: ['round up / round down', 'nearest tenth/hundred — the place you round to'],
    checks: [{ q: 'Round 2.451 to the nearest tenth.', a: '2.5 (the 5 rounds the 4 up).' }]
  },

  powers_ten: {
    def: 'A **power of 10** is 10 multiplied by itself; the exponent tells how many times, and how many zeros/decimal shifts.',
    idea: '10² = 100, 10³ = 1,000. Multiplying by 10ⁿ shifts the decimal point n places right; dividing shifts it left.',
    examples: [{ title: 'Evaluate 10³ and 2 × 10⁴', body: '10³ = 10 × 10 × 10 = **1,000**\n2 × 10⁴ = 2 × 10,000 = **20,000**' }, { title: 'Multiply 4.7 × 10²', body: 'Shift the point 2 places right → **470**' }],
    practice: ['10⁵ = ?  (100,000)', '3.2 × 10³ = ?  (3,200)', '10⁴ ÷ 10² = ?  (100)'],
    vocab: ['base — the repeated factor (10)', 'exponent — how many times to multiply'],
    checks: [{ q: 'How many zeros in 10⁶?', a: 'Six → 1,000,000.' }]
  },

  exponents: {
    def: 'An **exponent** tells how many times to use the base as a factor: bⁿ = b × b × … (n times).',
    idea: 'Product rule: bᵐ·bⁿ = bᵐ⁺ⁿ. Power rule: (bᵐ)ⁿ = bᵐⁿ. Anything (non-zero)⁰ = 1. Negative exponent = reciprocal.',
    examples: [{ title: 'Evaluate 2⁴ and 3²·3³', body: '2⁴ = 2·2·2·2 = **16**\n3²·3³ = 3²⁺³ = 3⁵ = **243**' }, { title: 'Simplify (x²)³', body: 'Multiply exponents: x²ˣ³ = **x⁶**' }],
    practice: ['5³ = ?  (125)', '2⁶ = ?  (64)', 'x⁴·x³ = ?  (x⁷)', '(2³)² = ?  (64)'],
    vocab: ['base, exponent, power', 'squared (²), cubed (³)'],
    checks: [{ q: 'What is 7⁰?', a: '1' }, { q: 'Write 2⁻² as a fraction.', a: '1/4' }]
  },

  roots: {
    def: 'A **square root** of a number gives the value that, squared, returns it; a **cube root** returns it when cubed.',
    idea: '√ undoes squaring: √49 = 7 because 7² = 49. ∛ undoes cubing: ∛27 = 3 because 3³ = 27. Most roots are irrational (√2 ≈ 1.414).',
    examples: [{ title: 'Evaluate √49 and ∛27', body: '√49 = **7** (since 7² = 49)\n∛27 = **3** (since 3³ = 27)' }, { title: 'Estimate √20', body: '4² = 16 and 5² = 25, so √20 is between 4 and 5, ≈ **4.47**' }],
    practice: ['√81 = ?  (9)', '√144 = ?  (12)', '∛8 = ?  (2)', 'Between which whole numbers is √50?  (7 and 8)'],
    vocab: ['perfect square (1, 4, 9, 16…)', 'irrational number — non-terminating, non-repeating'],
    checks: [{ q: 'Is √2 rational?', a: 'No — it never terminates or repeats.' }]
  },

  integers: {
    def: '**Integers** are the whole numbers and their opposites: … −3, −2, −1, 0, 1, 2, 3 … A number line shows them in order.',
    idea: 'Adding a negative moves left; subtracting a negative moves right. Same signs multiply/divide to a positive; different signs give a negative.',
    examples: [{ title: 'Evaluate −5 + 3 and −4 − (−7)', body: '−5 + 3: start at −5, move right 3 → **−2**\n−4 − (−7) = −4 + 7 = **3**' }, { title: 'Evaluate −4 × 6 and −24 ÷ (−3)', body: '−4 × 6 = **−24** (different signs → negative)\n−24 ÷ (−3) = **8** (same signs → positive)' }],
    trap: { setup: 'A student wrote −4 − (−7) = −11.', fix: 'Subtracting a negative adds: −4 − (−7) = −4 + 7 = 3.' },
    practice: ['−8 + 5  (=−3)', '6 − 9  (=−3)', '−3 × −7  (=21)', '20 ÷ −4  (=−5)'],
    vocab: ['opposite — same distance from 0, other side', 'absolute value — distance from 0'],
    checks: [{ q: 'What is −2 − 5?', a: '−7' }, { q: 'Sign of (−)(−)(−)?', a: 'Negative.' }]
  },

  abs_value: {
    def: '**Absolute value** is a number\'s distance from 0 on the number line — always zero or positive. Written |x|.',
    idea: '|7| = 7 and |−7| = 7 because both are 7 units from zero. Distance is never negative.',
    examples: [{ title: 'Evaluate |−7|, |7|, and |0|', body: '|−7| = **7**, |7| = **7**, |0| = **0**' }, { title: 'Evaluate |−3 + 1|', body: 'Inside first: −3 + 1 = −2, then |−2| = **2**' }],
    practice: ['|−12|  (=12)', '|15|  (=15)', '|−4| + |−6|  (=10)'],
    vocab: ['absolute value bars | |', 'distance — always non-negative'],
    checks: [{ q: 'Can absolute value be negative?', a: 'No — it is a distance.' }]
  },

  ratios: {
    def: 'A **ratio** compares two quantities; a **unit rate** is a ratio with a denominator of 1 (a per-one amount).',
    idea: 'Divide to find the unit rate. Equivalent ratios scale up or down by multiplying both parts by the same number.',
    examples: [{ title: 'Find the unit price: 12 apples cost $3', body: '$3 ÷ 12 apples = **$0.25 per apple**' }, { title: 'A car goes 150 miles in 3 hours — find the speed', body: '150 ÷ 3 = **50 miles per hour**' }],
    practice: ['8 pens for $6 — price per pen?  ($0.75)', '210 words in 3 min — words per min?  (70)', 'Recipe uses 2 cups flour : 3 eggs. For 9 eggs?  (6 cups)'],
    vocab: ['ratio a:b', 'rate — ratio of different units', 'unit rate — per one'],
    checks: [{ q: 'Unit rate for 240 miles on 8 gallons?', a: '30 miles per gallon.' }]
  },

  proportion: {
    def: 'A **proportion** says two ratios are equal. Quantities are **proportional** when one is a constant multiple of the other (y = kx).',
    idea: 'Solve a proportion by cross-multiplying, or by finding the constant of proportionality k = y/x.',
    examples: [{ title: 'Solve 3/4 = x/12', body: 'Cross-multiply: 3 × 12 = 4 × x → 36 = 4x → x = **9**' }, { title: 'Find k for the table (2,6), (3,9), (5,15)', body: 'k = y/x = 6/2 = **3**, so y = 3x.' }],
    practice: ['5/8 = x/40  (x = 25)', 'If 4 tickets cost $30, cost of 10?  ($75)', 'y = kx passes through (4,20). Find k.  (5)'],
    vocab: ['constant of proportionality k', 'cross-multiply'],
    checks: [{ q: 'Is y = 3x proportional?', a: 'Yes — it passes through (0,0) with constant 3.' }]
  },

  percent: {
    def: 'A **percent** means "per hundred." 25% = 25/100 = 0.25.',
    idea: 'To find a percent of a number, multiply by its decimal form. Percent change = (change ÷ original) × 100.',
    examples: [{ title: 'Find 25% of 80', body: '0.25 × 80 = **20**' }, { title: 'A $40 shirt is now $30 — percent decrease?', body: 'Change = 10; 10 ÷ 40 = 0.25 = **25% decrease**' }],
    practice: ['15% of 60  (=9)', '40% of 250  (=100)', 'Tip 20% on $45  ($9)', 'Price rises 8 → 10, percent increase?  (25%)'],
    vocab: ['percent (%) — per hundred', 'percent change, discount, markup'],
    checks: [{ q: 'Write 0.6 as a percent.', a: '60%' }]
  },

  solve_equations: {
    def: 'To **solve an equation** is to find the value of the variable that makes both sides equal, using inverse operations to isolate it.',
    idea: 'Undo operations in reverse order and do the SAME thing to both sides to keep it balanced. Check by substituting.',
    examples: [{ title: 'Solve 2x + 5 = 13', body: '1. Subtract 5 from both sides: 2x = 8\n2. Divide both sides by 2: x = **4**\n3. Check: 2(4) + 5 = 13 ✓' }, { title: 'Solve 3(x − 2) = 12', body: '1. Divide by 3: x − 2 = 4\n2. Add 2: x = **6**' }],
    trap: { setup: 'A student solved 2x + 5 = 13 by dividing everything by 2 first: x + 5 = 6.5.', fix: 'Undo addition/subtraction before multiplication/division: subtract 5 first, THEN divide by 2.' },
    practice: ['x − 7 = 10  (x = 17)', '4x = 36  (x = 9)', '3x − 4 = 11  (x = 5)', '(x/2) + 1 = 6  (x = 10)'],
    vocab: ['variable, coefficient, constant', 'inverse operation, isolate'],
    checks: [{ q: 'First step to solve 5x − 3 = 12?', a: 'Add 3 to both sides.' }]
  },

  inequalities: {
    def: 'An **inequality** compares expressions with <, >, ≤, or ≥ and usually has many solutions shown on a number line.',
    idea: 'Solve like an equation, but **flip the inequality sign** whenever you multiply or divide both sides by a negative number.',
    examples: [{ title: 'Solve 3x − 2 > 7', body: '1. Add 2: 3x > 9\n2. Divide by 3: **x > 3** (open circle at 3, arrow right)' }, { title: 'Solve −2x ≥ 8', body: 'Divide by −2 and FLIP: **x ≤ −4**' }],
    trap: { setup: 'A student solved −2x ≥ 8 as x ≥ −4.', fix: 'Dividing by a negative flips the sign: x ≤ −4.' },
    practice: ['x + 4 < 9  (x < 5)', '5x ≤ 20  (x ≤ 4)', '−3x < 12  (x > −4)'],
    vocab: ['< > ≤ ≥', 'open vs closed circle on a number line'],
    checks: [{ q: 'When do you flip the sign?', a: 'When multiplying or dividing by a negative.' }]
  },

  slope_linear: {
    def: 'A **linear function** graphs as a straight line. In y = mx + b, **m** is the slope (steepness) and **b** is the y-intercept (where it crosses the y-axis).',
    idea: 'Slope = rise/run = (y₂ − y₁)/(x₂ − x₁). Positive slope rises left→right; negative falls; zero is flat.',
    examples: [{ title: 'Find the slope through (1, 2) and (3, 8)', body: 'm = (8 − 2)/(3 − 1) = 6/2 = **3**' }, { title: 'Graph y = 2x + 1', body: 'Start at the y-intercept **(0, 1)**; slope 2 means up 2, right 1 to (1, 3). Connect.' }],
    practice: ['Slope through (0,0),(4,8)?  (2)', 'Slope through (2,5),(6,5)?  (0)', 'y-intercept of y = −3x + 7?  (7)'],
    vocab: ['slope m', 'y-intercept b', 'rise over run'],
    checks: [{ q: 'What does m = 0 mean?', a: 'A horizontal line.' }]
  },

  systems: {
    def: 'A **system of equations** is two or more equations solved together; the solution is the point that makes ALL of them true (where the lines cross).',
    idea: 'Solve by substitution (isolate a variable and plug in) or elimination (add/subtract equations to cancel a variable).',
    examples: [{ title: 'Solve y = x + 1 and y = 2x − 1', body: '1. Set equal: x + 1 = 2x − 1\n2. Solve: 1 + 1 = 2x − x → x = **2**\n3. Back-substitute: y = 2 + 1 = **3** → solution (2, 3)' }],
    practice: ['y = x, y = −x + 4  ((2,2))', 'x + y = 10, x − y = 2  ((6,4))'],
    vocab: ['substitution, elimination', 'point of intersection'],
    checks: [{ q: 'What does the solution represent graphically?', a: 'Where the lines intersect.' }]
  },

  quadratics: {
    def: 'A **quadratic** has an x² term; ax² + bx + c. Its graph is a **parabola** (a U-shape).',
    idea: 'Factor to find where it equals zero (the x-intercepts / roots). If (x − p)(x − q) = 0 then x = p or x = q.',
    examples: [{ title: 'Factor x² + 5x + 6', body: 'Find two numbers that multiply to 6 and add to 5 → 2 and 3.\nx² + 5x + 6 = **(x + 2)(x + 3)**' }, { title: 'Solve x² − 5x + 6 = 0', body: 'Factor: (x − 2)(x − 3) = 0 → x = **2** or x = **3**' }],
    practice: ['Factor x² + 7x + 12  ((x+3)(x+4))', 'Solve x² − 9 = 0  (x = ±3)', 'Solve x² + x − 6 = 0  (x = 2, −3)'],
    vocab: ['parabola, vertex, roots/zeros', 'factor'],
    checks: [{ q: 'How many roots can a quadratic have?', a: 'Zero, one, or two real roots.' }]
  },

  pythagorean: {
    def: 'The **Pythagorean theorem** relates the sides of a right triangle: a² + b² = c², where c is the hypotenuse (opposite the right angle).',
    idea: 'Use it to find a missing side of a right triangle. The hypotenuse is always the longest side.',
    examples: [{ title: 'Legs 3 and 4 — find the hypotenuse', body: 'c² = 3² + 4² = 9 + 16 = 25 → c = √25 = **5**' }, { title: 'Hypotenuse 13, one leg 5 — find the other', body: 'b² = 13² − 5² = 169 − 25 = 144 → b = **12**' }],
    practice: ['Legs 6, 8 → hypotenuse?  (10)', 'Legs 5, 12 → hypotenuse?  (13)', 'Hyp 10, leg 6 → other leg?  (8)'],
    vocab: ['right triangle, legs, hypotenuse'],
    checks: [{ q: 'Which side is c?', a: 'The hypotenuse, opposite the right angle.' }]
  },

  area: {
    def: '**Area** is the amount of surface a 2-D shape covers, measured in square units.',
    idea: 'Rectangle: length × width. Triangle: ½ × base × height. Circle: π r². Use the height perpendicular to the base.',
    examples: [{ title: 'Area of a triangle, base 6, height 4', body: 'A = ½ × 6 × 4 = **12 square units**' }, { title: 'Area of a circle, radius 5', body: 'A = π × 5² = 25π ≈ **78.5 square units**' }],
    practice: ['Rectangle 7 × 3  (=21)', 'Triangle base 10, height 5  (=25)', 'Circle radius 3 (area)  (≈28.3)'],
    vocab: ['base, height (perpendicular)', 'radius, π ≈ 3.14', 'square units'],
    checks: [{ q: 'Area of a triangle formula?', a: '½ × base × height.' }]
  },

  volume: {
    def: '**Volume** is the space a 3-D solid takes up, measured in cubic units.',
    idea: 'Rectangular prism: length × width × height (or base area × height). Cylinder: π r² × height.',
    examples: [{ title: 'Volume of a box 3 × 4 × 5', body: 'V = 3 × 4 × 5 = **60 cubic units**' }, { title: 'Volume of a cylinder, r = 2, h = 5', body: 'V = π × 2² × 5 = 20π ≈ **62.8 cubic units**' }],
    practice: ['Box 2 × 3 × 6  (=36)', 'Cube side 4  (=64)', 'Cylinder r = 3, h = 10  (≈282.7)'],
    vocab: ['cubic units', 'base area × height'],
    checks: [{ q: 'Units for volume?', a: 'Cubic units (e.g. cm³).' }]
  },

  surface_area: {
    def: '**Surface area** is the total area of all the faces of a 3-D solid — imagine unfolding it into a flat net.',
    idea: 'Add the area of every face. A net makes each face visible so none is missed.',
    examples: [{ title: 'Surface area of a 2 × 3 × 4 box', body: 'Faces come in pairs: 2(2×3) + 2(3×4) + 2(2×4) = 12 + 24 + 16 = **52 square units**' }],
    practice: ['Cube side 5 (surface area)  (150)', 'Box 1 × 2 × 3  (22)'],
    vocab: ['face, net, square units'],
    checks: [{ q: 'How does a net help?', a: 'It shows every face flat so you can add them all.' }]
  },

  coordinate_plane: {
    def: 'The **coordinate plane** locates points with an ordered pair (x, y): x is right/left, y is up/down, from the origin (0, 0).',
    idea: 'The axes split the plane into four quadrants. Plot x first, then y. Signs tell direction.',
    examples: [{ title: 'Plot (3, −2)', body: 'From the origin go **right 3**, then **down 2**. That point is in **Quadrant IV**.' }, { title: 'Name the quadrant of (−4, 5)', body: 'Left and up → **Quadrant II**.' }],
    practice: ['Which quadrant is (−2, −6)?  (III)', 'Plot (0, 4) — where is it?  (on the y-axis)', 'Distance from (1,2) to (1,7)?  (5)'],
    vocab: ['origin, axes, ordered pair, quadrant'],
    checks: [{ q: 'In (x, y) which comes first?', a: 'x (horizontal).' }]
  },

  mean_median: {
    def: '**Measures of center** summarize a data set: **mean** (average), **median** (middle value), **mode** (most frequent).',
    idea: 'Mean = sum ÷ count. Median = middle of the ORDERED list (average the two middle values if even). Mode = value that appears most.',
    examples: [{ title: 'Find mean, median, mode of 4, 8, 8, 5, 10', body: 'Mean = (4+8+8+5+10)/5 = 35/5 = **7**\nOrdered: 4, 5, 8, 8, 10 → median = **8**\nMode = **8** (appears twice)' }],
    practice: ['Mean of 3, 7, 5, 9  (6)', 'Median of 2, 9, 4, 6, 8  (6)', 'Mode of 1, 2, 2, 3, 3, 3  (3)'],
    vocab: ['mean, median, mode, range', 'outlier'],
    checks: [{ q: 'What must you do before finding the median?', a: 'Put the data in order.' }]
  },

  probability: {
    def: '**Probability** measures how likely an event is, from 0 (impossible) to 1 (certain): favorable outcomes ÷ total outcomes.',
    idea: 'For equally likely outcomes, P(event) = (ways it happens)/(total ways). Compound events multiply independent probabilities.',
    examples: [{ title: 'Roll a die — P(even number)', body: 'Even outcomes: 2, 4, 6 → 3 of 6 → P = 3/6 = **1/2**' }, { title: 'Two coins — P(both heads)', body: 'P(H) × P(H) = 1/2 × 1/2 = **1/4**' }],
    practice: ['Bag: 3 red, 2 blue. P(red)?  (3/5)', 'Die — P(number > 4)?  (1/3)', 'P(tails then tails)?  (1/4)'],
    vocab: ['outcome, event', 'independent events'],
    checks: [{ q: 'What is the probability range?', a: '0 to 1.' }]
  },

  scientific_notation: {
    def: '**Scientific notation** writes very large or small numbers as a × 10ⁿ, where 1 ≤ a < 10.',
    idea: 'Move the decimal so one non-zero digit is in front; the number of moves is the exponent (right-moves make it negative).',
    examples: [{ title: 'Write 4,200 in scientific notation', body: 'Move the point 3 places left: **4.2 × 10³**' }, { title: 'Write 0.00056 in scientific notation', body: 'Move the point 4 places right: **5.6 × 10⁻⁴**' }],
    practice: ['53,000 → ?  (5.3 × 10⁴)', '0.0009 → ?  (9 × 10⁻⁴)', '7.1 × 10³ as a number  (7,100)'],
    vocab: ['coefficient a, power of 10'],
    checks: [{ q: 'Is 42 × 10³ proper scientific notation?', a: 'No — the leading number must be between 1 and 10.' }]
  },

  // ---- science ----
  newtons_laws: {
    def: '**Newton\'s laws of motion** describe how forces change motion. 1st: objects keep their motion unless a net force acts (inertia). 2nd: F = m·a. 3rd: every action has an equal, opposite reaction.',
    idea: 'A net (unbalanced) force accelerates an object in its direction. Acceleration = force ÷ mass, so heavier objects need more force for the same acceleration.',
    examples: [{ title: 'A 10 kg cart is pushed with a net 20 N force — find its acceleration', body: 'F = m·a → a = F/m = 20 N ÷ 10 kg = **2 m/s²**' }, { title: '3rd law example', body: 'A swimmer pushes water backward (action); the water pushes the swimmer forward (reaction).' }],
    trap: { setup: 'A student thinks a moving object needs a constant force to keep moving.', fix: 'By the 1st law, with no net force an object keeps moving at constant velocity — friction is what slows it.' },
    practice: ['Force to give a 5 kg mass 4 m/s²?  (20 N)', 'a of a 2 kg ball pushed with 10 N?  (5 m/s²)', 'Name the reaction to a rocket pushing gas down.  (gas pushes rocket up)'],
    vocab: ['force (N), mass (kg), acceleration (m/s²)', 'inertia, net force'],
    checks: [{ q: 'State F = ma in words.', a: 'Net force equals mass times acceleration.' }]
  },

  forces: {
    def: 'A **force** is a push or pull. When forces are **balanced** (net = 0) motion doesn\'t change; **unbalanced** forces change motion.',
    idea: 'Add forces with direction to get the net force. Equal and opposite forces cancel.',
    examples: [{ title: 'Net force: 5 N right and 3 N left', body: '5 − 3 = **2 N to the right** (unbalanced → object accelerates right)' }, { title: 'Tug-of-war, 200 N each side', body: 'Net force = 0 → **balanced**, the rope doesn\'t move.' }],
    practice: ['8 N right, 8 N left — net?  (0, balanced)', '10 N right, 4 N left — net?  (6 N right)'],
    vocab: ['net force, balanced/unbalanced', 'newton (N)'],
    checks: [{ q: 'What do balanced forces do to motion?', a: 'Nothing — motion stays the same.' }]
  },

  energy: {
    def: '**Energy** is the ability to do work. **Kinetic energy** is energy of motion; **potential energy** is stored energy (e.g. from height).',
    idea: 'KE = ½mv² grows with the square of speed. Gravitational PE = mgh grows with height. Energy transforms but is conserved.',
    examples: [{ title: 'KE of a 2 kg ball moving 3 m/s', body: 'KE = ½ × 2 × 3² = ½ × 2 × 9 = **9 joules**' }, { title: 'PE of a 5 kg box lifted 2 m (g ≈ 10)', body: 'PE = m·g·h = 5 × 10 × 2 = **100 joules**' }],
    practice: ['KE of 4 kg at 2 m/s?  (8 J)', 'Double the speed — KE changes by?  (×4)', 'PE of 2 kg at 3 m (g=10)?  (60 J)'],
    vocab: ['kinetic, potential energy', 'joule (J), conservation of energy'],
    checks: [{ q: 'What happens to KE if speed doubles?', a: 'It quadruples (speed is squared).' }]
  },

  density: {
    def: '**Density** is how much mass is packed into a volume: density = mass ÷ volume.',
    idea: 'Objects denser than water sink; less dense float. Units are g/cm³ or kg/m³.',
    examples: [{ title: 'Density of a 20 g object with volume 10 cm³', body: 'd = m/V = 20 g ÷ 10 cm³ = **2 g/cm³**' }, { title: 'Will it float in water (1 g/cm³)?', body: '2 g/cm³ > 1 g/cm³, so it **sinks**.' }],
    practice: ['Mass 50 g, volume 25 cm³ — density?  (2 g/cm³)', 'Density 0.8 g/cm³ — float or sink?  (float)'],
    vocab: ['mass, volume, density', 'g/cm³'],
    checks: [{ q: 'Formula for density?', a: 'mass ÷ volume.' }]
  },

  photosynthesis: {
    def: '**Photosynthesis** is how plants use light energy to make food (glucose) from carbon dioxide and water, releasing oxygen.',
    idea: 'Reaction: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. It happens in chloroplasts using chlorophyll. Cellular respiration reverses it to release energy.',
    examples: [{ title: 'Label the inputs and outputs', body: '**Inputs:** carbon dioxide, water, light energy.\n**Outputs:** glucose (stored energy) and oxygen.' }, { title: 'Why are leaves green?', body: 'Chlorophyll absorbs red and blue light and reflects green, so leaves look green.' }],
    practice: ['Where does it occur?  (chloroplasts)', 'What gas is released?  (oxygen)', 'What does the plant use the glucose for?  (energy/growth)'],
    vocab: ['chlorophyll, chloroplast, glucose', 'carbon dioxide, oxygen'],
    checks: [{ q: 'What are the two raw materials?', a: 'Carbon dioxide and water.' }]
  },

  cell: {
    def: 'The **cell** is the basic unit of life. Each part (organelle) has a job that keeps the cell alive.',
    idea: 'Nucleus = control center (DNA). Cell membrane = controls what enters/leaves. Cytoplasm = fluid where reactions happen. Mitochondria = release energy. Plant cells also have a cell wall and chloroplasts.',
    examples: [{ title: 'Match part to job', body: '**Nucleus** → directs the cell. **Membrane** → gatekeeper. **Mitochondria** → power plant. **Chloroplast** (plants) → photosynthesis.' }, { title: 'Plant vs animal cell', body: 'Plant cells add a rigid **cell wall** and **chloroplasts**; animal cells have neither.' }],
    practice: ['Which part controls the cell?  (nucleus)', 'Which part makes energy?  (mitochondria)', 'Name one part only plant cells have.  (cell wall or chloroplast)'],
    vocab: ['organelle, nucleus, membrane, cytoplasm, mitochondria'],
    checks: [{ q: 'What is the "control center"?', a: 'The nucleus.' }]
  },

  atoms: {
    def: 'An **atom** is the smallest unit of an element. It has a nucleus of **protons** (+) and **neutrons** (neutral), surrounded by **electrons** (−).',
    idea: 'The atomic number = number of protons (which element it is). In a neutral atom, protons = electrons. The periodic table organizes elements by atomic number.',
    examples: [{ title: 'Describe a carbon atom (atomic number 6)', body: '6 protons, 6 electrons, and (for carbon-12) 6 neutrons.' }, { title: 'How many electrons in a neutral oxygen atom (8 protons)?', body: 'Neutral → electrons = protons = **8**.' }],
    practice: ['Charge of a proton?  (positive)', 'Neutral atom with 11 protons — electrons?  (11)', 'What does the atomic number tell you?  (# of protons / the element)'],
    vocab: ['proton, neutron, electron', 'nucleus, atomic number, element'],
    checks: [{ q: 'What particle is negative?', a: 'The electron.' }]
  },

  chemical_reactions: {
    def: 'In a **chemical reaction**, substances (reactants) rearrange into new substances (products). Mass is conserved — atoms are neither created nor destroyed.',
    idea: 'A balanced equation has the same number of each atom on both sides. Balance by adjusting coefficients (not subscripts).',
    examples: [{ title: 'Balance H₂ + O₂ → H₂O', body: 'Balanced: **2H₂ + O₂ → 2H₂O** (4 H and 2 O on each side).' }, { title: 'Conservation of mass', body: 'If 10 g of reactants combine, the products also total **10 g**.' }],
    practice: ['Balance: N₂ + H₂ → NH₃  (N₂ + 3H₂ → 2NH₃)', 'Reactant vs product side?  (left → right)', 'Can atoms disappear in a reaction?  (no)'],
    vocab: ['reactant, product, coefficient', 'conservation of mass'],
    checks: [{ q: 'What stays equal on both sides of a balanced equation?', a: 'The count of each type of atom.' }]
  },

  waves: {
    def: 'A **wave** carries energy from place to place without carrying matter. Key traits: wavelength, frequency, amplitude, and speed.',
    idea: 'Wavelength is crest-to-crest distance; frequency is waves per second (Hz); amplitude relates to energy. Speed = frequency × wavelength.',
    examples: [{ title: 'Find wave speed: frequency 5 Hz, wavelength 2 m', body: 'v = f × λ = 5 × 2 = **10 m/s**' }, { title: 'Higher amplitude means…', body: 'More energy (a louder sound or brighter light).' }],
    practice: ['f = 10 Hz, λ = 3 m — speed?  (30 m/s)', 'What does amplitude relate to?  (energy)', 'Units of frequency?  (Hz)'],
    vocab: ['wavelength, frequency, amplitude', 'crest, trough'],
    checks: [{ q: 'Does a wave move matter along with it?', a: 'No — it transfers energy.' }]
  },

  reflection: {
    def: 'The **law of reflection**: when light hits a surface, the angle of incidence equals the angle of reflection (both measured from the normal).',
    idea: 'The normal is a line perpendicular to the surface. Smooth surfaces reflect evenly (mirror); rough surfaces scatter light.',
    examples: [{ title: 'Light hits a mirror at 30° from the normal', body: 'It reflects at **30°** on the other side of the normal.' }, { title: 'Why can you see yourself in a mirror but not in paper?', body: 'A mirror is smooth (even reflection); paper is rough (scattered reflection).' }],
    practice: ['Incidence 45° — reflection angle?  (45°)', 'Angles are measured from what line?  (the normal)'],
    vocab: ['angle of incidence/reflection, normal', 'reflection, refraction'],
    checks: [{ q: 'State the law of reflection.', a: 'Angle of incidence = angle of reflection.' }]
  },

  natural_selection: {
    def: '**Natural selection** is how populations change over time: individuals with helpful traits survive and reproduce more, so those traits become more common.',
    idea: 'Requires variation, inheritance, and differential survival. Over many generations this leads to adaptation and, ultimately, evolution.',
    examples: [{ title: 'Peppered moths', body: 'When pollution darkened tree bark, dark moths were better camouflaged, survived more, and became common — a shift driven by selection.' }, { title: 'Beak size in finches', body: 'In a drought with only large seeds, larger-beaked finches ate better and left more offspring.' }],
    practice: ['Name the three requirements.  (variation, inheritance, differential survival)', 'What is an adaptation?  (a trait that improves survival/reproduction)'],
    vocab: ['variation, adaptation, fitness', 'selection pressure'],
    checks: [{ q: 'Do individuals evolve?', a: 'No — populations change over generations.' }]
  },

  numerical_expressions: {
    def: 'An **expression** combines numbers, variables, and operations (no equals sign). To **evaluate** it, substitute values and follow the order of operations.',
    idea: 'Write words as math ("5 more than twice n" → 2n + 5). Evaluate by replacing the variable and simplifying.',
    examples: [{ title: 'Evaluate 3(x + 4) when x = 2', body: '3(2 + 4) = 3 × 6 = **18**' }, { title: 'Write "7 less than a number n"', body: '**n − 7**' }],
    practice: ['Evaluate 2a + 5 when a = 3  (11)', 'Write "twice a number plus 1"  (2n + 1)', 'Evaluate 4(y − 1) when y = 5  (16)'],
    vocab: ['expression, variable, term, coefficient', 'evaluate, substitute'],
    checks: [{ q: 'What\'s the difference between an expression and an equation?', a: 'An equation has an equals sign; an expression does not.' }]
  },

  multiply_whole: {
    def: '**Multi-digit multiplication** breaks a product into place-value parts (partial products) and adds them.',
    idea: 'Multiply by each place value, then add. The area/box model shows why it works.',
    examples: [{ title: 'Multiply 34 × 26', body: '34 × 20 = 680 and 34 × 6 = 204\n680 + 204 = **884**' }],
    practice: ['23 × 15  (=345)', '46 × 32  (=1,472)', '125 × 8  (=1,000)'],
    vocab: ['factor, product, partial product'],
    checks: [{ q: 'What are the partial products of 12 × 13?', a: '12×10=120 and 12×3=36, total 156.' }]
  },

  long_division: {
    def: '**Long division** finds how many times a divisor fits into a number, digit by digit, with any remainder.',
    idea: 'Divide, multiply, subtract, bring down — repeat. The remainder is what\'s left over.',
    examples: [{ title: 'Divide 754 ÷ 23', body: '23 × 30 = 690; 754 − 690 = 64\n23 × 2 = 46; 64 − 46 = 18\nSo 754 ÷ 23 = **32 remainder 18**' }],
    practice: ['96 ÷ 4  (=24)', '585 ÷ 15  (=39)', '460 ÷ 22  (=20 R20)'],
    vocab: ['dividend, divisor, quotient, remainder'],
    checks: [{ q: 'In 754 ÷ 23, which number is the divisor?', a: '23.' }]
  },

  gcf_lcm: {
    def: '**GCF** (greatest common factor) is the largest number that divides two numbers; **LCM** (least common multiple) is the smallest number both divide into.',
    idea: 'Use prime factors: GCF multiplies the shared factors; LCM multiplies each factor the greatest number of times it appears.',
    examples: [{ title: 'GCF of 12 and 18', body: '12 = 2²·3, 18 = 2·3² → shared: 2·3 = **6**' }, { title: 'LCM of 4 and 6', body: '4 = 2², 6 = 2·3 → 2²·3 = **12**' }],
    practice: ['GCF(16, 24)  (8)', 'LCM(3, 5)  (15)', 'GCF(20, 30)  (10)', 'LCM(6, 8)  (24)'],
    vocab: ['factor, multiple, prime factorization'],
    checks: [{ q: 'When is the LCM just the product of the two numbers?', a: 'When they share no common factors (coprime).' }]
  },

  patterns: {
    def: 'A **number pattern** follows a rule; finding the rule lets you extend it or predict any term.',
    idea: 'Look at how each term changes (add, multiply, etc.). A rule like "start at a, add d each time" gives the nth term.',
    examples: [{ title: 'Find the rule and next term: 2, 5, 8, 11, …', body: 'Each term adds 3 → rule "add 3". Next term = 11 + 3 = **14**. The nth term = 3n − 1.' }],
    practice: ['Next in 3, 6, 12, 24, …?  (48, ×2)', 'Rule for 20, 17, 14, 11?  (subtract 3)', '10th term of 1, 4, 7, 10…?  (28)'],
    vocab: ['term, rule, sequence'],
    checks: [{ q: 'What operation makes 2, 6, 18, 54?', a: 'Multiply by 3.' }]
  },

  classify_shapes: {
    def: 'Two-dimensional figures are **classified** by their sides and angles; categories can nest (a square is also a rectangle and a rhombus).',
    idea: 'Quadrilateral → parallelogram (2 pairs parallel) → rectangle (right angles) / rhombus (equal sides) → square (both).',
    examples: [{ title: 'Why is a square a rectangle?', body: 'A rectangle needs 4 right angles; a square has 4 right angles (and equal sides), so every square fits the rectangle definition.' }],
    practice: ['Is every rectangle a square?  (No)', 'A shape with exactly one pair of parallel sides?  (trapezoid)', 'A parallelogram with 4 equal sides?  (rhombus)'],
    vocab: ['quadrilateral, parallelogram, rhombus, trapezoid'],
    checks: [{ q: 'What makes a square special among rectangles?', a: 'All four sides are equal.' }]
  },

  unit_convert: {
    def: '**Unit conversion** rewrites a measurement in different units using a known relationship (e.g. 1 km = 1,000 m).',
    idea: 'Multiply or divide by the conversion factor. Going to a smaller unit multiplies; to a larger unit divides.',
    examples: [{ title: 'Convert 5 km to meters', body: '1 km = 1,000 m → 5 × 1,000 = **5,000 m**' }, { title: 'Convert 2.5 hours to minutes', body: '1 h = 60 min → 2.5 × 60 = **150 min**' }],
    practice: ['3 m to cm  (300)', '4,000 g to kg  (4)', '2 ft to inches  (24)'],
    vocab: ['conversion factor, metric units'],
    checks: [{ q: 'To convert meters to centimeters, multiply or divide?', a: 'Multiply by 100.' }]
  },

  data_displays: {
    def: 'Data can be shown as a **dot plot** (each dot = one value), a **histogram** (bars over intervals), or a **box plot** (five-number summary).',
    idea: 'Choose a display for the question: dot plots show every value, histograms show shape over ranges, box plots show spread and median.',
    examples: [{ title: 'Read a box plot', body: 'A box plot marks the minimum, Q1, median, Q3, and maximum. The box spans Q1–Q3 (the middle 50%); the line inside is the median.' }],
    practice: ['Which display shows the middle 50%?  (box plot)', 'Which shows every individual value?  (dot plot)', 'Bars over intervals with no gaps?  (histogram)'],
    vocab: ['dot plot, histogram, box plot', 'median, quartile, range'],
    checks: [{ q: 'What does the line inside a box plot show?', a: 'The median.' }]
  },

  functions: {
    def: 'A **function** pairs each input with exactly one output. f(x) is the output for input x.',
    idea: 'Evaluate by substituting the input. On a graph, the vertical-line test checks whether a relation is a function.',
    examples: [{ title: 'Evaluate f(x) = 2x + 1 at x = 3', body: 'f(3) = 2(3) + 1 = **7**' }, { title: 'Is a circle a function?', body: 'No — a vertical line crosses it twice, so one input has two outputs.' }],
    practice: ['f(x) = x² , find f(4)  (16)', 'g(x) = 5 − x, find g(2)  (3)', 'Does y = x + 1 pass the vertical-line test?  (yes)'],
    vocab: ['input, output, domain, range', 'function notation f(x)'],
    checks: [{ q: 'How many outputs can one input have in a function?', a: 'Exactly one.' }]
  },

  transformations: {
    def: 'A **transformation** moves a shape: translation (slide), reflection (flip), rotation (turn), or dilation (resize).',
    idea: 'Translations and reflections and rotations keep size and shape (congruent). Dilations change size (similar).',
    examples: [{ title: 'Translate (2, 3) right 4 and up 1', body: '(2 + 4, 3 + 1) = **(6, 4)**' }, { title: 'Reflect (2, 3) over the x-axis', body: 'Flip the y-sign → **(2, −3)**' }],
    practice: ['Reflect (5, −1) over the y-axis  ((−5, −1))', 'Translate (0, 0) by (−3, 2)  ((−3, 2))', 'Does rotation change size?  (no)'],
    vocab: ['translation, reflection, rotation, dilation', 'congruent, similar'],
    checks: [{ q: 'Which transformation changes size?', a: 'Dilation.' }]
  },

  trig: {
    def: '**Right-triangle trigonometry** relates an angle to side ratios: SOH-CAH-TOA (sin = opp/hyp, cos = adj/hyp, tan = opp/adj).',
    idea: 'Label the sides relative to the angle, pick the ratio that uses your known/unknown sides, and solve.',
    examples: [{ title: 'Opposite 3, hypotenuse 5 — find sin θ', body: 'sin θ = opposite/hypotenuse = 3/5 = **0.6**' }, { title: 'Find tan θ with opposite 4, adjacent 3', body: 'tan θ = 4/3 ≈ **1.33**' }],
    practice: ['cos θ with adjacent 8, hyp 10?  (0.8)', 'Which ratio uses opposite & adjacent?  (tangent)'],
    vocab: ['opposite, adjacent, hypotenuse', 'sine, cosine, tangent'],
    checks: [{ q: 'What does SOH stand for?', a: 'Sine = Opposite / Hypotenuse.' }]
  },

  circle_geo: {
    def: 'In a **circle**, a central angle equals its arc, and an **inscribed angle** is half the central angle that subtends the same arc.',
    idea: 'Central angle = arc measure. Inscribed angle = ½ × its intercepted arc. Arc length and sector area scale with the angle.',
    examples: [{ title: 'Inscribed angle intercepts an 80° arc — find it', body: 'Inscribed angle = ½ × 80° = **40°**' }, { title: 'Central angle for a 90° arc', body: 'Central angle = the arc = **90°**' }],
    practice: ['Inscribed angle for a 100° arc?  (50°)', 'Arc for a 30° inscribed angle?  (60°)'],
    vocab: ['central angle, inscribed angle, arc, sector'],
    checks: [{ q: 'How do inscribed and central angles compare on the same arc?', a: 'Inscribed is half the central.' }]
  },

  genetics: {
    def: '**Inheritance** passes traits from parents to offspring through genes. A **Punnett square** predicts the odds of each combination.',
    idea: 'Dominant alleles (T) mask recessive (t). A Tt × Tt cross gives 1 TT : 2 Tt : 1 tt — a 3:1 ratio of dominant to recessive traits.',
    examples: [{ title: 'Cross Tt × Tt', body: 'Punnett square gives TT, Tt, Tt, tt → **3 tall : 1 short** (75% show the dominant trait).' }],
    practice: ['Genotype ratio of Tt × Tt?  (1:2:1)', 'What masks a recessive allele?  (a dominant allele)', 'tt shows which trait?  (recessive)'],
    vocab: ['gene, allele, dominant, recessive', 'genotype, phenotype, Punnett square'],
    checks: [{ q: 'What ratio of traits comes from Tt × Tt?', a: '3 dominant : 1 recessive.' }]
  },

  ecosystems: {
    def: 'In an **ecosystem**, energy flows from producers to consumers to decomposers, and matter cycles. A food web shows these links.',
    idea: 'Producers (plants) capture sunlight; only about 10% of energy passes to each next level, so there are fewer top predators.',
    examples: [{ title: 'Trace energy: grass → grasshopper → frog → snake', body: 'Grass (producer) → grasshopper (primary consumer) → frog (secondary) → snake (tertiary). Energy decreases at each step.' }],
    practice: ['What are plants called in a food web?  (producers)', 'About how much energy passes to the next level?  (~10%)', 'Who breaks down dead matter?  (decomposers)'],
    vocab: ['producer, consumer, decomposer', 'food web, trophic level'],
    checks: [{ q: 'Why are there few top predators?', a: 'Energy shrinks at each level, so less is available higher up.' }]
  },

  states_matter: {
    def: '**States of matter** — solid, liquid, gas — differ in how their particles are arranged and how much they move.',
    idea: 'Adding energy (heat) speeds particles up: solids melt to liquids, liquids boil to gases. Removing energy reverses it.',
    examples: [{ title: 'Heating ice', body: 'Ice (solid) → melts to water (liquid) at 0 °C → boils to steam (gas) at 100 °C as energy is added.' }],
    practice: ['Which state has particles locked in place?  (solid)', 'What happens to particle motion when heated?  (speeds up)', 'Liquid → gas is called?  (evaporation/boiling)'],
    vocab: ['solid, liquid, gas', 'melting, freezing, evaporation, condensation'],
    checks: [{ q: 'What changes a solid into a liquid?', a: 'Adding energy (heat) — melting.' }]
  },

  bonding: {
    def: 'Atoms form **chemical bonds** to become stable. **Ionic** bonds transfer electrons; **covalent** bonds share them.',
    idea: 'Metals + nonmetals tend to form ionic bonds (e.g. NaCl). Nonmetals sharing electrons form covalent bonds (e.g. H₂O).',
    examples: [{ title: 'Ionic vs covalent', body: '**NaCl** — sodium gives an electron to chlorine (ionic).\n**H₂O** — oxygen and hydrogen share electrons (covalent).' }],
    practice: ['Bond type in table salt (NaCl)?  (ionic)', 'Bond type in water (H₂O)?  (covalent)', 'What do atoms transfer in an ionic bond?  (electrons)'],
    vocab: ['ion, ionic bond, covalent bond, electron'],
    checks: [{ q: 'What\'s the difference between ionic and covalent bonds?', a: 'Ionic transfers electrons; covalent shares them.' }]
  },

  plate_tectonics: {
    def: '**Plate tectonics**: Earth\'s outer shell is broken into plates that slowly move on the mantle, reshaping the surface.',
    idea: 'Plate boundaries cause earthquakes, volcanoes, and mountains. Plates can converge (collide), diverge (spread), or slide past each other.',
    examples: [{ title: 'Boundary types', body: '**Convergent:** plates collide → mountains/volcanoes. **Divergent:** plates spread → new crust. **Transform:** plates slide → earthquakes.' }],
    practice: ['What drives plate movement?  (heat/convection in the mantle)', 'Boundary that builds mountains?  (convergent)', 'What forms at divergent boundaries?  (new crust)'],
    vocab: ['plate, mantle, boundary', 'convergent, divergent, transform'],
    checks: [{ q: 'Name one event caused by moving plates.', a: 'Earthquakes (or volcanoes/mountains).' }]
  },

  weather: {
    def: '**Weather** is the day-to-day state of the atmosphere; **climate** is the long-term average. The **water cycle** drives much of it.',
    idea: 'Water evaporates, condenses into clouds, and falls as precipitation. Uneven heating and air pressure move weather around.',
    examples: [{ title: 'The water cycle', body: 'Sun heats water → **evaporation** → **condensation** into clouds → **precipitation** (rain/snow) → runoff/collection → repeat.' }],
    practice: ['Weather vs climate?  (short-term vs long-term)', 'Water vapor → clouds is called?  (condensation)', 'What powers the water cycle?  (the Sun)'],
    vocab: ['evaporation, condensation, precipitation', 'weather, climate, atmosphere'],
    checks: [{ q: 'Is climate short-term or long-term?', a: 'Long-term average.' }]
  }
};

// ---- title → concept key ----------------------------------------------------
function detectKey(title) {
  const t = String(title || '').toLowerCase();
  const has = (...ks) => ks.some((k) => t.includes(k));

  // math (order: specific → general)
  if (has('order of operations')) return 'order_ops';
  if (has('unlike denominator') || has('add and subtract fraction') || has('add and subtract mixed')) return 'frac_addsub';
  if (has('multiply fraction') || has('multiply and divide fraction')) return 'frac_multiply';
  if (has('divide unit fraction') || has('divide fraction') || has('dividing fraction')) return 'frac_divide';
  if (has('decimal')) return 'decimals';
  if (has('place value')) return 'place_value';
  if (has('round')) return 'rounding';
  if (has('powers of 10') || has('power of 10')) return 'powers_ten';
  if (has('square root') || has('cube root') || (has('root') && !has('square rooted'))) return 'roots';
  if (has('exponent') || has('integer exponent')) return 'exponents';
  if (has('scientific notation')) return 'scientific_notation';
  if (has('absolute value')) return 'abs_value';
  if (has('integer') || has('negative number')) return 'integers';
  if (has('unit rate') || has('ratio')) return 'ratios';
  if (has('proportional') || has('proportion') || has('constant of proportionality')) return 'proportion';
  if (has('percent')) return 'percent';
  if (has('system of') || has('systems of')) return 'systems';
  if (has('inequalit')) return 'inequalities';
  if (has('quadratic') || has('factor quadratic') || has('parabola')) return 'quadratics';
  if (has('slope') || has('linear') || has('straight line') || has('line of best fit') || has('proportional relationships and slope')) return 'slope_linear';
  if (has('solve') && (has('equation') || has('inequalit'))) return has('inequalit') ? 'inequalities' : 'solve_equations';
  if (has('equation')) return 'solve_equations';
  if (has('pythagorean')) return 'pythagorean';
  if (has('surface area') || has('nets')) return 'surface_area';
  if (has('volume')) return 'volume';
  if (has('area')) return 'area';
  if (has('coordinate plane') || has('graphing points') || has('four-quadrant')) return 'coordinate_plane';
  if (has('mean') || has('median') || has('mode') || has('measures of center') || has('measures of variability')) return 'mean_median';
  if (has('dot plot') || has('histogram') || has('box plot') || has('scatter') || has('two-way table')) return 'data_displays';
  if (has('probability')) return 'probability';
  if (has('numerical expression') || has('algebraic expression') || has('evaluate') || has('interpret expression') || has('equivalent expression') || has('write and')) return 'numerical_expressions';
  if (has('multiply multi-digit') || has('multiply multidigit')) return 'multiply_whole';
  if (has('divide with') || has('multi-digit division') || has('long division')) return 'long_division';
  if (has('greatest common factor') || has('least common multiple') || has('gcf') || has('lcm')) return 'gcf_lcm';
  if (has('pattern')) return 'patterns';
  if (has('classify') || has('quadrilateral') || has('two-dimensional figure') || has('polygon') || has('classify two')) return 'classify_shapes';
  if (has('convert') && (has('unit') || has('measurement'))) return 'unit_convert';
  if (has('function')) return 'functions';
  if (has('transformation') || has('congruence') || has('similarity') || has('dilation') || has('rigid transformation')) return 'transformations';
  if (has('trigonometry') || has('sine') || has('cosine') || has('tangent') || has('right-triangle')) return 'trig';
  if (has('circle') || has('inscribed') || has('central angle') || has('arc length')) return 'circle_geo';

  // science
  if (has("newton's law") || has('newtons law') || has('newton')) return 'newtons_laws';
  if (has('balanced and unbalanced') || (has('force') && !has('reinforce'))) return 'forces';
  if (has('kinetic') || has('potential energy') || has('conservation of energy') || has('work, energy')) return 'energy';
  if (has('density')) return 'density';
  if (has('photosynthesis') || has('cellular respiration')) return 'photosynthesis';
  if (has('cell')) return 'cell';
  if (has('atom') || has('molecule') || has('atomic structure') || has('electron') || has('periodic table')) return 'atoms';
  if (has('chemical reaction') || has('balancing chemical') || has('conservation of mass') || has('conservation of matter')) return 'chemical_reactions';
  if (has('reflection') || has('refraction')) return 'reflection';
  if (has('wave')) return 'waves';
  if (has('natural selection') || has('evidence for evolution') || has('adaptation') || has('common ancestry') || has('speciation')) return 'natural_selection';
  if (has('inheritance') || has('genes') || has('genetic') || has('dna') || has('mutation') || has('mendelian') || has('trait') || has('reproduction')) return 'genetics';
  if (has('ecosystem') || has('food web') || has('trophic') || has('energy flow') || has('cycling of matter') || has('matter and energy in ecosystem') || has('population')) return 'ecosystems';
  if (has('states of matter') || has('phase change') || has('particle motion')) return 'states_matter';
  if (has('bonding') || has('ionic') || has('covalent')) return 'bonding';
  if (has('plate tectonics') || has('rock cycle') || has("earth's structure") || has('rock layers') || has('geologic')) return 'plate_tectonics';
  if (has('weather') || has('climate') || has('water cycle') || has('atmospher') || has('ocean current')) return 'weather';
  return null;
}

// ---- assemble slide-ready markdown ------------------------------------------
function assemble(title, head, e) {
  const lines = [`# ${title}`, `**${head}**`, '',
    '> Ready-made starting point — edit anything. Each **Slide** below is one slide; the Teacher notes feed the quiz & flashcards.', ''];
  let n = 1;
  lines.push(`## Slide ${n++} · What it means`, e.def, '');
  lines.push(`## Slide ${n++} · How it works`, e.idea, '');
  (e.examples || []).forEach((ex) => {
    lines.push(`## Slide ${n++} · Worked example — ${ex.title}`, ex.body, '');
  });
  if (e.trap) {
    lines.push(`## Slide ${n++} · Watch out (common mistake)`, e.trap.setup, '', `**Fix:** ${e.trap.fix}`, '');
  }
  if (e.practice && e.practice.length) {
    lines.push(`## Slide ${n++} · Your turn`);
    e.practice.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    lines.push('');
  }
  lines.push('---', '### Teacher notes');
  if (e.vocab && e.vocab.length) lines.push('**Vocabulary:** ' + e.vocab.join('; '));
  if (e.checks && e.checks.length) {
    lines.push('**Quick checks (quiz / flashcards):**');
    e.checks.forEach((c) => lines.push(`- Q: ${c.q} — A: ${c.a}`));
  }
  return lines.join('\n');
}

// ---- generic fallback (still slide-structured, frames a concrete example) ---
function genericSlides(title, head, subject) {
  const lower = String(title || 'this topic').replace(/\.$/, '');
  const sci = String(subject || '').toLowerCase() === 'science';
  return `# ${title}
**${head}**

> Ready-made starting point — edit anything. Each **Slide** below is one slide.

## Slide 1 · What it means
Define **${lower}** in one clear sentence a student would understand, then restate it precisely.

## Slide 2 · How it works
Explain the main idea or steps behind ${lower}${sci ? ', with a labeled diagram or model' : ', showing the method clearly'}. Connect it to what students already know.

## Slide 3 · Worked example
Walk through one real example of ${lower} step by step${sci ? ' (use real quantities/observations)' : ' (use real numbers and show each step)'}, ending with the answer.

## Slide 4 · Another example / common mistake
Show a second example, or the most common mistake students make with ${lower} and how to correct it.

## Slide 5 · Your turn
List 3–4 practice problems on ${lower}, easy → challenge (include answers in your notes).

---
### Teacher notes
**Vocabulary:** key terms for ${lower} (define each with a quick example).
**Quick checks (quiz / flashcards):**
- Q: Explain ${lower} in your own words. — A: (student definition)
- Q: Give an example of ${lower}. — A: (student example)`;
}

// Public: build the paste-content for a topic.
function buildContent({ grade, subject, title, strand, standard }) {
  const head = [gradeText(grade), cap(String(subject || '').toLowerCase()), strand].filter(Boolean).join(' · ')
    + (standard ? ` · ${standard}` : '');
  const key = detectKey(title);
  if (key && LIB[key]) return assemble(title, head, LIB[key]);
  return genericSlides(title, head, subject);
}

module.exports = { buildContent, detectKey };
