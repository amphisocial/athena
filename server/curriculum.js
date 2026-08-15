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
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_grade_subject ON curriculum_topics (grade, subject);`);

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
    await client.query('COMMIT');
    console.log(`[curriculum] seeded ${rows.length} Massachusetts topics.`);
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

module.exports = { ensureAndSeed, getOverview, getTopics, SUBJECTS, MIN_GRADE, MAX_GRADE };
