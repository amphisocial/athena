/*
 * curriculum-data.js — the Massachusetts curriculum topic catalog.
 *
 * Single source of truth for the public "Learning" page. Topics are organized
 * by Grade (5–10) × Subject (math | science) × Strand, mirroring the structure
 * of the Massachusetts Curriculum Frameworks:
 *   - Mathematics (2017 framework): grades 5–8 are organized by *domain*
 *     (e.g. Number & Operations—Fractions); high school (grades 9–10 here,
 *     Algebra I & Geometry) by *conceptual category*.
 *   - Science & Technology/Engineering (2016/2020 STE framework): grades 5–8
 *     integrate the four disciplines (Earth & Space, Life, Physical,
 *     Technology/Engineering) at each grade; high school is by discipline
 *     (Biology, Earth & Space Science in gr.9; Chemistry, Physics,
 *     Technology/Engineering in gr.10, per common MA course sequences).
 *
 * Topic titles are written here in our own words as student-facing concept
 * names; they are NOT copied from any commercial skill list. `standard` carries
 * a representative framework domain/DCI code for provenance. `template` links a
 * topic to an existing Boardsy board template (see public/board-templates.js)
 * so a topic can open straight onto a live, pre-seeded whiteboard.
 *
 * This file is data only. server/curriculum.js flattens it into rows, seeds
 * Postgres (curriculum_topics), and serves it to the Learning page.
 */

