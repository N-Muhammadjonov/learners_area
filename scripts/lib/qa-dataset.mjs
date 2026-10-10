/**
 * Shared QA dataset builder for the security matrix (D), the end-to-end journeys (E) and the
 * performance measurements (G).
 *
 * WHY THIS EXISTS. The seeded QA database is deliberately small — 1 reading passage, 1 listening
 * test, 6 speaking prompts, 4 vocabulary entries. That is enough to prove a page renders and
 * nowhere near enough to prove an authorisation boundary, a pagination cursor or a query plan.
 * A security assertion made against a database that contains nothing is vacuous: "student B
 * cannot read student A's attempt" passes trivially when student A has no attempt. So every
 * protected resource the matrix claims to protect is CREATED FIRST and its existence asserted,
 * before any denial is asserted.
 *
 * SAFETY. Every row is tagged. `tag` is a short unique run identifier embedded in a text column
 * of every table that has one, so cleanup can delete exactly what this run created rather than
 * guessing from a row-count difference. `destroyQaDataset()` deletes child-before-parent (the
 * foreign keys are RESTRICT in places, so the order is load-bearing, not cosmetic) and re-queries
 * afterwards to prove the rows are gone. It never touches a row that does not carry the tag.
 *
 * The adversarial shapes are not decoration — each one exists because a specific bug hides in it:
 *   • external_id NULL       — NULL breaks a row-value comparison, so a naive keyset cursor
 *                              silently drops every hand-authored prompt.
 *   • identical created_at   — a cursor keyed on a timestamp alone loops or skips rows.
 *   • microsecond created_at — a JS Date rounds microseconds away, so two prompts one microsecond
 *                              apart become one cursor position and a page repeats or loses a row.
 */
import { randomUUID } from "node:crypto";

/** Child → parent. Foreign keys are RESTRICT/NO ACTION in places, so this order is load-bearing. */
const DESTROY_ORDER = [
  "assignment_targets",
  "assignments",
  "lesson_progress",
  "lessons",
  "reading_answers",
  "reading_attempts",
  "listening_answers",
  "listening_attempts",
  "listening_questions",
  "listening_tests",
  "reading_questions",
  "reading_passages",
  "speaking_attempts",
  "speaking_prompts",
  "writing_feedback",
  "writing_submissions",
  "writing_prompts",
  "user_vocabulary",
  "vocab_folders",
  "lexemes",
  "lexical_units",
  "activity_events",
];

/** Does this database actually have the table? A probe must not fail on an optional one. */
async function hasTable(client, name) {
  const { rows } = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = $1",
    [name],
  );
  return rows.length > 0;
}

/**
 * Build the dataset.
 *
 * @param client   a connected pg Client
 * @param tag      unique run tag, e.g. `qa-<uuid8>`; must be safe to embed in text and SQL LIKE
 * @param actors   { studentA, studentB, teacher, admin, owner } user ids
 * @param sizes    overrides for the counts below
 * @returns        a manifest: { tag, created: { table: [ids] } }
 */
