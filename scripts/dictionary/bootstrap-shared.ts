#!/usr/bin/env node
/**
 * Guarded Preview Dictionary bootstrap.
 *
 * This runner is deliberately separate from scripts/dictionary/bootstrap.ts.
 * The local bootstrap refuses non-local databases; this file is the explicit,
 * owner-gated shared-Preview path.
 *
 * Usage:
 *   DATABASE_URL=... \
 *   PREVIEW_QA_DB_FINGERPRINT=... \
 *   PREVIEW_QA_PROJECT_REF=... \
 *   PREVIEW_QA_SERVER_IDENTITY=... \
 *   node --conditions=react-server --import tsx scripts/dictionary/bootstrap-shared.ts --plan <verified nested.json.gz>
 *
 * Apply additionally requires:
 *   PREVIEW_QA_BACKUP_REF=<fresh recovery point>
 *   PREVIEW_DICTIONARY_BOOTSTRAP_APPROVAL=<BASE_RELEASE>
 *
 * No Production path is supported.
 * Connection URLs/passwords are never written to receipts.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import {
  BASE_RELEASE,
  entrySchema,
  sha,
  stableJson,
  type Entry,
} from "../../src/lib/dictionary/model";
import {
  releaseManifest,
  rows,
  writeEntries,
  writeTerms,
} from "../../src/lib/dictionary/store";
import { senseKeyOf } from "../../src/lib/services/vocabulary/dedupe";
import {
  fingerprint,
  qaConnectionOptions,
  readServerIdentity,
  refuseProduction,
  serverIdentityHash,
  urlIdentity,
} from "../preview-qa-migrate.mjs";

const EXPECTED = {
  sourceCommit: "594c00904e07702c27329f1c0ce9ec6dadee1adb",
  compressedSha256: "ae4130d6b7d9ad1d5a65cb4f56944735e497e9754fd53c6a387097c7aaff650c",
  rawSha256: "dcea1e0304131413069986b6f096e71ab92070ce6a1c27b77410e82294fd602c",
  lexemes: 62_376,
  senses: 105_488,
  examples: 81_099,
  searchTerms: 1_201_156,
  senseSetSha256: "832090bb4bda84901f94ddcc5a8c95e368606f3be35d9912bc68dddca5d42766",
  exampleSetSha256: "dbd1773b0b6db7221cbce5674f4f8c3ed3a0a721daaaf52b5c9cc665386c9595",
} as const;

const checksum = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");

type Receipt = {
  at: string;
  mode: "--plan" | "--apply";
  releaseId: string;
  sourceCommit: string;
  sourceCompressedSha256: string;
  dbFingerprint?: string;
  serverIdentity?: string;
  target?: {
    host: string;
    port: string;
    database: string;
    role: string;
    projectRef: string | null;
    sharedPooler: boolean;
  };
  backupRef?: string;
  source?: {
    lexemes: number;
    senses: number;
    examples: number;
  };
  before?: {
    releaseState: string | null;
    activeReleaseId: string | null;
    dictionaryTables: number;
    readingTables: number;
  };
  result?: {
    pass: boolean;
    planned?: boolean;
    applied?: boolean;
    baseAlreadyValidated?: boolean;
    mapped?: number;
    unmapped?: number;
    ambiguities?: number;
    manifest?: unknown;
  };
  refused?: string;
};

function safeErrorCode(error: unknown) {
  const raw = String((error as { code?: unknown })?.code ?? "");
  return /^[A-Z0-9_]+$/.test(raw) ? raw : "DICTIONARY_BOOTSTRAP_FAILED";
}

function validateSource(file: string) {
  const compressed = readFileSync(file);
  if (checksum(compressed) !== EXPECTED.compressedSha256)
    throw new Error("source_checksum_mismatch");
  const raw = gunzipSync(compressed);
  if (checksum(raw) !== EXPECTED.rawSha256)
    throw new Error("source_checksum_mismatch");
  const source = JSON.parse(raw.toString()) as {
    entries: Entry[];
    release_id: string;
    published_entries: number;
    published_senses: number;
    published_examples: number;
  };
  if (
    source.release_id !== BASE_RELEASE ||
    source.entries.length !== EXPECTED.lexemes ||
    source.published_entries !== EXPECTED.lexemes ||
    source.published_senses !== EXPECTED.senses ||
    source.published_examples !== EXPECTED.examples
  )
    throw new Error("source_counts_mismatch");
  for (const entry of source.entries) entrySchema.parse(entry);
  return source;
}

function identityProblems(url: string, env: NodeJS.ProcessEnv) {
  const problems: string[] = [];
  const id = urlIdentity(url);
  if (!env.PREVIEW_QA_DB_FINGERPRINT)
    problems.push("PREVIEW_QA_DB_FINGERPRINT is not set");
  else if (env.PREVIEW_QA_DB_FINGERPRINT !== fingerprint(url))
    problems.push("DATABASE_URL is not the approved Preview QA database");
  if (id.sharedPooler) {
    if (!env.PREVIEW_QA_PROJECT_REF)
      problems.push("PREVIEW_QA_PROJECT_REF is required for a shared pooler");
    else if (
      !id.projectRef ||
      id.projectRef !== env.PREVIEW_QA_PROJECT_REF.toLowerCase()
    )
      problems.push("DATABASE_URL project ref does not match PREVIEW_QA_PROJECT_REF");
  }
  if (!env.PREVIEW_QA_SERVER_IDENTITY)
    problems.push("PREVIEW_QA_SERVER_IDENTITY is not set");
  return problems;
}

async function readPreviewState(client: pg.PoolClient) {
  const dictTables = Number(
    (
      await client.query(
        "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('dictionary_releases','dictionary_channels','dictionary_entries','dictionary_search_terms','dictionary_sense_mappings','dictionary_recent_searches','dictionary_drafts','dictionary_owner_events','dictionary_publish_jobs')",
      )
    ).rows[0]?.n ?? 0,
  );
  const readingTables = Number(
    (
      await client.query(
        "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('reading_assessments','reading_assessment_passages')",
      )
    ).rows[0]?.n ?? 0,
  );
  if (dictTables !== 9 || readingTables !== 2)
    throw new Error("required_0038_0039_schema_missing");
  const release = (
    await client.query("select state from dictionary_releases where id=$1", [
      BASE_RELEASE,
    ])
  ).rows[0] as { state?: string } | undefined;
  const channel = (
    await client.query(
      "select active_release_id from dictionary_channels where name='stable'",
    )
  ).rows[0] as { active_release_id?: string } | undefined;
  return {
    releaseState: release?.state ?? null,
    activeReleaseId: channel?.active_release_id ?? null,
    dictionaryTables: dictTables,
    readingTables,
  };
}

async function verifyValidatedRelease(database: NodePgDatabase<typeof schema>) {
  const manifest = await releaseManifest(BASE_RELEASE, database);
  if (
    manifest.lexemes !== EXPECTED.lexemes ||
    manifest.senses !== EXPECTED.senses ||
    manifest.examples !== EXPECTED.examples ||
    manifest.search_terms !== EXPECTED.searchTerms ||
    manifest.sense_set_sha256 !== EXPECTED.senseSetSha256 ||
    manifest.example_set_sha256 !== EXPECTED.exampleSetSha256
  )
    throw new Error("validated_manifest_mismatch");
  const current = await rows<{
    state: string;
    manifest: unknown;
    manifest_sha: string;
  }>(
    sql`select state,manifest,manifest_sha from dictionary_releases where id=${BASE_RELEASE}`,
    database,
  );
  if (
    current[0]?.state !== "validated" ||
    stableJson(current[0]?.manifest) !== stableJson(manifest) ||
    current[0]?.manifest_sha !== sha(stableJson(manifest))
  )
    throw new Error("validated_base_manifest_mismatch");
  const stable = await rows<{ active_release_id: string }>(
    sql`select active_release_id from dictionary_channels where name='stable'`,
    database,
  );
  if (stable[0]?.active_release_id !== BASE_RELEASE)
    throw new Error("stable_channel_not_base_release");
  return manifest;
}

async function applyBootstrap(
  source: ReturnType<typeof validateSource>,
  database: NodePgDatabase<typeof schema>,
) {
  const present = await rows<{ state: string }>(
    sql`select state from dictionary_releases where id=${BASE_RELEASE}`,
    database,
  );
  if (present[0]?.state === "validated") {
    return {
      baseAlreadyValidated: true,
      manifest: await verifyValidatedRelease(database),
      mapped: 0,
      unmapped: 0,
      ambiguities: 0,
    };
  }
  if (present[0]?.state === "failed")
    throw new Error("release_failed_requires_operator_review");

  const stable = await rows<{ active_release_id: string }>(
    sql`select active_release_id from dictionary_channels where name='stable'`,
    database,
  );
  if (stable[0]?.active_release_id && stable[0].active_release_id !== BASE_RELEASE)
    throw new Error("stable_channel_conflict");

  await database.execute(
    sql`insert into dictionary_releases(id,state) values(${BASE_RELEASE},'building') on conflict do nothing`,
  );

  for (let at = 0; at < source.entries.length; at += 200) {
    const chunk = source.entries.slice(at, at + 200);
    await database.transaction(async (tx) => {
      await writeEntries(chunk, tx);
      await writeTerms(chunk, tx);
    });
    if (at % 5000 === 0)
      console.log(JSON.stringify({ event: "dictionary_bootstrap_progress", indexed: at }));
  }

  const manifest = await releaseManifest(BASE_RELEASE, database);
  if (
    manifest.lexemes !== EXPECTED.lexemes ||
    manifest.senses !== EXPECTED.senses ||
    manifest.examples !== EXPECTED.examples ||
    manifest.search_terms !== EXPECTED.searchTerms ||
    manifest.sense_set_sha256 !== EXPECTED.senseSetSha256 ||
    manifest.example_set_sha256 !== EXPECTED.exampleSetSha256
  )
    throw new Error("materialized_manifest_mismatch");

  const appRows = await rows<{
    id: string;
    term: string;
    part_of_speech: string | null;
    definition_en: string;
    lexical_unit_id: string | null;
  }>(
    sql`select id,term,part_of_speech,definition_en,lexical_unit_id from lexemes`,
    database,
  );

  const byIdentity = new Map<string, { entry: Entry; senseId: string }[]>();
  for (const entry of source.entries) {
    for (const sense of entry.senses) {
      const pos =
        ({ n: "noun", v: "verb", a: "adjective", r: "adverb" } as Record<
          string,
          string
        >)[entry.part_of_speech] ?? entry.part_of_speech;
      const key = senseKeyOf({
        term: entry.display_lemma,
        partOfSpeech: pos,
        meaning: sense.definition_en,
      });
      const existing = byIdentity.get(key) ?? [];
      existing.push({ entry, senseId: sense.sense_id });
      byIdentity.set(key, existing);
    }
  }

  const appByIdentity = new Map<string, typeof appRows>();
  for (const row of appRows) {
    const key = senseKeyOf({
      term: row.term,
      partOfSpeech: row.part_of_speech,
      meaning: row.definition_en,
    });
    const existing = appByIdentity.get(key) ?? [];
    existing.push(row);
    appByIdentity.set(key, existing);
  }

  let mapped = 0;
  let unmapped = 0;
  let ambiguityCount = 0;

  for (const row of appRows) {
    const key = senseKeyOf({
      term: row.term,
      partOfSpeech: row.part_of_speech,
      meaning: row.definition_en,
    });
    const candidates = byIdentity.get(key) ?? [];
    if (candidates.length !== 1) {
      if (candidates.length) ambiguityCount++;
      else unmapped++;
      continue;
    }
    const duplicates = appByIdentity.get(key) ?? [];
    if (duplicates.length !== 1) {
      ambiguityCount++;
      continue;
    }
    const target = candidates[0]!;
    await database.execute(sql`
      insert into dictionary_sense_mappings(
        sense_id,app_sense_id,app_unit_id,mapping_method
      ) values(
        ${target.senseId}::uuid,
        ${row.id}::uuid,
        ${row.lexical_unit_id}::uuid,
        'exact_identity'
      ) on conflict do nothing
    `);
    mapped++;
  }

  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    await tx.execute(sql`
      update dictionary_releases
      set state='validated',
          manifest=${JSON.stringify(manifest)}::jsonb,
          manifest_sha=${sha(stableJson(manifest))},
          validated_at=now()
      where id=${BASE_RELEASE} and state='building'
    `);
    await tx.execute(sql`
      insert into dictionary_channels(name,active_release_id)
      values('stable',${BASE_RELEASE})
      on conflict(name) do nothing
    `);
  });

  await verifyValidatedRelease(database);

  return {
    baseAlreadyValidated: false,
    manifest,
    mapped,
    unmapped,
    ambiguities: ambiguityCount,
  };
}

async function main() {
  const mode = process.argv[2] as "--plan" | "--apply" | undefined;
  const file = process.argv[3];
  if (!mode || !["--plan", "--apply"].includes(mode) || !file)
    throw new Error(
      "Usage: bootstrap-shared.ts --plan|--apply <verified nested.json.gz>",
    );

  const receipt: Receipt = {
    at: new Date().toISOString(),
    mode,
    releaseId: BASE_RELEASE,
    sourceCommit: EXPECTED.sourceCommit,
    sourceCompressedSha256: EXPECTED.compressedSha256,
  };

  const url = process.env.DATABASE_URL;
  if (!url) {
    receipt.refused = "DATABASE_URL is required";
    return finish(receipt, 1);
  }
  const productionMarker = refuseProduction(url, process.env);
  if (productionMarker) {
    receipt.refused = `refused: ${productionMarker}`;
    return finish(receipt, 1);
  }
  const problems = identityProblems(url, process.env);
  if (problems.length) {
    receipt.refused = `refused: ${problems.join("; ")}`;
    return finish(receipt, 1);
  }

  if (mode === "--apply") {
    if (!process.env.PREVIEW_QA_BACKUP_REF) {
      receipt.refused = "refused: PREVIEW_QA_BACKUP_REF is required";
      return finish(receipt, 1);
    }
    if (process.env.PREVIEW_DICTIONARY_BOOTSTRAP_APPROVAL !== BASE_RELEASE) {
      receipt.refused =
        "refused: PREVIEW_DICTIONARY_BOOTSTRAP_APPROVAL must equal BASE_RELEASE";
      return finish(receipt, 1);
    }
    receipt.backupRef = process.env.PREVIEW_QA_BACKUP_REF;
  }

  const source = validateSource(file);
  receipt.source = {
    lexemes: source.entries.length,
    senses: source.published_senses,
    examples: source.published_examples,
  };

  const id = urlIdentity(url);
  receipt.dbFingerprint = fingerprint(url);
  receipt.target = {
    host: id.host,
    port: id.port,
    database: id.database,
    role: id.role,
    projectRef: id.projectRef,
    sharedPooler: id.sharedPooler,
  };

  const Client = pg.Client;
  const identityClient = new Client(qaConnectionOptions(url));
  await identityClient.connect();
  try {
    const server = await readServerIdentity(identityClient);
    receipt.serverIdentity = serverIdentityHash(server);
    if (receipt.serverIdentity !== process.env.PREVIEW_QA_SERVER_IDENTITY) {
      receipt.refused = "refused: server identity mismatch";
      return finish(receipt, 1);
    }
    if (server.db !== id.database) {
      receipt.refused = "refused: server reports a different database";
      return finish(receipt, 1);
    }
  } finally {
    await identityClient.end().catch(() => {});
  }

  const Pool = pg.Pool;
  const pool = new Pool({
    ...qaConnectionOptions(url),
    max: 1,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  const database = drizzle(pool, { schema });
  const client = await pool.connect();
  try {
    receipt.before = await readPreviewState(client);
  } finally {
    client.release();
  }

  try {
    if (receipt.before.releaseState === "validated") {
      const manifest = await verifyValidatedRelease(database);
      receipt.result = {
        pass: true,
        planned: mode === "--plan",
        applied: false,
        baseAlreadyValidated: true,
        manifest,
      };
      return finish(receipt, 0);
    }

    if (mode === "--plan") {
      receipt.result = {
        pass: true,
        planned: true,
        applied: false,
        baseAlreadyValidated: false,
      };
      return finish(receipt, 0);
    }

    const applied = await applyBootstrap(source, database);
    receipt.result = {
      pass: true,
      applied: true,
      ...applied,
    };
    return finish(receipt, 0);
  } catch (error) {
    receipt.refused = `database operation failed: ${safeErrorCode(error)}; inspect current state before retrying`;
    return finish(receipt, 1);
  } finally {
    await pool.end().catch(() => {});
  }
}

function finish(receipt: Receipt, code: number) {
  mkdirSync("docs/receipts", { recursive: true });
  const file = `docs/receipts/dictionary-bootstrap-preview-${receipt.at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
  console.log(`receipt: ${file}`);
  process.exitCode = code;
}

main().catch((error) => {
  const code = safeErrorCode(error);
  console.error(`dictionary bootstrap failed: ${code}`);
  process.exitCode = 1;
});
