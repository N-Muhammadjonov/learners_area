#!/usr/bin/env node
import pg from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrationChain, loadMigrationChain } from "./migration-chain.mjs";


// Keep pg's verified TLS defaults. Credentials never enter argv or output.
let client;
try {
  const chain = loadMigrationChain(join(dirname(fileURLToPath(import.meta.url)), "../drizzle"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  const applied = await applyMigrationChain(client, chain);
  console.log(JSON.stringify({ applied, count: applied.length }));
} catch (error) {
  console.error("Migration failed", /^migration_[a-z_]+$/.test(error.message) ? error.message : "database_operation_failed");
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
