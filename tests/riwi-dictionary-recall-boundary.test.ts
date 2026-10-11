import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Role } from "../src/lib/auth/roles";
import { createTestDatabase, bodyOfWords, simpleStructure } from "./support/pglite";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { startOrResumeAttempt } from "../src/lib/data/retention-attempts";
import { hasDictionaryAssistanceLock, lookupCanonicalDictionary, lookupDictionaryOccurrence, resolveDictionaryOccurrence } from "../src/lib/services/riwi/dictionary";
import { appendRiwiTurn, getRiwiConversationHistory, getRiwiConversationTranscript, openRiwiConversation } from "../src/lib/services/riwi/conversations";

for (const role of ["student", "teacher", "admin", "owner"] as Role[])
  test(`${role}: active recall denies canonical/occurrence dictionary, restored history and late saves without changing learning rows`, async () => {
    const t = await createTestDatabase(), userId = randomUUID(), author = randomUUID(), other = randomUUID();
    try {
      await t.query("insert into users(id,name,role,account_status)values($1,'Dictionary reader',$2,'active'),($3,'Author','owner','active'),($4,'Other learner','student','active')", [userId, role, author, other]);
      await t.query("insert into lexemes(term,definition_en,translation_uz,example_sentence,sense_key,provenance,verification_status)values('resilient','able to recover','bardoshli','A resilient team recovers.',$1,'authored','verified')", [randomUUID()]);
      const actor = { id: userId, role }, scope = { kind: "canonical_term" as const };
      const conversation = await openRiwiConversation({ actor, locale: "en", dictionaryScope: scope }, t.db);
      const turn = { actor, conversationId: conversation.id, userMessage: "Define resilient.", assistantMessage: "able to recover",
        metadata: { correlationId: randomUUID(), intent: "dictionary_lookup", fallbackUsed: false, externalEligible: false,
          provenance: "canonical_dictionary" as const, citations: [], dictionaryScope: scope } };
      await appendRiwiTurn(turn, t.db);
      assert.equal((await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, t.db)).length, 2);
      await createRetentionText({ level: "B1", bodyText: bodyOfWords(175), scoringStructure: simpleStructure("dictionary lock"), actorUserId: author }, t.db);
      const session = await startOrResumeAttempt({ userId, level: "B1" }, t.db);
      const occurrence = { actor, sourceType: "reading" as const, sourceId: randomUUID(), occurrenceId: randomUUID() };
      const snapshot = () => t.query("select to_jsonb(a) as state from retention_attempts a order by id");
      for (const status of ["reading", "recall"] as const) {
        await t.query("update retention_attempts set status=$2 where id=$1", [session.attempt.id, status]);
        const before = await snapshot();
        assert.equal(await hasDictionaryAssistanceLock(actor, t.db), true);
        assert.deepEqual(await lookupCanonicalDictionary("resilient", actor, t.db), { status: "locked" });
        assert.deepEqual(await lookupDictionaryOccurrence(occurrence, t.db), { status: "locked" });
        assert.equal((await resolveDictionaryOccurrence(occurrence, t.db))?.status, "locked");
        await assert.rejects(openRiwiConversation({ actor, locale: "en", dictionaryScope: scope }, t.db), /not_found/);
        await assert.rejects(getRiwiConversationTranscript({ actor, conversationId: conversation.id }, t.db), /not_found/);
        await assert.rejects(getRiwiConversationHistory({ actor, conversationId: conversation.id }, t.db), /not_found/);
        await assert.rejects(appendRiwiTurn({ ...turn, metadata: { ...turn.metadata, correlationId: randomUUID() } }, t.db), /not_found/);
        assert.deepEqual(await snapshot(), before, "lexical help cannot submit, timeout, score or reschedule recall");
        assert.equal((await t.query<{ count: number }>("select count(*)::int count from riwi_conversation_messages where conversation_id=$1", [conversation.id]))[0]?.count, 2);
        assert.equal((await lookupCanonicalDictionary("resilient", { id: other, role: "student" }, t.db)).status, "resolved", "the lock belongs to this learner");
      }
      await t.query("update retention_attempts set status='timed_out' where id=$1", [session.attempt.id]);
      assert.equal((await lookupCanonicalDictionary("resilient", actor, t.db)).status, "resolved");
      assert.equal((await getRiwiConversationTranscript({ actor, conversationId: conversation.id }, t.db)).length, 2);
      await t.query("update users set account_status='suspended' where id=$1", [userId]);
      await assert.rejects(appendRiwiTurn(turn, t.db), /not_found/, "late dictionary saves recheck database account status");
    } finally { await t.close(); }
  });
