import {finishWorkerIndex} from '@/lib/dictionary/publish-worker-index';
import { after, NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireOwner } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import {
  summary,
  rows,
  pinnedRelease,
  searchDictionary,
  entryById,
  entriesByIds,
  saveDraft,
  activeRelease,
} from "@/lib/dictionary/store";
import { applyDraft, draftSchema, normalizeSearch } from "@/lib/dictionary/model";
import {
  beginPublish,
  advancePublish,
  retryWorkerIndex,
  rollback,
} from "@/lib/dictionary/publish";
import { apiError, privateHeaders } from "@/lib/dictionary/api";
type Context = { params: Promise<{ action: string[] }> };
export async function GET(req: NextRequest, { params }: Context) {
  const owner = await requireOwner();
  if (!owner)
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateHeaders },
    );
  const { action } = await params;
  try {
    let data: unknown;
    if (action.length === 1 && action[0] === "summary") data = await summary();
    else if (action.length === 1 && action[0] === "search") {
      const q = req.nextUrl.searchParams.get("q") ?? "",
        direction = req.nextUrl.searchParams.get("direction") ?? "EN";
      if (q.length > 80 || !["EN", "UZ"].includes(direction))
        return NextResponse.json({ error: "invalid_input" }, { status: 400 });
      const release_id = await pinnedRelease();
      data = {
        release_id,
        results: await searchDictionary(
          q,
          direction as "EN" | "UZ",
          release_id,
        ),
      };
    } else if (
      action.length === 2 &&
      action[0] === "entries" &&
      isUuid(action[1]!)
    ) {
      const release = await pinnedRelease(
        req.nextUrl.searchParams.get("release_id"),
      );
      data = { entry: await entryById(action[1]!, release) };
    } else if (action.length === 1 && action[0] === "drafts")
      data = {
        drafts: await rows(
          sql`select id,base_release_id,changes,state,created_at from dictionary_drafts where owner_user_id=${owner.id}::uuid and state='draft' order by created_at desc limit 100`,
        ),
      };
    else if (action.length === 1 && action[0] === "history")
      data = {
        history: await rows(
          sql`select id,operation,entity_id,base_release_id,candidate_release_id,result_release_id,validation_result,created_at from dictionary_owner_events order by created_at desc limit 50`,
        ),
      };
    else if (action.length === 1 && action[0] === "publish")
      data = {
        job:
          (
            await rows(
              sql`select id,phase,error,candidate_release_id from dictionary_publish_jobs where owner_user_id=${owner.id}::uuid order by updated_at desc limit 1`,
            )
          )[0] ?? null,
      };
    else return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data, { headers: privateHeaders });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: NextRequest, { params }: Context) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { action } = await params;
  try {
    let data: unknown;
    if (action.length === 1 && action[0] === "drafts") {
      const p = draftSchema.safeParse(await req.json().catch(() => null));
      if (!p.success)
        return NextResponse.json({ error: "invalid_input" }, { status: 400 });
      data = { draft: await saveDraft(owner.id, p.data) };
    } else if (action.length === 1 && action[0] === "publish")
      data = { job: await beginPublish(owner.id) };
    else if (
      action.length === 2 &&
      action[0] === "publish" &&
      isUuid(action[1]!)
    )
      {const job=await advancePublish(owner.id,action[1]!);data={job};if(job.phase==='worker_index')after(()=>finishWorkerIndex(owner.id,job.id));}
    else if(action.length===3&&action[0]==="publish"&&isUuid(action[1]!)&&action[2]==="retry"){
      const job=await retryWorkerIndex(owner.id,action[1]!);data={job};after(()=>finishWorkerIndex(owner.id,job.id));
    }
    else if (action.length === 1 && action[0] === "rollback")
      data = await rollback(owner.id);
    else return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data, { headers: privateHeaders });
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(req: NextRequest, { params }: Context) {
  return mutateDraft(req, params, false);
}
export async function DELETE(req: NextRequest, { params }: Context) {
  return mutateDraft(req, params, true);
}
async function mutateDraft(
  req: NextRequest,
  params: Context["params"],
  discard: boolean,
) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { action } = await params;
  if (action.length !== 2 || action[0] !== "drafts" || !isUuid(action[1]!))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = discard
    ? null
    : draftSchema.safeParse(await req.json().catch(() => null));
  if (parsed && !parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
      const [draft] = await rows<{ changes: unknown; base_release_id: string }>(
        sql`select changes,base_release_id from dictionary_drafts where id=${action[1]}::uuid and owner_user_id=${owner.id}::uuid and state='draft' for update`,
        tx,
      );
      if (!draft) throw Error("entry_not_found");
      const busy = await rows(
        sql`select id from dictionary_publish_jobs where phase not in ('complete','failed') and ${action[1]}::uuid=any(draft_ids)`,
        tx,
      );
      if (busy.length) throw Error("publish_already_running");
      const active = await activeRelease(tx);
      if (active.active_release_id !== draft.base_release_id)
        throw Error("stale_draft");
      if (parsed?.success) {
        const changes = parsed.data;
        const original = changes.operation === "add_lexeme"
          ? [...(await entriesByIds((await rows<{lexeme_id:string}>(sql`select lexeme_id from dictionary_entries where release_id=${active.active_release_id} and lemma_norm=${normalizeSearch(changes.lemma)}`,tx)).map(row=>row.lexeme_id),active.active_release_id,tx)).values()]
          : [await entryById(changes.lexemeId,active.active_release_id,tx)].filter((entry): entry is import("@/lib/dictionary/model").Entry => Boolean(entry));
        applyDraft(original, changes, active.active_release_id);
      }
      await tx.execute(
        discard
          ? sql`update dictionary_drafts set state='discarded',updated_at=now() where id=${action[1]}::uuid`
          : sql`update dictionary_drafts set changes=${JSON.stringify(parsed?.success ? parsed.data : null)}::jsonb,updated_at=now() where id=${action[1]}::uuid`,
      );
      await tx.execute(
        sql`insert into dictionary_owner_events(owner_user_id,operation,entity_id,base_release_id,before_state,after_state,validation_result) values(${owner.id}::uuid,${discard ? "discard_draft" : "edit_draft"},${action[1]},${draft.base_release_id},${JSON.stringify(draft.changes)}::jsonb,${JSON.stringify(parsed?.success ? parsed.data : null)}::jsonb,'{"pass":true}'::jsonb)`,
      );
    });
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (e) {
    return apiError(e);
  }
}
