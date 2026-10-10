import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, speakingMaterials, writingPrompts, contentVersions, assignments, assignmentTargets } from "../src/db/schema";
import { pinSpeakingMaterialVersion } from "../src/lib/services/speaking/materials";
import { pinVersion } from "../src/lib/content/versions";
import { createAssignment, listAssignableContent } from "../src/lib/content/assignments";

/*
 * §6 — what a teacher may set as work, and the API agreeing with the picker.
 *
 * Speaking material is authored, versioned and previewed, and is deliberately NOT assignable:
 * there is no canonical assignment target for it, and the registry refuses rather than invents one
 * (tests/speaking-canonical-identity.test.ts SP4 asserts exactly that, by reading this module and
 * requiring no `speaking_material:` target to exist). The picker honours that by omission —
 * listAssignableContent() leaves out any revision whose target type it does not know.
 *
 * The API did not. `createAssignment` checked only that the content type was KNOWN and the revision
 * PUBLISHED, both of which are true for speaking material, so POST /api/assignments pinned it and
 * answered HTTP 201. A teacher could therefore set work by hand-crafted request that no picker would
 * ever offer — the two halves of one feature disagreeing about what is assignable.
 *
 * The second gap is the same rule seen from the other side: a revision stays published after the
 * canonical row behind it is withdrawn, archived, or scheduled for later, and nothing in
 * createAssignment looked at the row. Assigning that hands a learner a task they cannot open.
 *
 * Both now come from ONE place — TARGET_LIVENESS, via assignableTargetProblem() — which is the same
 * map the picker reads, so the catalogue and the writer cannot drift apart again.
 */
