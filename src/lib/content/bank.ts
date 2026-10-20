import { notDeleted } from "@/lib/content/deletion-filter";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { moduleDescriptor, PUBLICATION_STATES, type PublicationState } from "@/lib/content/taxonomy";

/**
 * The bank needs raw SQL (aggregates over every revision, with HAVING on the item), so
 * it asks for an executor that can `execute` — the same shape the app's drizzle handle
 * and the tests' pglite handle both satisfy.
 */
export type BankExecutor = { execute: typeof db.execute };

/**
 * THE CONTENT BANK (§AC) — one searchable surface over every canonical content item.
 *
 * The rules this module keeps:
 *
 *   • it is a PROJECTION over `content_versions`, never a second store. Nothing is
 *     copied, and no content type gets its own private list;
 *   • an item is identified by (module, contentType, sourceRef) — NEVER by its title.
 *     `title` is a searchable field and a display label; `sourceRef` is the identity;
 *   • filtering happens in SQL over the whole bank, not over one page of rows, and the
 *     result is bounded (`limit` is capped) so a large bank cannot be pulled into memory;
 *   • the caller must be staff. That is enforced at the route; this layer answers only
 *     "what does the bank contain", so a learner read path must never call it.
 *
 * Two different questions about publication state are supported, because a bank needs
 * both and they are not the same question:
 *
 *   `latestState` — the item's NEWEST revision is in this state (the item's state now);
 *   `hasState`    — ANY revision of the item is in this state (its history includes it).
 */

export type ContentBankFilter = {
  module?: string;
  contentType?: string;
  /** The item's newest revision is in this state. */
  latestState?: PublicationState;
  /** Any revision of the item is in this state. */
  hasState?: PublicationState;
  track?: string;
  /** Substring match on the stable identity. */
  sourceRef?: string;
  /** Substring match on the item's title (never the identity). */
  title?: string;
  /** Free text over BOTH the identity and the title. */
  q?: string;
  /** The item's newest revision was created at/after this moment. */
  updatedFrom?: Date;
  /** The item's newest revision was created at/before this moment. */
  updatedTo?: Date;
  /** The item has a revision with this exact version number. */
  versionNo?: number;
  limit?: number;
  offset?: number;
};

export type ContentBankRow = {
  key: string;
  module: string;
  contentType: string;
  sourceRef: string;
  title: string;
  track: string;
  versions: number;
  latestVersionNo: number;
  latestVersionId: string;
  /** The state of the newest revision — what the item is now. */
  latestState: PublicationState;
  /** How many revisions the item has in each state. */
  states: Record<PublicationState, number>;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Does any revision of this item carry `published`?
   *
   * Note what this is NOT: "the item is openable right now". A `scheduled` revision
   * opens only once its content row's `publish_at` passes, and that moment lives on the
   * content row, not on the revision — so the bank reports the revision states it can
   * prove and leaves openability to `listAssignableContent`, which asks the row.
   */
  hasPublishedRevision: boolean;
};

export type ContentBankFacet = { value: string; count: number };

