import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createTestDatabase } from "./support/pglite";
import { readListeningZip } from "../src/lib/listening/zip";
import { convertLegacyPackage } from "../src/lib/listening/source-parser";
import {
  startListeningAttempt,
  submitListeningAttempt,
} from "../src/lib/data/listening-attempt-write";
const source = process.env.LISTENING_SOURCE_ZIP;
test(
  "Actual uploaded source grades all 40 answers including swapped choose-TWO; repeat submit remains immutable",
  { skip: !source },
  async () => {
    const { textFiles } = readListeningZip(
      new Uint8Array(readFileSync(source!)),
    );
    const payload = convertLegacyPackage(
      textFiles,
      1645.061224,
      (h) => new JSDOM(h).window.document,
    );
    const d = await createTestDatabase();
    try {
      const [u] = await d.query<{ id: string }>(
        "insert into users(name,role,account_status)values('Import QA','student','active')returning id",
      );
      const [t] = await d.query<{ id: string }>(
        "insert into listening_tests(created_by_user_id,title,audio_type,publication_state)values($1,'Source test','audio','draft')returning id",
        [u!.id],
      );
      await d.query(
        "insert into listening_packages(test_id,source_id,payload,audio_object_key,source_hash)values($1,$2,$3,'fixture/audio.mp3',$4)",
        [t!.id, payload.testId, JSON.stringify(payload), "0".repeat(64)],
      );
      const rows = [];
      for (const q of payload.questions) {
        const [r] = await d.query<{ id: string }>(
          "insert into listening_questions(test_id,\"order\",type,question_text,correct_answer,explanation)values($1,$2,'short_answer',$3,$4,$5)returning id",
          [t!.id, q.number, q.text, q.key, q.evidence.why],
        );
        rows.push({
          questionId: r!.id,
          answer:
            q.number === 25
              ? payload.questions[25]!.key
              : q.number === 26
                ? payload.questions[24]!.key
                : q.key,
        });
      }
      const attempt = (await startListeningAttempt(u!.id, t!.id, d.db))!;
      assert.deepEqual(
        await submitListeningAttempt(u!.id, attempt, rows, d.db),
        { score: 40, totalQuestions: 40 },
      );
      assert.deepEqual(await submitListeningAttempt(u!.id, attempt, [], d.db), {
        error: "already_submitted",
      });
      assert.equal(
        (
          await d.query<{ n: number }>(
            "select count(*)::int n from listening_answers where attempt_id=$1",
            [attempt],
          )
        )[0]!.n,
        40,
      );
    } finally {
      await d.close();
    }
  },
);