test("speaking material is not assignable and the API refuses it, and withdrawn content is refused too", { skip: process.env.QA2_DATABASE_TESTS !== "1" }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/learners_qa2",
    "this test mutates rows, so it only runs against the disposable QA database",
  );

  const adminId = randomUUID();
  const studentId = randomUUID();
  const materialId = randomUUID();
  const materialRef = `qa2-notassignable-${randomUUID()}`;
  const materialTitle = `QA2 non-assignable material ${randomUUID()}`;
  const promptRef = `qa2-assignable-prompt-${randomUUID()}`;
  const createdAssignmentIds: string[] = [];

  await db.insert(users).values([
    { id: adminId, name: "QA2 assign admin", role: "admin" as const, accountStatus: "active" as const },
    { id: studentId, name: "QA2 assign student", role: "student" as const, accountStatus: "active" as const },
  ]);

  // A real published writing prompt to be the assignable positive control.
  const prompt = await db.select().from(writingPrompts).where(eq(writingPrompts.publicationState, "published")).limit(1);
  assert.ok(prompt[0], "the QA database has a published writing prompt to assign");
  const promptId = prompt[0]!.id;
  // A writing prompt's canonical content type is its task type — the writing module declares
  // task1/task2, not "prompt", so guessing the pair here would fail as unknown_content_type
  // and the positive control would prove nothing.
  const promptContentType = prompt[0]!.taskType;
  assert.ok(["task1", "task2"].includes(promptContentType), `unexpected task type ${promptContentType}`);

  const cleanup = async () => {
    // Children first: the positive controls create real assignments with real target rows.
    for (const id of createdAssignmentIds) {
      await db.delete(assignmentTargets).where(eq(assignmentTargets.assignmentId, id)).catch(() => {});
      await db.delete(assignments).where(eq(assignments.id, id)).catch(() => {});
    }
    for (const ref of [materialRef, promptRef])
      await db.delete(contentVersions).where(eq(contentVersions.sourceRef, ref)).catch(() => {});
    await db.delete(speakingMaterials).where(eq(speakingMaterials.id, materialId)).catch(() => {});
    await db.delete(users).where(eq(users.id, studentId)).catch(() => {});
    await db.delete(users).where(eq(users.id, adminId)).catch(() => {});
  };

  try {
    // ---- author a speaking material the way the product does, so the revision is real ----
    const [created] = await db.insert(speakingMaterials).values({
      id: materialId, createdByUserId: adminId, category: "part1", title: materialTitle,
      primaryType: "link", primaryUrl: "https://example.edu/qa2-notassignable",
      isActive: true, publicationState: "published",
    }).returning();
    const materialRevision = await db.transaction((tx) =>
      pinSpeakingMaterialVersion(tx as never, {
        materialId, sourceRef: materialRef, title: materialTitle, category: created!.category,
        primaryType: created!.primaryType, primaryUrl: created!.primaryUrl,
        publicationState: created!.publicationState, actorUserId: adminId, via: "authoring",
      }),
    );
    assert.equal(materialRevision.version.publicationState, "published");

    // ---- the picker still refuses to offer it: that decision is unchanged ----
    const offered = (await listAssignableContent()).find((item) => item.sourceRef === materialRef);
    assert.equal(offered, undefined, "speaking material is authored but never offered as assignable work");

    // ---- and now the API agrees with the picker instead of accepting it ----
    const attempt = await db.transaction((tx) =>
      createAssignment(tx as never, {
        actor: { id: adminId, role: "admin" },
        title: `QA2 attempt ${randomUUID()}`, description: null, instructions: null,
        reference: {
          module: "speaking", contentType: "material", sourceRef: materialRef,
          versionId: materialRevision.version.id,
        },
        studentIds: [studentId], dueAt: null,
      }),
    );
    assert.equal(attempt.ok, false, "a reference the picker would never offer must not be assignable by request");
    if (!attempt.ok) {
      assert.deepEqual(
        attempt.issues.map((issue) => issue.code), ["content_not_assignable"],
        "and it says why, rather than failing as an unknown content type",
      );
    }

    // ---- a DECLARED type whose row was withdrawn is refused for a different reason ----
    const promptRevision = await db.transaction((tx) =>
      pinVersion(tx as never, {
        module: "writing", contentType: promptContentType, sourceRef: promptRef,
        title: `QA2 assignable prompt ${randomUUID()}`, track: "unspecified",
        content: { prompt: "QA2 prompt body", targetWordCount: 150 },
        publicationState: "published", actorUserId: adminId,
        targetType: "writing_prompt", targetId: promptId,
        provenance: { via: "authoring", store: "writing_prompts" },
      }),
    );

    const assign = (versionId: string, title: string) =>
      db.transaction((tx) =>
        createAssignment(tx as never, {
          actor: { id: adminId, role: "admin" },
          title, description: null, instructions: null,
          reference: { module: "writing", contentType: promptContentType, sourceRef: promptRef, versionId },
          studentIds: [studentId], dueAt: null,
        }),
      );

    // POSITIVE CONTROL. Without this, a refusal proving nothing would look like the fix working:
    // a declared type whose canonical row is live must still be assignable.
    const live = await assign(promptRevision.version.id, `QA2 live ${randomUUID()}`);
    assert.equal(
      live.ok, true,
      `a declared, live target is still assignable — the check is not a blanket refusal${live.ok ? "" : ` (refused: ${JSON.stringify(live.issues)})`}`,
    );
    if (live.ok) {
      assert.ok(live.assignmentId, "and it returns the assignment it created");
      createdAssignmentIds.push(live.assignmentId);
      const written = await db.select().from(assignmentTargets).where(eq(assignmentTargets.assignmentId, live.assignmentId));
      assert.equal(written.length, 1, "the accepted assignment wrote exactly one target row, so the learner can see it");
      assert.equal(written[0]!.studentUserId, studentId, "and it points at the student it was set for");
    }

    // Withdraw the row behind the revision. The revision itself stays published — that is the point.
    await db.update(writingPrompts).set({ publicationState: "draft" }).where(eq(writingPrompts.id, promptId));
    const withdrawn = await assign(promptRevision.version.id, `QA2 withdrawn ${randomUUID()}`);
    assert.equal(withdrawn.ok, false, "content withdrawn after its revision was published must not be assignable");
    if (!withdrawn.ok) {
      assert.deepEqual(withdrawn.issues.map((issue) => issue.code), ["content_not_live"]);
    }

    // Restore it, and the same reference is acceptable again — proving the refusal tracks the row.
    await db.update(writingPrompts).set({ publicationState: "published" }).where(eq(writingPrompts.id, promptId));
    const restored = await assign(promptRevision.version.id, `QA2 restored ${randomUUID()}`);
    assert.equal(restored.ok, true, "restoring publication makes the same revision assignable again");
    if (restored.ok) createdAssignmentIds.push(restored.assignmentId);

    // Nothing the REFUSED attempts did should exist: a refusal that commits nothing is the point.
    const stray = await db.select().from(assignments).where(eq(assignments.createdByUserId, adminId));
    assert.equal(
      stray.length, createdAssignmentIds.length,
      "only the accepted attempts wrote assignments — the refused ones committed nothing",
    );
  } finally {
    await db.update(writingPrompts).set({ publicationState: "published" }).where(eq(writingPrompts.id, promptId)).catch(() => {});
    await cleanup();
    const left = await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, materialRef));
    assert.equal(left.length, 0, "the fixture revision is gone");
  }
});
