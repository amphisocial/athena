/*
 * curriculum.js — the Learning catalog (Massachusetts topics) backed by Postgres.
 *
 * The public "Learning" page lets anyone pick a Grade (5–10) and Subject
 * (math | science) and see every Massachusetts topic for that combination,
 * grouped by strand. The catalog itself lives in curriculum-data.js; this
 * module owns the database side:
 *
 *   - ensureAndSeed(db): creates the curriculum_topics table and upserts the
 *     catalog into it. Idempotent — safe to run on every boot. Each topic has a
 *     deterministic id derived from grade/subject/strand/title, so re-seeding
 *     updates existing rows in place and never duplicates. Topics that were
 *     removed from the catalog are pruned.
 *   - getOverview(db): the grade × subject matrix with topic counts, for the
 *     landing selector.
 *   - getTopics(db, grade, subject): strands (ordered) each with their topics
 *     (ordered), for the topic listing.
 *
 * This is a proper typed relational table (not one of the JSON document
 * blobs), consistent with db.js's policy of giving queryable, constrained data
 * its own columns.
 */
const { CURRICULUM } = require('./curriculum-data');

const SUBJECTS = ['math', 'science'];
const MIN_GRADE = 5;
const MAX_GRADE = 10;

const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const gradeText = (g) => (g ? (/^grade/i.test(String(g)) ? String(g) : `Grade ${g}`) : '');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A strong, teacher-ready STARTING POINT for a topic's paste-content, built
// from its metadata. This is deliberately structured the way a teacher would
// lay out a lesson (goal → key ideas → worked examples → misconceptions →
// checks → practice) so it generates good slides/quizzes/flashcards straight
// away, and is fully editable. The AI backfill (see backfillContent) can later
// replace this with researched, topic-specific content stored in the DB — so
// the runtime never has to call AI for a curriculum topic.
function scaffoldContent({ grade, subject, title, strand, standard }) {
  const g = gradeText(grade);
  const subj = cap(String(subject || '').toLowerCase() || 'the subject');
  const head = [g, subj, strand].filter(Boolean).join(' · ') + (standard ? ` · ${standard}` : '');
  const isSci = String(subject || '').toLowerCase() === 'science';
  const lower = String(title || 'this topic').replace(/\.$/, '');

  if (isSci) {
    return `# ${title}
${head}

## Lesson goal
Students can explain ${lower} and use evidence and models to reason about it.

## Anchor the lesson
Open with a phenomenon or question students can observe: "Why/what happens when …?" tied to ${lower}. Let students share what they already think.

## Key ideas to teach
- Define ${lower} in plain language, then in science terms.
- Build or show a model/diagram that makes the idea visible.
- Connect cause and effect: what changes, and what it affects.
- Link to the bigger unit: ${strand || subj}.

## Show these (great for slides)
1. A labeled diagram or model of ${lower}.
2. A worked example or demonstration walked through step by step.
3. A real-world example students recognize.

## Vocabulary
- Key terms for ${lower} (define each with a student-friendly sentence and an example).

## Common misconceptions to address
- A likely wrong idea about ${lower} — and how to correct it with evidence.

## Quick checks (turn into quiz / flashcards)
- What is ${lower}, in your own words?
- Give an example and explain why it fits.
- Predict what happens if one variable changes.

## Practice / apply
- 4–6 questions ranging from recall to applying ${lower} in a new situation.`;
  }

  return `# ${title}
${head}

## Lesson goal
Students can ${lower} and explain their reasoning.

## Why it matters
Connect ${lower} to earlier work in ${strand || subj} and to where it's used next.

## Key ideas to teach
- State the idea in student-friendly language, then formally.
- Show the method/steps with a clearly labeled example.
- Represent it more than one way (words, numbers, a picture or graph).
- Name the connection to prior skills in ${strand || subj}.

## Worked examples (great for slides)
1. A straightforward example with every step shown.
2. A harder example (multi-step, or with a common twist).
3. A word problem applying ${lower}.

## Vocabulary
- Key terms for ${lower} (define each with a quick example).

## Common mistakes to address
- A typical error students make with ${lower} — and how to fix the thinking.

## Quick checks (turn into quiz / flashcards)
- Explain ${lower} in your own words.
- Solve a short example and justify each step.
- Spot-the-error: find the mistake in a worked solution.

## Practice set
- 4–6 problems, easy → challenge, on ${lower}.`;
}