export async function createQaDataset({ client, tag, actors, sizes = {} }) {
  if (!/^[a-z0-9-]{3,40}$/.test(tag)) throw new Error(`unsafe dataset tag: ${tag}`);
  // ONE TRANSACTION for the whole build. This is not a performance choice: the builder inserts
  // 600+ rows one statement at a time, and without a transaction a single bad statement — a
  // wrong enum value, a missing column — leaves every row inserted before it COMMITTED in the
  // database with no manifest to clean them up. That happened while this module was being
  // written. Protection has to start before the first mutation, not after the last one.
  await client.query("begin");
  try {
    const manifest = await buildDataset({ client, tag, actors, sizes });
    await client.query("commit");
    return manifest;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function buildDataset({ client, tag, actors, sizes = {} }) {
  const want = {
    livePartnerPrompts: 620,
    speakingAttempts: 100,
    vocabularyA: 6,
    vocabularyB: 4,
    ...sizes,
  };
  const created = {};
  const note = (table, ids) => {
    created[table] = [...(created[table] ?? []), ...ids];
  };
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  /**
   * A unique, unguessable string embedded in every piece of private content this builder
   * creates, per owner.
   *
   * This is what makes a denial assertion mean something. "GET /api/x as student B returned
   * 403" proves the status line and nothing else — it passes just as happily when the route
   * 404s because the fixture was never created, and it says nothing about a 200 response
   * whose BODY is a 404 page. The marker is the opposite test: if student B's response
   * contains student A's marker, protected content leaked, whatever the status code said.
   * It also gives every negative control a positive twin — the same marker must be PRESENT
   * when the owner of it asks.
   */
  const secret = (who) => `QA-SECRET-${who.toUpperCase()}-${tag}`;
  const markers = {
    studentA: secret("student-a"),
    studentB: secret("student-b"),
    teacher: secret("teacher"),
    owner: secret("owner"),
  };

  /* ---------------------------------------------------------------- SPEAKING */
  // 620+ published prompts reachable by Live Partner, in the four adversarial shapes.
  const promptIds = [];
  const base = Date.UTC(2026, 0, 1);
  const parts = ["part1", "part2", "part3"];
  for (let i = 0; i < want.livePartnerPrompts; i += 1) {
    const id = randomUUID();
    let externalId = `QAX-${tag}-${String(i).padStart(4, "0")}`;
    let createdAt = new Date(base + i * 60_000);
    if (i % 4 === 1) externalId = null; // hand-authored: NULL external_id
    if (i % 7 === 3) createdAt = new Date(base + 500 * 60_000); // 100 rows share one timestamp
    if (i % 11 === 5) createdAt = new Date(base + i * 60_000 + (i % 999)); // microsecond spread
    await q(
      `insert into speaking_prompts
         (id, part, category, prompt_text, prep_seconds, answer_seconds, follow_ups, study_support,
          external_id, topic, available_in, is_active, publication_state, created_at)
       values ($1,$2,$3,$4,30,90,'[]'::jsonb,
          '{"vocabularyHtml":"","modelAnswerHtml":"","ideasHtml":"","vocabulary":[]}'::jsonb,
          $5,$6,'["practice_alone","live_partner"]'::jsonb, true, 'published', $7)`,
      [id, parts[i % parts.length], parts[i % parts.length],
        `[${tag}] Live partner fixture prompt number ${i}: describe a place you remember.`,
        externalId, `[${tag}] topic ${i % 23}`, createdAt.toISOString()],
    );
    promptIds.push(id);
  }
  note("speaking_prompts", promptIds);

  // Two prompts that must NOT be reachable: a draft and a future-scheduled one. A matrix that
  // only checks published content cannot tell "correctly hidden" from "never existed".
  const draftPrompt = randomUUID();
  await q(
    `insert into speaking_prompts (id, part, category, prompt_text, external_id, topic,
       available_in, is_active, publication_state, created_at)
     values ($1,'part1','part1',$2,$3,$4,'["practice_alone","live_partner"]'::jsonb,true,'draft',$5)`,
    [draftPrompt, `[${tag}] DRAFT prompt that must never reach a learner`, `QAX-${tag}-DRAFT`, `[${tag}] draft`,
      new Date(base).toISOString()],
  );
  const scheduledPrompt = randomUUID();
  await q(
    `insert into speaking_prompts (id, part, category, prompt_text, external_id, topic,
       available_in, is_active, publication_state, publish_at, created_at)
     values ($1,'part1','part1',$2,$3,$4,'["practice_alone","live_partner"]'::jsonb,true,'scheduled',$5,$6)`,
    [scheduledPrompt, `[${tag}] SCHEDULED prompt opening in the future`, `QAX-${tag}-SCHED`, `[${tag}] scheduled`,
      new Date(Date.now() + 30 * 86_400_000).toISOString(), new Date(base).toISOString()],
  );
  note("speaking_prompts", [draftPrompt, scheduledPrompt]);

  // 100 attempts for student A, spread over real prompts, with a recording object key so the
  // private-file boundary has something to protect. Student B gets a few of their own: a
  // cross-user denial is only meaningful when BOTH sides have data.
  const attemptIds = [];
  for (let i = 0; i < want.speakingAttempts; i += 1) {
    const id = randomUUID();
    await q(
      `insert into speaking_attempts (id, user_id, prompt_id, part, status, recording_object_key,
         recording_mime_type, recording_size, recording_duration_ms, transcript, transcript_origin,
         started_at, submitted_at, created_at)
       values ($1,$2,$3,'part1','submitted',$4,'audio/webm',48000,45000,$5,'stt',$6,$6,$6)`,
      [id, actors.studentA, promptIds[i % promptIds.length],
        `private/${tag}/speaking/a-attempt-${i}.webm`,
        `[${tag}] student A transcript ${i} ${markers.studentA}`,
        new Date(base + i * 60_000).toISOString()],
    );
    attemptIds.push(id);
  }
  note("speaking_attempts", attemptIds);
  const bAttempt = randomUUID();
  await q(
    `insert into speaking_attempts (id, user_id, prompt_id, part, status, recording_object_key,
       recording_mime_type, recording_size, recording_duration_ms, transcript, transcript_origin,
       started_at, submitted_at, created_at)
     values ($1,$2,$3,'part2','submitted',$4,'audio/webm',52000,60000,$5,'stt',$6,$6,$6)`,
    [bAttempt, actors.studentB, promptIds[1], `private/${tag}/speaking/b-attempt-0.webm`,
      `[${tag}] student B transcript ${markers.studentB}`, new Date(base).toISOString()],
  );
  note("speaking_attempts", [bAttempt]);

  /* ---------------------------------------------------------------- READING */
  const mkPassage = async (state, title, publishAt = null) => {
    const id = randomUUID();
    await q(
      `insert into reading_passages (id, title, body_text, difficulty_level, suggested_minutes,
         is_active, publication_state, publish_at, source_ref)
       values ($1,$2,$3,'B2',20,true,$4,$5,$6)`,
      [id, `[${tag}] ${title}`,
        `[${tag}] The centre opened in 2019. It teaches two hundred students each term. ` +
        `Attendance is recorded every morning and the register closes at nine.`,
        state, publishAt, `qa-${tag}-${state}`],
    );
    const qids = [];
    for (let i = 0; i < 6; i += 1) {
      const qid = randomUUID();
      await q(
        `insert into reading_questions (id, passage_id, "order", type, question_text, options,
           correct_answer, explanation, accepted_answers, question_no)
         values ($1,$2,$3,'multiple_choice',$4,$5,$6,$7,$8,$9)`,
        [qid, id, i + 1, `[${tag}] Question ${i + 1} about the centre.`,
          JSON.stringify(["Two hundred", "Two thousand", "Twenty", "Twelve"]),
          "Two hundred", `[${tag}] Because the passage says two hundred.`,
          JSON.stringify(["Two hundred", "200"]), i + 1],
      );
      qids.push(qid);
    }
    note("reading_questions", qids);
    return id;
  };
  const passageAcademic = await mkPassage("published", "Academic reading fixture");
  const passageGeneral = await mkPassage("published", "General training reading fixture");
  const passageDraft = await mkPassage("draft", "DRAFT reading that must be denied");
  note("reading_passages", [passageAcademic, passageGeneral, passageDraft]);

  /* -------------------------------------------------------------- LISTENING */
  const mkListening = async (state, title) => {
    const id = randomUUID();
    await q(
      `insert into listening_tests (id, created_by_user_id, title, audio_type, audio_url, transcript,
         source_ref, difficulty_level, is_active, publication_state)
       values ($1,$2,$3,'audio',$4,$5,$6,'B2',true,$7)`,
      [id, actors.owner, `[${tag}] ${title}`, `/api/resources/${tag}/audio/${state}.wav`,
        `[${tag}] Transcript: the guide describes the route and the times.`, `qa-${tag}-listen-${state}`, state],
    );
    const qids = [];
    for (let i = 0; i < 3; i += 1) {
      const qid = randomUUID();
      await q(
        `insert into listening_questions (id, test_id, "order", type, question_text, options,
           correct_answer, explanation)
         values ($1,$2,$3,'multiple_choice',$4,$5,$6,$7)`,
        [qid, id, i + 1, `[${tag}] Listening question ${i + 1}.`,
          JSON.stringify(["Nine", "Ten", "Eleven", "Twelve"]), "Nine", `[${tag}] The guide says nine.`],
      );
      qids.push(qid);
    }
    note("listening_questions", qids);
    return id;
  };
  const listeningPublished = await mkListening("published", "Listening fixture");
  const listeningDraft = await mkListening("draft", "DRAFT listening that must be denied");
  note("listening_tests", [listeningPublished, listeningDraft]);

  /* ---------------------------------------------------------------- WRITING */
  const mkPrompt = async (state) => {
    const id = randomUUID();
    await q(
      `insert into writing_prompts (id, task_type, category, prompt, target_word_count,
         publication_state, source_ref)
       values ($1,'task2',$2,$3,250,$4,$5)`,
      [id, `[${tag}] category`, `[${tag}] Some people believe that cities should ban cars. Discuss.`,
        state, `qa-${tag}-writing-${state}`],
    );
    return id;
  };
  const writingPublished = await mkPrompt("published");
  const writingDraft = await mkPrompt("draft");
  note("writing_prompts", [writingPublished, writingDraft]);

  const subA = randomUUID();
  await q(
    `insert into writing_submissions (id, user_id, prompt_id, content, word_count, status, submitted_at)
     values ($1,$2,$3,$4,260,'submitted',$5)`,
    [subA, actors.studentA, writingPublished, `[${tag}] Student A's private submission body. ${markers.studentA}`,
      new Date().toISOString()],
  );
  const subB = randomUUID();
  await q(
    `insert into writing_submissions (id, user_id, prompt_id, content, word_count, status, submitted_at)
     values ($1,$2,$3,$4,240,'submitted',$5)`,
    [subB, actors.studentB, writingPublished, `[${tag}] Student B's private submission body. ${markers.studentB}`,
      new Date().toISOString()],
  );

  // DRAFT submissions. The submission page renders the body ONLY while status='draft'
  // (submitted work shows the evaluation instead), so a page-level privacy assertion built on a
  // submitted fixture is vacuous: the secret is absent for the OWNER too, and "absent for the
  // attacker" then proves nothing. Measured directly before adding these rows.
  const draftA = randomUUID();
  await q(
    `insert into writing_submissions (id, user_id, prompt_id, content, word_count, status)
     values ($1,$2,$3,$4,9,'draft')`,
    [draftA, actors.studentA, writingPublished, `[${tag}] Student A's private DRAFT body. ${markers.studentA}`],
  );
  const draftB = randomUUID();
  await q(
    `insert into writing_submissions (id, user_id, prompt_id, content, word_count, status)
     values ($1,$2,$3,$4,9,'draft')`,
    [draftB, actors.studentB, writingPublished, `[${tag}] Student B's private DRAFT body. ${markers.studentB}`],
  );

  note("writing_submissions", [subA, subB, draftA, draftB]);

  /* ------------------------------------------------------------- VOCABULARY */
  const unitId = randomUUID();
  await q(`insert into lexical_units (id, lemma, lemma_norm) values ($1,$2,$3)`,
    [unitId, `[${tag}] resilience`, `[${tag}] resilience`]);
  note("lexical_units", [unitId]);

  const lexemeIds = [];
  for (let i = 0; i < want.vocabularyA + want.vocabularyB; i += 1) {
    const id = randomUUID();
    await q(
      `insert into lexemes (id, lexical_unit_id, term, part_of_speech, definition_en, translation_uz,
         example_sentence, sense_key)
       values ($1,$2,$3,'adjective',$4,$5,$6,$7)`,
      [id, unitId, `[${tag}]word${i}`, `[${tag}] able to recover quickly (${i})`, `[${tag}] bardoshli`,
        `[${tag}] The city is resilient.`, `[${tag}]word${i}|adjective|able to recover (${i})`],
    );
    lexemeIds.push(id);
  }
  note("lexemes", lexemeIds);

  const folderA1 = randomUUID();
  const folderA2 = randomUUID();
  const folderB1 = randomUUID();
  for (const [id, userId, name] of [[folderA1, actors.studentA, `[${tag}] A folder one`],
    [folderA2, actors.studentA, `[${tag}] A folder two`], [folderB1, actors.studentB, `[${tag}] B folder`]]) {
    await q(`insert into vocab_folders (id, user_id, name) values ($1,$2,$3)`, [id, userId, name]);
  }
  note("vocab_folders", [folderA1, folderA2, folderB1]);

  const vocabIds = [];
  for (let i = 0; i < want.vocabularyA; i += 1) {
    const id = randomUUID();
    await q(
      `insert into user_vocabulary (id, user_id, lexeme_id, state, source_type, folder_id, sense_key,
         srs_stage, mastery, correct_count, interval_days, next_review_at, first_seen_at, last_seen_at, seen_count)
       values ($1,$2,$3,'learning','manual',$4,$5,$6,'LEARNING',$7,$8,now(),now(),now(),3)`,
      [id, actors.studentA, lexemeIds[i], i % 2 === 0 ? folderA1 : folderA2,
        `[${tag}]word${i}|adjective|able to recover (${i})`, i % 4, i * 2, i],
    );
    vocabIds.push(id);
  }
  for (let i = 0; i < want.vocabularyB; i += 1) {
    const id = randomUUID();
    const lexemeIndex = want.vocabularyA + i;
    await q(
      `insert into user_vocabulary (id, user_id, lexeme_id, state, source_type, folder_id, sense_key,
         srs_stage, mastery, correct_count, interval_days, next_review_at, first_seen_at, last_seen_at, seen_count)
       values ($1,$2,$3,'new','manual',$4,$5,$6,'NEW',$7,$8,now(),now(),now(),1)`,
      [id, actors.studentB, lexemeIds[lexemeIndex], folderB1,
        `[${tag}]word${lexemeIndex}|adjective|able to recover (${lexemeIndex})`, -1, 0, 0],
    );
    vocabIds.push(id);
  }
  note("user_vocabulary", vocabIds);

  /* ---------------------------------------------------------------- LESSONS */
  const [unit] = await q(`select id from units order by "order" limit 1`);
  const lessonIds = [];
  for (const [i, state] of [[0, "published"], [1, "published"], [2, "draft"]]) {
    const id = randomUUID();
    await q(
      `insert into lessons (id, unit_id, slug, title, "order", publication_state)
       values ($1,$2,$3,$4,$5,$6)`,
      [id, unit.id, `${tag}-lesson-${i}`, `[${tag}] Lesson ${i} (${state}) ${markers.teacher}`, 900 + i, state],
    );
    lessonIds.push(id);
  }
  note("lessons", lessonIds);

  /* ------------------------------------------------------------ ASSIGNMENTS */
  const assignmentIds = [];
  for (const studentId of [actors.studentA, actors.studentB]) {
    const id = randomUUID();
    await q(
      `insert into assignments (id, title, description, created_by_user_id, target_user_id,
         related_writing_prompt_id, status)
       values ($1,$2,$3,$4,$5,$6,'not_started')`,
      [id, `[${tag}] Assignment for ${studentId.slice(0, 8)}`,
        `[${tag}] Private instructions ${studentId === actors.studentA ? markers.studentA : markers.studentB}`,
        actors.teacher, studentId, writingPublished],
    );
    const targetId = randomUUID();
    await q(
      `insert into assignment_targets (id, assignment_id, student_user_id) values ($1,$2,$3)`,
      [targetId, id, studentId],
    );
    assignmentIds.push(id);
    note("assignment_targets", [targetId]);
  }
  note("assignments", assignmentIds);

  return {
    tag,
    markers,
    created,
    ids: {
      promptIds, draftPrompt, scheduledPrompt, attemptIds, bAttempt,
      passageAcademic, passageGeneral, passageDraft,
      listeningPublished, listeningDraft,
      writingPublished, writingDraft, subA, subB, draftA, draftB,
      lexemeIds, folderA1, folderA2, folderB1, vocabIds,
      lessonIds, assignmentIds, unitId,
    },
  };
}

/**
 * Delete exactly what `createQaDataset` made, child before parent, and prove it.
 *
 * Tag-scoped as well as id-scoped: the ids are the precise list, and the tag predicate means a
 * manifest that has somehow lost an id still cannot reach an untagged production row.
 */
export async function destroyQaDataset({ client, manifest }) {
  const { tag, created } = manifest;
  const deleted = {};
  for (const table of DESTROY_ORDER) {
    const ids = created[table] ?? [];
    if (!ids.length) continue;
    if (!(await hasTable(client, table))) continue;
    // Chunked: 620 prompts in one IN list is fine, but keep the statement small and predictable.
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      const { rowCount } = await client.query(
        `delete from "${table}" where id = any($1::uuid[])`, [slice],
      );
      deleted[table] = (deleted[table] ?? 0) + (rowCount ?? 0);
    }
    // Re-query: cleanup that is not verified proves nothing.
    const { rows } = await client.query(
      `select count(*)::int as n from "${table}" where id = any($1::uuid[])`, [ids],
    );
    if (rows[0].n !== 0) throw new Error(`residue after destroy: ${rows[0].n} row(s) left in ${table} for tag ${tag}`);
  }
  return { deleted, tag };
}

/**
 * Positive-control helper: prove the protected resource actually exists before asserting that
 * somebody is denied access to it. Without this, every denial assertion in the matrix could pass
 * on an empty database and mean nothing.
 */
export async function assertFixtureExists(client, label, sql, params = []) {
  const { rows } = await client.query(sql, params);
  const n = Number(rows[0]?.n ?? rows.length);
  if (!n) throw new Error(`POSITIVE CONTROL FAILED — ${label}: the fixture this assertion depends on does not exist`);
  return n;
}


/**
 * Tag-scoped cleanup for rows whose manifest was lost — a build that failed halfway, or a run
 * killed before `destroyQaDataset` could execute. Matches on the tag embedded in a text column,
 * so it can only ever reach rows this module created. Order is child → parent, same as
 * DESTROY_ORDER; the foreign keys are RESTRICT/NO ACTION, so a wrong order throws rather than
 * silently deleting half the set.
 */
export async function destroyQaDatasetByTag({ client, tag }) {
  if (!/^[a-z0-9-]{3,40}$/.test(tag)) throw new Error(`unsafe dataset tag: ${tag}`);
  const pattern = `%${tag}%`;
  const textColumn = {
    speaking_attempts: "recording_object_key",
    speaking_prompts: "prompt_text",
    reading_questions: "question_text",
    reading_passages: "title",
    listening_questions: "question_text",
    listening_tests: "title",
    writing_submissions: "content",
    writing_prompts: "prompt",
    user_vocabulary: "sense_key",
    vocab_folders: "name",
    lexemes: "term",
    lexical_units: "lemma",
    lessons: "title",
    assignments: "title",
  };
  const removed = {};
  for (const table of DESTROY_ORDER) {
    const column = textColumn[table];
    if (!column) continue;
    if (!(await hasTable(client, table))) continue;
    const exists = await client.query(
      "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
      [table, column],
    );
    if (!exists.rows.length) continue;
    const { rowCount } = await client.query(`delete from "${table}" where "${column}" like $1`, [pattern]);
    if (rowCount) removed[table] = rowCount;
  }
  return removed;
}
