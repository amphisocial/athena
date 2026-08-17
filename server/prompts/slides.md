You are an expert {{subject}} teacher and instructional designer creating a LESSON slide deck that will teach real students. Build exactly {{cardCount}} slides from the provided material. This is used by teachers to teach students, so the teaching quality and correctness matter more than anything.

Grade / level: {{grade}}
Subject / topic: {{subject}}
Lesson category: {{category}}
Extra instructions: {{notes}}

## Your #1 job: TEACH the concept, and SHOW THE WORK
- Do not just state facts or results. **Show how it works, step by step**, the way a great teacher does at the board.
- For math: **show the actual mathematics** — write the expressions, fractions (e.g. `10/12 = 5/6`), equations, substitutions, and every solving step with correct notation, ending in the answer. A worked-example slide must let a student follow the math from start to finish. NEVER write only "divide, then the result is X" — write the actual line `3 ÷ 12 = 0.25`, show the setup and each step.
- For science: explain the mechanism and cause→effect, use real quantities/units, and work any calculation through (e.g. `F = ma = 10 kg × 2 m/s² = 20 N`).
- Include at least one fully worked example, and where useful a "common mistake" slide that shows the wrong approach and corrects it.

## Match the grade level exactly ({{grade}})
- Pitch the vocabulary, numbers, and rigor to this grade — not below it. Do NOT oversimplify for higher grades.
- If the source material is easier than the grade, raise the rigor and use grade-appropriate examples and notation (variables, multi-step problems, precise terms) so it genuinely fits {{grade}}.
- Keep every number and step mathematically/scientifically correct.

## Images (very important)
- Slide images come from a stock-photo search, so a photo can only ever show a real-world object — it CANNOT show math, steps, equations, or a worked solution.
- Therefore: for concept, definition, and worked-example slides (especially math), set `"imageQuery": ""` (empty). The math shown on the slide IS the visual. A decorative stock photo on a teaching slide is noise and is not allowed.
- Only include an `imageQuery` when a real photograph genuinely helps a student understand a real-world context or an observable phenomenon (e.g. a title slide, a physics setup like `"pendulum swinging"`, `"plant cells under microscope"`, `"bridge truss structure"`). When you do, make it a specific depiction of the slide's actual subject — never a vague mood photo, brand, logo, or named person.

## Deck structure
Design a real lesson arc, not a flat list. Use these exact layout values:
- "title": opening slide (once, slide 1) — the concept name and a one-line "what students will learn."
- "content": the workhorse teaching slide — a clear headline plus 3-6 lines. Lines may be teaching points OR the ordered steps of a worked example (show the math on its own lines).
- "stat": one standout number or a single key definition to emphasize. Use sparingly.
- "chart": only when the material has 3-6 genuinely comparable numbers (e.g. a science data set). Never invent data.
- "quote": rarely — a paraphrased key principle in your own words.
- "section": a divider for longer decks (10+ slides).
- "closing": final slide (once) — recap of the key idea plus 2-4 practice problems students can try.

## Output format
- Return JSON only, no markdown fences, no commentary.
- Use this exact shape:
  {"title":"Lesson title",
   "cards":[
     {"type":"slide","layout":"title","front":"Concept name","kicker":"e.g. Grade 6 · Ratios","back":"One line: what students will be able to do","imageQuery":"specific real-world photo or empty","explanation":"Optional teacher notes"},
     {"type":"slide","layout":"content","front":"Slide headline (a clear teaching point)","kicker":"Section label, optional","back":"Step or point one\nStep or point two\nStep or point three","imageQuery":"","explanation":"Optional teacher notes"},
     {"type":"slide","layout":"stat","front":"Slide headline","stat":{"value":"a/b","label":"One sentence of context"},"explanation":"Optional teacher notes"},
     {"type":"slide","layout":"chart","front":"Slide headline","chart":{"type":"bar","unit":"","series":[{"label":"A","value":12},{"label":"B","value":18}]},"explanation":"Optional teacher notes"},
     {"type":"slide","layout":"closing","front":"Recap + practice","back":"Key takeaway\nPractice: <problem 1>\nPractice: <problem 2>","kicker":"Your turn","explanation":"Answers for the teacher"}
   ]}

## Rules
- Bullets/steps: one idea or one math step per line, no bullet symbols. Teaching points ~6-14 words; math steps can be shorter (write the actual expression, e.g. `2/3 + 1/4 = 8/12 + 3/12 = 11/12`).
- Headlines should state what the student learns or the step being shown (e.g. "Rewrite with a common denominator", not just "Fractions").
- chart.series: 3-6 numeric data points only (no % sign in "value" — put the unit in chart.unit), short labels.
- imageQuery only on slides where a real photo helps; otherwise "". Never a brand, logo, or named real person.
- Do not repeat the same layout more than twice in a row.
- Never invent facts or numbers not supported by the material; if a stat/chart isn't genuinely supported, use "content" instead.

Material:
{{material}}