// Flatten the nested catalog into flat topic rows with stable ids and ordering.
// Strand order follows the order strands first appear in the catalog for a
// given grade+subject; topic order follows their order within each strand.
function buildRows() {
  const rows = [];
  const strandOrder = new Map(); // key: grade|subject -> Map(strand -> index)

  for (const group of CURRICULUM) {
    const grade = Number(group.grade);
    const subject = String(group.subject);
    if (!SUBJECTS.includes(subject) || grade < MIN_GRADE || grade > MAX_GRADE) continue;

    const gsKey = `${grade}|${subject}`;
    if (!strandOrder.has(gsKey)) strandOrder.set(gsKey, new Map());
    const orderMap = strandOrder.get(gsKey);
    if (!orderMap.has(group.strand)) orderMap.set(group.strand, orderMap.size);
    const strandIdx = orderMap.get(group.strand);

    (group.topics || []).forEach((t, topicIdx) => {
      const id = `${subject}-g${grade}-${slug(group.strand)}-${slug(t.title)}`;
      rows.push({
        id,
        grade,
        subject,
        strand: group.strand,
        strand_order: strandIdx,
        title: t.title,
        blurb: t.blurb || '',
        standard_code: t.standard || '',
        template_id: t.template || null,
        topic_order: topicIdx
      });
    });
  }
  return rows;
}