// Each entry: one strand within a grade+subject, with an ordered topic list.
const CURRICULUM = [
  // ======================================================================
  // MATH — GRADE 5  (domains: OA, NBT, NF, MD, G)
  // ======================================================================
  { grade: 5, subject: 'math', strand: 'Operations & Algebraic Thinking', topics: [
    { title: 'Order of operations with grouping symbols', standard: '5.OA.A' },
    { title: 'Write and interpret numerical expressions', standard: '5.OA.A' },
    { title: 'Generate and analyze number patterns', standard: '5.OA.B' }
  ] },
  { grade: 5, subject: 'math', strand: 'Number & Operations in Base Ten', topics: [
    { title: 'Place value through millions and decimals', standard: '5.NBT.A' },
    { title: 'Powers of 10 and exponents', standard: '5.NBT.A' },
    { title: 'Read, write, and compare decimals', standard: '5.NBT.A' },
    { title: 'Round decimals to any place', standard: '5.NBT.A' },
    { title: 'Multiply multi-digit whole numbers', standard: '5.NBT.B' },
    { title: 'Divide with two-digit divisors', standard: '5.NBT.B' },
    { title: 'Add and subtract decimals', standard: '5.NBT.B' },
    { title: 'Multiply and divide decimals', standard: '5.NBT.B' }
  ] },
  { grade: 5, subject: 'math', strand: 'Number & Operations — Fractions', topics: [
    { title: 'Add and subtract fractions with unlike denominators', standard: '5.NF.A' },
    { title: 'Add and subtract mixed numbers', standard: '5.NF.A' },
    { title: 'Fractions as division', standard: '5.NF.B' },
    { title: 'Multiply fractions and mixed numbers', standard: '5.NF.B' },
    { title: 'Area with fractional side lengths', standard: '5.NF.B' },
    { title: 'Divide unit fractions and whole numbers', standard: '5.NF.B' }
  ] },
  { grade: 5, subject: 'math', strand: 'Measurement & Data', topics: [
    { title: 'Convert measurement units', standard: '5.MD.A' },
    { title: 'Line plots with fractional measurements', standard: '5.MD.B' },
    { title: 'Understand volume', standard: '5.MD.C' },
    { title: 'Volume of rectangular prisms', standard: '5.MD.C', template: 'solid' }
  ] },
  { grade: 5, subject: 'math', strand: 'Geometry', topics: [
    { title: 'The coordinate plane and graphing points', standard: '5.G.A', template: 'linear' },
    { title: 'Classify two-dimensional figures', standard: '5.G.B' },
    { title: 'Hierarchy of quadrilaterals', standard: '5.G.B' }
  ] },

  // ======================================================================
  // MATH — GRADE 6  (RP, NS, EE, G, SP)
  // ======================================================================
  { grade: 6, subject: 'math', strand: 'Ratios & Proportional Relationships', topics: [
    { title: 'Understand ratios', standard: '6.RP.A' },
    { title: 'Unit rates', standard: '6.RP.A' },
    { title: 'Equivalent ratios and ratio tables', standard: '6.RP.A' },
    { title: 'Percent of a quantity', standard: '6.RP.A' },
    { title: 'Convert units using ratio reasoning', standard: '6.RP.A' }
  ] },
  { grade: 6, subject: 'math', strand: 'The Number System', topics: [
    { title: 'Divide fractions by fractions', standard: '6.NS.A' },
    { title: 'Greatest common factor and least common multiple', standard: '6.NS.B' },
    { title: 'Understand negative numbers', standard: '6.NS.C' },
    { title: 'Rational numbers on a number line', standard: '6.NS.C' },
    { title: 'Absolute value', standard: '6.NS.C' },
    { title: 'The four-quadrant coordinate plane', standard: '6.NS.C', template: 'linear' }
  ] },
  { grade: 6, subject: 'math', strand: 'Expressions & Equations', topics: [
    { title: 'Exponents and whole-number powers', standard: '6.EE.A' },
    { title: 'Write and evaluate algebraic expressions', standard: '6.EE.A' },
    { title: 'Identify equivalent expressions', standard: '6.EE.A' },
    { title: 'Solve one-variable equations', standard: '6.EE.B' },
    { title: 'Write and graph inequalities', standard: '6.EE.B' },
    { title: 'Dependent and independent variables', standard: '6.EE.C', template: 'linear' }
  ] },
  { grade: 6, subject: 'math', strand: 'Geometry', topics: [
    { title: 'Area of triangles and quadrilaterals', standard: '6.G.A' },
    { title: 'Volume with fractional edge lengths', standard: '6.G.A', template: 'solid' },
    { title: 'Polygons on the coordinate plane', standard: '6.G.A' },
    { title: 'Surface area using nets', standard: '6.G.A', template: 'solid' }
  ] },
  { grade: 6, subject: 'math', strand: 'Statistics & Probability', topics: [
    { title: 'Recognize statistical questions', standard: '6.SP.A' },
    { title: 'Measures of center: mean, median, mode', standard: '6.SP.B' },
    { title: 'Measures of variability', standard: '6.SP.B' },
    { title: 'Dot plots, histograms, and box plots', standard: '6.SP.B' }
  ] },

  // ======================================================================
  // MATH — GRADE 7  (RP, NS, EE, G, SP)
  // ======================================================================
  { grade: 7, subject: 'math', strand: 'Ratios & Proportional Relationships', topics: [
    { title: 'Unit rates with fractions', standard: '7.RP.A' },
    { title: 'Recognize proportional relationships', standard: '7.RP.A' },
    { title: 'Constant of proportionality', standard: '7.RP.A', template: 'linear' },
    { title: 'Solve proportion problems', standard: '7.RP.A' },
    { title: 'Percent change, tax, tip, and interest', standard: '7.RP.A' }
  ] },
  { grade: 7, subject: 'math', strand: 'The Number System', topics: [
    { title: 'Add and subtract integers', standard: '7.NS.A' },
    { title: 'Multiply and divide integers', standard: '7.NS.A' },
    { title: 'Operations with rational numbers', standard: '7.NS.A' },
    { title: 'Convert fractions to decimals', standard: '7.NS.A' }
  ] },
  { grade: 7, subject: 'math', strand: 'Expressions & Equations', topics: [
    { title: 'Add, subtract, factor, and expand linear expressions', standard: '7.EE.A' },
    { title: 'Solve two-step equations', standard: '7.EE.B' },
    { title: 'Solve two-step inequalities', standard: '7.EE.B' },
    { title: 'Model real-world problems with equations', standard: '7.EE.B' }
  ] },
  { grade: 7, subject: 'math', strand: 'Geometry', topics: [
    { title: 'Scale drawings', standard: '7.G.A' },
    { title: 'Construct triangles from conditions', standard: '7.G.A' },
    { title: 'Cross-sections of three-dimensional figures', standard: '7.G.A', template: 'solid' },
    { title: 'Circumference and area of circles', standard: '7.G.B' },
    { title: 'Angle relationships', standard: '7.G.B' },
    { title: 'Area, volume, and surface area problems', standard: '7.G.B', template: 'solid' }
  ] },
  { grade: 7, subject: 'math', strand: 'Statistics & Probability', topics: [
    { title: 'Sampling and making inferences', standard: '7.SP.A' },
    { title: 'Compare two populations', standard: '7.SP.B' },
    { title: 'Probability models', standard: '7.SP.C' },
    { title: 'Simple and compound probability', standard: '7.SP.C' },
    { title: 'Run probability simulations', standard: '7.SP.C' }
  ] },

  // ======================================================================
  // MATH — GRADE 8  (NS, EE, F, G, SP)
  // ======================================================================
  { grade: 8, subject: 'math', strand: 'The Number System', topics: [
    { title: 'Rational and irrational numbers', standard: '8.NS.A' },
    { title: 'Approximate irrational numbers', standard: '8.NS.A' },
    { title: 'Square roots and cube roots', standard: '8.EE.A' }
  ] },
  { grade: 8, subject: 'math', strand: 'Expressions & Equations', topics: [
    { title: 'Integer exponents and properties', standard: '8.EE.A' },
    { title: 'Scientific notation', standard: '8.EE.A' },
    { title: 'Operations in scientific notation', standard: '8.EE.A' },
    { title: 'Graph proportional relationships and slope', standard: '8.EE.B', template: 'linear' },
    { title: 'Solve linear equations in one variable', standard: '8.EE.C' },
    { title: 'Systems of linear equations', standard: '8.EE.C', template: 'linear' }
  ] },
  { grade: 8, subject: 'math', strand: 'Functions', topics: [
    { title: 'Understand functions', standard: '8.F.A' },
    { title: 'Compare functions', standard: '8.F.A' },
    { title: 'Linear versus nonlinear functions', standard: '8.F.A', template: 'linear' },
    { title: 'Construct and interpret linear models', standard: '8.F.B', template: 'linear' },
    { title: 'Describe graphs qualitatively', standard: '8.F.B' }
  ] },
  { grade: 8, subject: 'math', strand: 'Geometry', topics: [
    { title: 'Transformations and congruence', standard: '8.G.A' },
    { title: 'Transformations and similarity', standard: '8.G.A' },
    { title: 'Angles, parallel lines, and transversals', standard: '8.G.A' },
    { title: 'The Pythagorean theorem', standard: '8.G.B' },
    { title: 'Distance on the coordinate plane', standard: '8.G.B' },
    { title: 'Volume of cylinders, cones, and spheres', standard: '8.G.C', template: 'solid' }
  ] },
  { grade: 8, subject: 'math', strand: 'Statistics & Probability', topics: [
    { title: 'Scatter plots and association', standard: '8.SP.A' },
    { title: 'Line of best fit', standard: '8.SP.A', template: 'linear' },
    { title: 'Two-way tables', standard: '8.SP.A' }
  ] },

  // ======================================================================
  // MATH — GRADE 9  (Algebra I: Number & Quantity, Algebra, Functions, S&P)
  // ======================================================================
  { grade: 9, subject: 'math', strand: 'Number & Quantity', topics: [
    { title: 'Properties of rational and irrational numbers', standard: 'HS.N-RN' },
    { title: 'Units, quantities, and precision in modeling', standard: 'HS.N-Q' }
  ] },
  { grade: 9, subject: 'math', strand: 'Algebra — Expressions & Polynomials', topics: [
    { title: 'Interpret the structure of expressions', standard: 'HS.A-SSE' },
    { title: 'Add, subtract, and multiply polynomials', standard: 'HS.A-APR' },
    { title: 'Factor quadratic expressions', standard: 'HS.A-SSE', template: 'quadratic' },
    { title: 'Rewrite expressions and complete the square', standard: 'HS.A-SSE', template: 'quadratic' }
  ] },
  { grade: 9, subject: 'math', strand: 'Algebra — Equations & Inequalities', topics: [
    { title: 'Create equations and inequalities', standard: 'HS.A-CED' },
    { title: 'Solve linear equations and inequalities', standard: 'HS.A-REI', template: 'linear' },
    { title: 'Solve systems of equations', standard: 'HS.A-REI', template: 'linear' },
    { title: 'Solve quadratic equations', standard: 'HS.A-REI', template: 'quadratic' },
    { title: 'Rearrange formulas', standard: 'HS.A-CED' }
  ] },
  { grade: 9, subject: 'math', strand: 'Functions', topics: [
    { title: 'Function notation and domain', standard: 'HS.F-IF' },
    { title: 'Linear and exponential functions', standard: 'HS.F-LE', template: 'linear' },
    { title: 'Interpret key features of graphs', standard: 'HS.F-IF', template: 'quadratic' },
    { title: 'Arithmetic and geometric sequences', standard: 'HS.F-BF' },
    { title: 'Build and transform functions', standard: 'HS.F-BF', template: 'quadratic' },
    { title: 'Compare families of functions', standard: 'HS.F-IF' }
  ] },
  { grade: 9, subject: 'math', strand: 'Statistics & Probability', topics: [
    { title: 'Analyze single-variable data', standard: 'HS.S-ID' },
    { title: 'Two-variable data and regression', standard: 'HS.S-ID', template: 'linear' },
    { title: 'Correlation versus causation', standard: 'HS.S-ID' }
  ] },

  // ======================================================================
  // MATH — GRADE 10  (Geometry)
  // ======================================================================
  { grade: 10, subject: 'math', strand: 'Congruence', topics: [
    { title: 'Rigid transformations', standard: 'HS.G-CO' },
    { title: 'Triangle congruence criteria', standard: 'HS.G-CO' },
    { title: 'Prove geometric theorems', standard: 'HS.G-CO' },
    { title: 'Geometric constructions', standard: 'HS.G-CO' }
  ] },
  { grade: 10, subject: 'math', strand: 'Similarity, Right Triangles & Trigonometry', topics: [
    { title: 'Dilations and similarity', standard: 'HS.G-SRT' },
    { title: 'Similarity criteria for triangles', standard: 'HS.G-SRT' },
    { title: 'Right-triangle trigonometry', standard: 'HS.G-SRT' },
    { title: 'Sine, cosine, and tangent ratios', standard: 'HS.G-SRT' },
    { title: 'Laws of Sines and Cosines', standard: 'HS.G-SRT' }
  ] },
  { grade: 10, subject: 'math', strand: 'Circles', topics: [
    { title: 'Central and inscribed angles', standard: 'HS.G-C' },
    { title: 'Arc length and sector area', standard: 'HS.G-C' },
    { title: 'Equation of a circle', standard: 'HS.G-GPE' },
    { title: 'Tangents and chords', standard: 'HS.G-C' }
  ] },
  { grade: 10, subject: 'math', strand: 'Geometry with Coordinates', topics: [
    { title: 'Coordinate proofs', standard: 'HS.G-GPE' },
    { title: 'Parallel and perpendicular lines', standard: 'HS.G-GPE', template: 'linear' },
    { title: 'Partition a segment in a ratio', standard: 'HS.G-GPE' }
  ] },
  { grade: 10, subject: 'math', strand: 'Geometric Measurement & Dimension', topics: [
    { title: 'Volume formulas for solids', standard: 'HS.G-GMD', template: 'solid' },
    { title: 'Cross-sections and rotations of shapes', standard: 'HS.G-GMD', template: 'solid' },
    { title: 'Model with surface area and volume', standard: 'HS.G-MG', template: 'solid' }
  ] },
  { grade: 10, subject: 'math', strand: 'Statistics & Probability', topics: [
    { title: 'Conditional probability', standard: 'HS.S-CP' },
    { title: 'Independence of events', standard: 'HS.S-CP' },
    { title: 'Rules of probability', standard: 'HS.S-CP' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 5  (STE: ESS, LS, PS, TE — elementary)
  // ======================================================================
  { grade: 5, subject: 'science', strand: 'Earth & Space Science', topics: [
    { title: 'The Sun, stars, and apparent brightness', standard: '5-ESS1', template: 'globe' },
    { title: 'Patterns in the day and night sky', standard: '5-ESS1', template: 'globe' },
    { title: 'Gravity pulls objects toward Earth', standard: '5-PS2', template: 'newton' },
    { title: "Water on Earth and where it is found", standard: '5-ESS2', template: 'globe' },
    { title: "Human impact on Earth's systems", standard: '5-ESS3' }
  ] },
  { grade: 5, subject: 'science', strand: 'Life Science', topics: [
    { title: 'Matter and energy in ecosystems', standard: '5-LS2' },
    { title: 'Food webs and energy flow', standard: '5-LS2' },
    { title: 'Plants get materials from air and water', standard: '5-LS1' },
    { title: 'Decomposers and the cycling of matter', standard: '5-LS2' }
  ] },
  { grade: 5, subject: 'science', strand: 'Physical Science', topics: [
    { title: 'Matter is made of tiny particles', standard: '5-PS1', template: 'molecule' },
    { title: 'Conservation of matter', standard: '5-PS1' },
    { title: 'Properties of materials', standard: '5-PS1' },
    { title: 'Mixing substances to form new substances', standard: '5-PS1', template: 'molecule' }
  ] },
  { grade: 5, subject: 'science', strand: 'Technology/Engineering', topics: [
    { title: 'Define and solve a design problem', standard: '3-5-ETS1' },
    { title: 'Test and improve a prototype', standard: '3-5-ETS1' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 6  (STE: structure & function, Earth–Sun–Moon)
  // ======================================================================
  { grade: 6, subject: 'science', strand: 'Earth & Space Science', topics: [
    { title: 'Earth–Sun–Moon system and moon phases', standard: '6.MS-ESS1', template: 'globe' },
    { title: "Seasons and Earth's tilt", standard: '6.MS-ESS1', template: 'globe' },
    { title: 'The solar system and gravity', standard: '6.MS-ESS1', template: 'newton' },
    { title: 'The rock cycle and Earth materials', standard: '6.MS-ESS2' },
    { title: "Plate tectonics and Earth's structure", standard: '6.MS-ESS2', template: 'globe' }
  ] },
  { grade: 6, subject: 'science', strand: 'Life Science', topics: [
    { title: 'Cells as the basic unit of life', standard: '6.MS-LS1' },
    { title: 'Structure and function of body systems', standard: '6.MS-LS1' },
    { title: 'Sensory receptors and the brain', standard: '6.MS-LS1' },
    { title: 'Photosynthesis', standard: '6.MS-LS1' }
  ] },
  { grade: 6, subject: 'science', strand: 'Physical Science', topics: [
    { title: 'Forms of energy', standard: '6.MS-PS3' },
    { title: 'Thermal energy and heat transfer', standard: '6.MS-PS3' },
    { title: 'Waves and their properties', standard: '6.MS-PS4', template: 'pendulum' }
  ] },
  { grade: 6, subject: 'science', strand: 'Technology/Engineering', topics: [
    { title: 'Design solutions to problems', standard: '6.MS-ETS1' },
    { title: 'Criteria, constraints, and trade-offs', standard: '6.MS-ETS1' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 7  (STE: matter & energy in ecosystems, Earth processes)
  // ======================================================================
  { grade: 7, subject: 'science', strand: 'Earth & Space Science', topics: [
    { title: 'Weather and atmospheric circulation', standard: '7.MS-ESS2', template: 'globe' },
    { title: 'Climate and ocean currents', standard: '7.MS-ESS2', template: 'globe' },
    { title: 'Geologic time and rock layers', standard: '7.MS-ESS1' },
    { title: 'The water cycle', standard: '7.MS-ESS2' },
    { title: 'Natural resources and Earth processes', standard: '7.MS-ESS3' }
  ] },
  { grade: 7, subject: 'science', strand: 'Life Science', topics: [
    { title: 'Matter and energy flow in ecosystems', standard: '7.MS-LS2' },
    { title: 'Cycling of matter in ecosystems', standard: '7.MS-LS2' },
    { title: 'Ecosystem interactions and populations', standard: '7.MS-LS2' },
    { title: 'Human impacts and biodiversity', standard: '7.MS-LS2' },
    { title: 'Photosynthesis and cellular respiration', standard: '7.MS-LS1', template: 'molecule' }
  ] },
  { grade: 7, subject: 'science', strand: 'Physical Science', topics: [
    { title: 'Chemical reactions', standard: '7.MS-PS1', template: 'molecule' },
    { title: 'Conservation of mass', standard: '7.MS-PS1' },
    { title: 'Kinetic and potential energy', standard: '7.MS-PS3', template: 'pendulum' },
    { title: 'Energy transfer', standard: '7.MS-PS3' }
  ] },
  { grade: 7, subject: 'science', strand: 'Technology/Engineering', topics: [
    { title: 'The engineering design process', standard: '7.MS-ETS1' },
    { title: 'Optimize a design solution', standard: '7.MS-ETS2' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 8  (STE: atoms/molecules, forces & motion, waves, evolution)
  // ======================================================================
  { grade: 8, subject: 'science', strand: 'Physical Science — Matter', topics: [
    { title: 'Atoms and molecules', standard: '8.MS-PS1', template: 'molecule' },
    { title: 'States of matter and particle motion', standard: '8.MS-PS1', template: 'molecule' },
    { title: 'Chemical reactions and new substances', standard: '8.MS-PS1', template: 'molecule' },
    { title: 'Density', standard: '8.MS-PS1' }
  ] },
  { grade: 8, subject: 'science', strand: 'Physical Science — Forces & Motion', topics: [
    { title: "Newton's laws of motion", standard: '8.MS-PS2', template: 'newton' },
    { title: 'Balanced and unbalanced forces', standard: '8.MS-PS2', template: 'incline' },
    { title: 'Gravitational and electromagnetic forces', standard: '8.MS-PS2', template: 'newton' },
    { title: 'Potential energy in fields', standard: '8.MS-PS3', template: 'pendulum' }
  ] },
  { grade: 8, subject: 'science', strand: 'Physical Science — Waves', topics: [
    { title: 'Wave properties and energy', standard: '8.MS-PS4', template: 'pendulum' },
    { title: 'Light and reflection', standard: '8.MS-PS4', template: 'reflection' },
    { title: 'Analog and digital signals', standard: '8.MS-PS4' }
  ] },
  { grade: 8, subject: 'science', strand: 'Life Science', topics: [
    { title: 'Reproduction and inheritance', standard: '8.MS-LS3' },
    { title: 'Genes, traits, and mutations', standard: '8.MS-LS3' },
    { title: 'Natural selection and adaptation', standard: '8.MS-LS4' },
    { title: 'Evidence for evolution', standard: '8.MS-LS4' },
    { title: 'Selective breeding', standard: '8.MS-LS4' }
  ] },
  { grade: 8, subject: 'science', strand: 'Earth & Space Science', topics: [
    { title: 'Gravity and the solar system', standard: '8.MS-ESS1', template: 'newton' },
    { title: 'Scale of the universe', standard: '8.MS-ESS1', template: 'globe' },
    { title: "Earth's history in the rock record", standard: '8.MS-ESS1' }
  ] },
  { grade: 8, subject: 'science', strand: 'Technology/Engineering', topics: [
    { title: 'Devices that transfer energy', standard: '8.MS-ETS2' },
    { title: 'Systems and subsystems', standard: '8.MS-ETS3' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 9  (High school: Biology + Earth & Space Science)
  // ======================================================================
  { grade: 9, subject: 'science', strand: 'Biology — Cellular Biology', topics: [
    { title: 'Cell structure and organelles', standard: 'HS-LS1' },
    { title: 'The cell membrane and transport', standard: 'HS-LS1' },
    { title: 'Enzymes and biochemistry', standard: 'HS-LS1', template: 'molecule' },
    { title: 'Photosynthesis and cellular respiration', standard: 'HS-LS1', template: 'molecule' },
    { title: 'Cell division and the cell cycle', standard: 'HS-LS1' }
  ] },
  { grade: 9, subject: 'science', strand: 'Biology — Genetics', topics: [
    { title: 'DNA structure and replication', standard: 'HS-LS3', template: 'molecule' },
    { title: 'Protein synthesis', standard: 'HS-LS1' },
    { title: 'Mendelian inheritance', standard: 'HS-LS3' },
    { title: 'Mutations and genetic variation', standard: 'HS-LS3' },
    { title: 'Biotechnology', standard: 'HS-LS1' }
  ] },
  { grade: 9, subject: 'science', strand: 'Biology — Evolution & Biodiversity', topics: [
    { title: 'Natural selection', standard: 'HS-LS4' },
    { title: 'Evidence for evolution', standard: 'HS-LS4' },
    { title: 'Common ancestry and phylogeny', standard: 'HS-LS4' },
    { title: 'Speciation', standard: 'HS-LS4' }
  ] },
  { grade: 9, subject: 'science', strand: 'Biology — Ecology', topics: [
    { title: 'Energy flow and trophic levels', standard: 'HS-LS2' },
    { title: 'Cycling of matter', standard: 'HS-LS2' },
    { title: 'Population and community dynamics', standard: 'HS-LS2' },
    { title: 'Ecosystem stability and human impact', standard: 'HS-LS2' }
  ] },
  { grade: 9, subject: 'science', strand: 'Biology — Anatomy & Physiology', topics: [
    { title: 'Body systems and homeostasis', standard: 'HS-LS1' },
    { title: 'Feedback mechanisms', standard: 'HS-LS1' }
  ] },
  { grade: 9, subject: 'science', strand: "Earth & Space — Earth's Place in the Universe", topics: [
    { title: 'The Big Bang and stellar evolution', standard: 'HS-ESS1', template: 'globe' },
    { title: 'Formation of the solar system', standard: 'HS-ESS1', template: 'newton' },
    { title: 'Earth–Sun–Moon motions', standard: 'HS-ESS1', template: 'globe' }
  ] },
  { grade: 9, subject: 'science', strand: "Earth & Space — Earth's Systems", topics: [
    { title: 'Plate tectonics', standard: 'HS-ESS2', template: 'globe' },
    { title: 'The rock cycle and minerals', standard: 'HS-ESS2' },
    { title: "Earth's water and atmosphere", standard: 'HS-ESS2', template: 'globe' },
    { title: 'Weather and climate systems', standard: 'HS-ESS2' }
  ] },
  { grade: 9, subject: 'science', strand: 'Earth & Space — Human Sustainability', topics: [
    { title: 'Natural resources and energy', standard: 'HS-ESS3' },
    { title: 'Climate change and human activity', standard: 'HS-ESS3' },
    { title: 'Natural hazards', standard: 'HS-ESS3' }
  ] },

  // ======================================================================
  // SCIENCE — GRADE 10  (High school: Chemistry, Physics, Tech/Engineering)
  // ======================================================================
  { grade: 10, subject: 'science', strand: 'Chemistry — Atomic Structure', topics: [
    { title: 'Atomic models and subatomic particles', standard: 'HS-PS1', template: 'molecule' },
    { title: 'Electron configuration', standard: 'HS-PS1', template: 'molecule' },
    { title: 'The periodic table and trends', standard: 'HS-PS1' },
    { title: 'Isotopes and atomic mass', standard: 'HS-PS1' }
  ] },
  { grade: 10, subject: 'science', strand: 'Chemistry — Bonding & Reactions', topics: [
    { title: 'Ionic and covalent bonding', standard: 'HS-PS1', template: 'molecule' },
    { title: 'Chemical formulas and naming', standard: 'HS-PS1', template: 'molecule' },
    { title: 'Balancing chemical equations', standard: 'HS-PS1' },
    { title: 'Types of chemical reactions', standard: 'HS-PS1' },
    { title: 'Stoichiometry and the mole', standard: 'HS-PS1' }
  ] },
  { grade: 10, subject: 'science', strand: 'Chemistry — Matter & Energy', topics: [
    { title: 'Gas laws', standard: 'HS-PS1' },
    { title: 'Phase changes', standard: 'HS-PS1' },
    { title: 'Solutions and concentration', standard: 'HS-PS1' },
    { title: 'Acids and bases', standard: 'HS-PS1' },
    { title: 'Endothermic and exothermic reactions', standard: 'HS-PS3' }
  ] },
  { grade: 10, subject: 'science', strand: 'Physics — Motion & Forces', topics: [
    { title: 'Kinematics and motion graphs', standard: 'HS-PS2', template: 'newton' },
    { title: "Newton's laws of motion", standard: 'HS-PS2', template: 'newton' },
    { title: 'Forces on inclines and friction', standard: 'HS-PS2', template: 'incline' },
    { title: 'Projectile motion', standard: 'HS-PS2', template: 'newton' },
    { title: 'Momentum and collisions', standard: 'HS-PS2' }
  ] },
  { grade: 10, subject: 'science', strand: 'Physics — Energy', topics: [
    { title: 'Work, energy, and power', standard: 'HS-PS3' },
    { title: 'Conservation of energy', standard: 'HS-PS3', template: 'pendulum' },
    { title: 'Simple machines', standard: 'HS-PS3', template: 'incline' },
    { title: 'Pendulums and periodic motion', standard: 'HS-PS3', template: 'pendulum' }
  ] },
  { grade: 10, subject: 'science', strand: 'Physics — Waves & Electromagnetism', topics: [
    { title: 'Wave properties', standard: 'HS-PS4', template: 'pendulum' },
    { title: 'Sound and light', standard: 'HS-PS4', template: 'reflection' },
    { title: 'Reflection and refraction', standard: 'HS-PS4', template: 'reflection' },
    { title: 'Electric circuits', standard: 'HS-PS3' },
    { title: 'Electromagnetism', standard: 'HS-PS2' }
  ] },
  { grade: 10, subject: 'science', strand: 'Technology/Engineering', topics: [
    { title: 'Define and scope design problems', standard: 'HS-ETS1' },
    { title: 'Model and prototype solutions', standard: 'HS-ETS2' },
    { title: 'Optimize with trade-offs', standard: 'HS-ETS1' },
    { title: 'Material properties and selection', standard: 'HS-ETS3' },
    { title: 'Mechanical, fluid, and electrical systems', standard: 'HS-ETS3' }
  ] }
];

module.exports = { CURRICULUM };
