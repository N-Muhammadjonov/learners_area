import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { users, speakingMaterials, contentVersions } from "../src/db/schema";
import { pinSpeakingMaterialVersion } from "../src/lib/services/speaking/materials";
import { listAssignableContent } from "../src/lib/content/assignments";

/*
 * §6 — the teacher's assignment picker must offer exactly the content a learner can open,
 * and must not offer content the assignment API would refuse.
 *
 * The defect this pins down is an INCONSISTENCY between two halves of the same feature:
 *
 *   POST /api/assignments          accepts module=speaking, contentType=material → HTTP 201,
 *                                  pinning the revision it was given;
 *   src/lib/content/taxonomy       already knows speaking:material (isKnownModule and
 *                                  isKnownContentType both true);
 *   GET /api/assignments/assignable never listed it.
 *
 * So a teacher could author and publish a speaking resource through a supported surface and then
 * be unable to select it in the assignment form, while the API behind that form would have taken
 * it. The cause was that listAssignableContent() requires every revision's target type to be
 * declared in TARGET_LIVENESS — deliberately, so an undeclared type is never assumed live — and
 * `speaking_material` had never been declared. Every other assignable type was.
 *
 * The negative controls matter as much as the positive one. Declaring the type without applying
 * the liveness rule would make the picker offer withdrawn and not-yet-open material, which is a
 * worse bug than the one being fixed: it would hand a teacher work a learner cannot start. So the
 * rule asserted here is the SAME rule the learner read path applies (src/lib/data/speaking.ts
 * listLiveMaterialRows → liveWhere(publicationState, publishAt)), verified by withdrawing the row
 * and by scheduling it into the future.
 */
test("the assignment picker offers published speaking material, and withdraws it when a learner could no longer open it", { skip: process.env.QA2_DATABASE_TESTS !== "1" }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/learners_qa2",
    "this test mutates rows, so it only runs against the disposable QA database",
  );

  const authorId = randomUUID();
  const materialId = randomUUID();
  const sourceRef = `qa2-assignable-${randomUUID()}`;
  const title = `QA2 assignable speaking material ${randomUUID()}`;

  await db.insert(users).values({
    id: authorId, name: "QA2 assignable author", role: "teacher" as const, accountStatus: "active" as const,
  });

  const cleanup = async () => {
    await db.delete(contentVersions).where(eq(contentVersions.sourceRef, sourceRef)).catch(() => {});
    await db.delete(speakingMaterials).where(eq(speakingMaterials.id, materialId)).catch(() => {});
    await db.delete(users).where(eq(users.id, authorId)).catch(() => {});
  };

  try {
    // Publish the material through the product's own writer, so the revision is the one a real
    // authoring surface would produce — not a row assembled by hand to suit the assertion.
    const [created] = await db.insert(speakingMaterials).values({
      id: materialId,
      createdByUserId: authorId,
      category: "part1",
      title,
      primaryType: "link",
      primaryUrl: "https://example.edu/qa2-assignable",
      isActive: true,
      publicationState: "published",
    }).returning();
    const pinned = await db.transaction((tx) =>
      pinSpeakingMaterialVersion(tx as never, {
        materialId, sourceRef, title, category: created!.category,
        primaryType: created!.primaryType, primaryUrl: created!.primaryUrl,
        publicationState: created!.publicationState, actorUserId: authorId, via: "authoring",
      }),
    );
    assert.equal(pinned.version.publicationState, "published", "the revision is published");

    const find = (items: Awaited<ReturnType<typeof listAssignableContent>>) =>
      items.find((item) => item.sourceRef === sourceRef);

    // ---- the positive case: what the API accepts, the picker offers ----
    const offered = find(await listAssignableContent());
    assert.ok(offered, "a published speaking material is offered to the teacher as assignable work");
    assert.equal(offered!.module, "speaking");
    assert.equal(offered!.contentType, "material");
    assert.equal(offered!.versionId, pinned.version.id, "the picker names the revision createAssignment will pin");

    // ---- negative control 1: withdrawn in place is not assignable ----
    await db.update(speakingMaterials).set({ publicationState: "draft" }).where(eq(speakingMaterials.id, materialId));
    assert.equal(
      find(await listAssignableContent()), undefined,
      "a material withdrawn after its revision was published must not be offered — the learner could not open it",
    );

    /*
     * ---- negative control 2: scheduled but not yet open is not assignable ----
     *
     * The rule is liveWhere() in src/lib/services/cms/publication.ts: published, OR scheduled whose
     * publish_at has arrived. So "not yet open" is the SCHEDULED state with a future publish_at —
     * not a published row carrying a future date, which the rule treats as live because
     * publication_state is the authority. Asserting the second shape would have been asserting a
     * rule the product does not have.
     */
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await db.update(speakingMaterials)
      .set({ publicationState: "scheduled", publishAt: future })
      .where(eq(speakingMaterials.id, materialId));
    assert.equal(
      find(await listAssignableContent()), undefined,
      "a material scheduled to open in the future must not be offered yet",
    );

    // ---- and the same schedule becomes assignable the moment it opens ----
    await db.update(speakingMaterials)
      .set({ publicationState: "scheduled", publishAt: new Date(Date.now() - 60_000) })
      .where(eq(speakingMaterials.id, materialId));
    assert.ok(
      find(await listAssignableContent()),
      "a schedule whose publish_at has arrived is live, by the same rule the learner read applies",
    );

    // ---- and it comes back when it is genuinely live again ----
    await db.update(speakingMaterials)
      .set({ publicationState: "published", publishAt: null })
      .where(eq(speakingMaterials.id, materialId));
    assert.ok(find(await listAssignableContent()), "restoring publication restores the offering");

    // ---- the picker still offers the types it always did ----
    const modules = new Set((await listAssignableContent()).map((item) => item.module));
    assert.ok(!modules.has("shadowing"), "shadowing is retired and must not be assignable");
  } finally {
    await cleanup();
    assert.equal(
      (await db.select().from(speakingMaterials).where(eq(speakingMaterials.id, materialId))).length, 0,
      "the fixture material is gone",
    );
    assert.equal(
      (await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, sourceRef))).length, 0,
      "and so is its revision",
    );
  }
});