async function ensureAndSeed(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS curriculum_topics (
      id            TEXT PRIMARY KEY,
      grade         INTEGER NOT NULL,
      subject       TEXT NOT NULL,
      strand        TEXT NOT NULL,
      strand_order  INTEGER NOT NULL DEFAULT 0,
      title         TEXT NOT NULL,
      blurb         TEXT NOT NULL DEFAULT '',
      standard_code TEXT NOT NULL DEFAULT '',
      template_id   TEXT,
      topic_order   INTEGER NOT NULL DEFAULT 0,
      seed_content  TEXT NOT NULL DEFAULT '',
      content_source TEXT NOT NULL DEFAULT 'none',
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_grade_subject ON curriculum_topics (grade, subject);`);
  // Older deployments won't have the content columns — add them if missing.
  await db.query(`ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS seed_content TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE curriculum_topics ADD COLUMN IF NOT EXISTS content_source TEXT NOT NULL DEFAULT 'none';`);

  const rows = buildRows();
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (const r of rows) {
      ids.push(r.id);
      await client.query(
        `INSERT INTO curriculum_topics
           (id, grade, subject, strand, strand_order, title, blurb, standard_code, template_id, topic_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (id) DO UPDATE SET
           grade = EXCLUDED.grade,
           subject = EXCLUDED.subject,
           strand = EXCLUDED.strand,
           strand_order = EXCLUDED.strand_order,
           title = EXCLUDED.title,
           blurb = EXCLUDED.blurb,
           standard_code = EXCLUDED.standard_code,
           template_id = EXCLUDED.template_id,
           topic_order = EXCLUDED.topic_order,
           updated_at = now()`,
        [r.id, r.grade, r.subject, r.strand, r.strand_order, r.title, r.blurb, r.standard_code, r.template_id, r.topic_order]
      );
    }
    // Prune rows for topics that no longer exist in the catalog.
    if (ids.length) {
      await client.query(`DELETE FROM curriculum_topics WHERE NOT (id = ANY($1::text[]))`, [ids]);
    }
    // Give every topic a strong starting-point content scaffold if it has none
    // yet. Never overwrites AI-backfilled content (content_source='ai').
    const need = await client.query(
      `SELECT id, grade, subject, strand, title, standard_code
         FROM curriculum_topics
        WHERE content_source = 'none' OR seed_content = ''`
    );
    for (const t of need.rows) {
      const content = scaffoldContent({
        grade: t.grade, subject: t.subject, title: t.title, strand: t.strand, standard: t.standard_code
      });
      await client.query(
        `UPDATE curriculum_topics SET seed_content = $2, content_source = 'scaffold', updated_at = now() WHERE id = $1`,
        [t.id, content]
      );
    }
    await client.query('COMMIT');
    console.log(`[curriculum] seeded ${rows.length} topics (${need.rows.length} content scaffolds added).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[curriculum] seed failed:', e.message);
    throw e;
  } finally {
    client.release();
  }
}

// Grade × subject matrix with topic counts, for the landing selector.
async function getOverview(db) {
  const { rows } = await db.query(
    `SELECT grade, subject, COUNT(*)::int AS topic_count,
            COUNT(DISTINCT strand)::int AS strand_count
       FROM curriculum_topics
      GROUP BY grade, subject`
  );
  const counts = {};
  for (const r of rows) counts[`${r.grade}|${r.subject}`] = { topics: r.topic_count, strands: r.strand_count };

  const grades = [];
  for (let g = MIN_GRADE; g <= MAX_GRADE; g += 1) {
    grades.push({
      grade: g,
      subjects: SUBJECTS.map((subject) => ({
        subject,
        topics: counts[`${g}|${subject}`]?.topics || 0,
        strands: counts[`${g}|${subject}`]?.strands || 0
      }))
    });
  }
  return { grades, subjects: SUBJECTS, minGrade: MIN_GRADE, maxGrade: MAX_GRADE };
}

// Strands (ordered) with their topics (ordered) for one grade+subject.
async function getTopics(db, grade, subject) {
  const g = Number(grade);
  const s = String(subject || '').toLowerCase();
  if (!SUBJECTS.includes(s) || !Number.isInteger(g) || g < MIN_GRADE || g > MAX_GRADE) {
    return { grade: g, subject: s, strands: [], topicCount: 0 };
  }
  const { rows } = await db.query(
    `SELECT id, strand, strand_order, title, blurb, standard_code, template_id, topic_order
       FROM curriculum_topics
      WHERE grade = $1 AND subject = $2
      ORDER BY strand_order, topic_order`,
    [g, s]
  );
  const byStrand = new Map();
  for (const r of rows) {
    if (!byStrand.has(r.strand)) byStrand.set(r.strand, { strand: r.strand, order: r.strand_order, topics: [] });
    byStrand.get(r.strand).topics.push({
      id: r.id,
      title: r.title,
      blurb: r.blurb,
      standard: r.standard_code,
      template: r.template_id || null
    });
  }
  const strands = Array.from(byStrand.values()).sort((a, b) => a.order - b.order);
  return { grade: g, subject: s, strands, topicCount: rows.length };
}

// Full record + stored paste-content for one topic (used by Start Lesson).
async function getTopicContent(db, id) {
  const { rows } = await db.query(
    `SELECT id, grade, subject, strand, title, blurb, standard_code, template_id, seed_content, content_source
       FROM curriculum_topics WHERE id = $1`,
    [String(id || '')]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, grade: r.grade, subject: r.subject, strand: r.strand, title: r.title,
    blurb: r.blurb, standard: r.standard_code, template: r.template_id || null,
    content: r.seed_content || scaffoldContent({ grade: r.grade, subject: r.subject, title: r.title, strand: r.strand, standard: r.standard_code }),
    source: r.content_source || 'scaffold'
  };
}

// One-time / on-demand AI upgrade of stored content. For each topic still on a
// scaffold, ask the model for researched, topic-specific teacher content and
// store it (content_source='ai'). Runs on the server where the API key lives;
// the runtime Start-Lesson path then always reads stored content — never AI.
// `callAI(prompt)` is injected (server's callProviderRaw). Returns a summary.
async function backfillContent(db, callAI, { limit = 50, force = false } = {}) {
  const where = force ? `content_source <> 'ai'` : `content_source = 'scaffold'`;
  const { rows } = await db.query(
    `SELECT id, grade, subject, strand, title, standard_code
       FROM curriculum_topics WHERE ${where} ORDER BY grade, subject, strand_order, topic_order LIMIT $1`,
    [Math.max(1, Math.min(300, Number(limit) || 50))]
  );
  let updated = 0;
  for (const t of rows) {
    const prompt = `You are a veteran ${t.subject} teacher preparing to make slides, a quiz, and flashcards for students on a specific topic. Write practical, accurate, grade-appropriate teacher content for the topic below. Be specific to THIS topic (real definitions, real worked examples with numbers, real misconceptions) — not generic filler.

Topic: ${t.title}
Grade: ${gradeText(t.grade)}
Subject: ${cap(t.subject)}
Unit/strand: ${t.strand}${t.standard_code ? `\nStandard: ${t.standard_code}` : ''}

Return well-structured Markdown with these sections: Lesson goal; Key ideas (bulleted, specific); Vocabulary (term — definition); Worked examples (2–3, with actual numbers/steps); Common misconceptions (and the correction); Quick checks (3–5 questions with brief answers); Practice (4–6 problems). Keep it concise and classroom-ready.`;
    try {
      const text = String(await callAI(prompt) || '').trim();
      if (text.length > 120) {
        await db.query(
          `UPDATE curriculum_topics SET seed_content = $2, content_source = 'ai', updated_at = now() WHERE id = $1`,
          [t.id, text]
        );
        updated += 1;
      }
    } catch (e) {
      // Leave the scaffold in place; try again on a later run.
      console.warn(`[curriculum] backfill failed for ${t.id}: ${e.message}`);
    }
  }
  return { scanned: rows.length, updated };
}

module.exports = {
  ensureAndSeed, getOverview, getTopics, getTopicContent, backfillContent,
  scaffoldContent, SUBJECTS, MIN_GRADE, MAX_GRADE
};