export type ContentBankResult = {
  rows: ContentBankRow[];
  total: number;
  limit: number;
  offset: number;
  facets: {
    module: ContentBankFacet[];
    contentType: ContentBankFacet[];
    /** Facets over the item's present state. */
    state: ContentBankFacet[];
    track: ContentBankFacet[];
  };
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** Escape the LIKE metacharacters so a search for "50%" is a search for the text. */
const likeTerm = (value: string): string => `%${value.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;

export async function searchContentBank(
  filter: ContentBankFilter = {},
  executor: BankExecutor = db,
): Promise<ContentBankResult> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filter.offset ?? 0, 0);

  const where: ReturnType<typeof sql>[] = [notDeleted(sql`cv.id`)];
  if (filter.module) where.push(sql`cv.module = ${filter.module}`);
  if (filter.contentType) where.push(sql`cv.content_type = ${filter.contentType}`);
  if (filter.track) where.push(sql`cv.track = ${filter.track}`);
  if (filter.sourceRef) where.push(sql`cv.source_ref ilike ${likeTerm(filter.sourceRef)} escape '\\'`);
  if (filter.title) where.push(sql`cv.title ilike ${likeTerm(filter.title)} escape '\\'`);
  if (filter.q) {
    const term = likeTerm(filter.q);
    // Free text searches the IDENTITY and the title: a bank that only matched titles
    // would be unusable the moment two items share a name.
    where.push(sql`(cv.source_ref ilike ${term} escape '\\' or cv.title ilike ${term} escape '\\')`);
  }

  const having: ReturnType<typeof sql>[] = [sql`true`];
  if (filter.latestState) having.push(sql`(array_agg(cv.publication_state order by cv.version_no desc))[1] = ${filter.latestState}`);
  if (filter.hasState) having.push(sql`count(*) filter (where cv.publication_state = ${filter.hasState}) > 0`);
  if (filter.versionNo !== undefined) having.push(sql`count(*) filter (where cv.version_no = ${filter.versionNo}) > 0`);
  if (filter.updatedFrom) having.push(sql`max(cv.created_at) >= ${filter.updatedFrom}`);
  if (filter.updatedTo) having.push(sql`max(cv.created_at) <= ${filter.updatedTo}`);

  const whereSql = sql.join(where, sql` and `);
  const havingSql = sql.join(having, sql` and `);

  const rowsResult = await executor.execute(sql`
    select
      cv.module as module,
      cv.content_type as content_type,
      cv.source_ref as source_ref,
      (array_agg(cv.title order by cv.version_no desc))[1] as title,
      (array_agg(cv.track order by cv.version_no desc))[1] as track,
      count(*)::int as versions,
      max(cv.version_no)::int as latest_version_no,
      (array_agg(cv.id order by cv.version_no desc))[1] as latest_version_id,
      (array_agg(cv.publication_state order by cv.version_no desc))[1] as latest_state,
      count(*) filter (where cv.publication_state = 'draft')::int as draft_count,
      count(*) filter (where cv.publication_state = 'scheduled')::int as scheduled_count,
      count(*) filter (where cv.publication_state = 'published')::int as published_count,
      count(*) filter (where cv.publication_state = 'archived')::int as archived_count,
      count(*) filter (where cv.publication_state = 'published')::int as published_revision_count,
      min(cv.created_at) as created_at,
      max(cv.created_at) as updated_at
    from content_versions cv
    where ${whereSql}
    group by cv.module, cv.content_type, cv.source_ref
    having ${havingSql}
    order by max(cv.created_at) desc, cv.module, cv.content_type, cv.source_ref
    limit ${limit} offset ${offset}
  `);

  const totalResult = await executor.execute(sql`
    select count(*)::int as total from (
      select cv.module, cv.content_type, cv.source_ref
      from content_versions cv
      where ${whereSql}
      group by cv.module, cv.content_type, cv.source_ref
      having ${havingSql}
    ) as grouped
  `);

  const rows: ContentBankRow[] = (rowsResult.rows as Record<string, unknown>[]).map((row) => {
    const latestState = asString(row.latest_state) as PublicationState;
    return {
      key: `${asString(row.module)}:${asString(row.content_type)}|${asString(row.source_ref)}`,
      module: asString(row.module),
      contentType: asString(row.content_type),
      sourceRef: asString(row.source_ref),
      title: asString(row.title),
      track: asString(row.track),
      versions: Number(row.versions),
      latestVersionNo: Number(row.latest_version_no),
      latestVersionId: asString(row.latest_version_id),
      latestState,
      states: {
        draft: Number(row.draft_count),
        scheduled: Number(row.scheduled_count),
        published: Number(row.published_count),
        archived: Number(row.archived_count),
      },
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      hasPublishedRevision: Number(row.published_revision_count) > 0,
    };
  });

  const facetsResult = await executor.execute(sql`
    select module, content_type, latest_state, track, count(*)::int as count from (
      select
        cv.module as module,
        cv.content_type as content_type,
        cv.source_ref as source_ref,
        (array_agg(cv.track order by cv.version_no desc))[1] as track,
        (array_agg(cv.publication_state order by cv.version_no desc))[1] as latest_state
      from content_versions cv
      where ${whereSql}
      group by cv.module, cv.content_type, cv.source_ref
      having ${havingSql}
    ) as grouped
    group by module, content_type, latest_state, track
  `);

  // Facets are counted over the FILTERED bank, so they always describe what the caller
  // is actually looking at rather than the whole table.
  const tally = new Map<string, Map<string, number>>([
    ["module", new Map()],
    ["contentType", new Map()],
    ["state", new Map()],
    ["track", new Map()],
  ]);
  const bump = (facet: string, value: string, count: number) => {
    if (!value) return;
    const bucket = tally.get(facet)!;
    bucket.set(value, (bucket.get(value) ?? 0) + count);
  };
  for (const row of facetsResult.rows as Record<string, unknown>[]) {
    const count = Number(row.count);
    bump("module", asString(row.module), count);
    bump("contentType", `${asString(row.module)}:${asString(row.content_type)}`, count);
    bump("state", asString(row.latest_state), count);
    bump("track", asString(row.track), count);
  }
  const toFacets = (facet: string): ContentBankFacet[] =>
    [...tally.get(facet)!.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    rows,
    total: Number((totalResult.rows as { total?: number }[])[0]?.total ?? 0),
    limit,
    offset,
    facets: {
      module: toFacets("module"),
      contentType: toFacets("contentType"),
      state: toFacets("state"),
      track: toFacets("track"),
    },
  };
}

/**
 * The filter vocabulary a staff UI may offer: the registry's modules and content types,
 * the publication states, and the tracks actually present in the bank. Computed, not
 * hand-written, so a new content type appears in the filters the moment it is
 * registered.
 */
export async function contentBankVocabulary(executor: BankExecutor = db): Promise<{
  modules: { module: string; label: string; contentTypes: string[] }[];
  states: PublicationState[];
  tracks: string[];
}> {
  const tracksResult = await executor.execute(sql`select distinct track from content_versions order by track`);
  return {
    modules: [...new Set([...(["listening", "reading", "writing", "speaking", "grammar", "vocabulary", "ted", "lesson"] as const)])]
      .map((module) => moduleDescriptor(module))
      .filter((descriptor): descriptor is NonNullable<typeof descriptor> => Boolean(descriptor))
      .map((descriptor) => ({ module: descriptor.module, label: descriptor.label, contentTypes: [...descriptor.contentTypes] })),
    states: [...PUBLICATION_STATES],
    tracks: (tracksResult.rows as { track?: string }[]).map((row) => asString(row.track)).filter(Boolean),
  };
}
