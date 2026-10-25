import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema";
import { FrontendReadClient } from "@/lib/backend/read-client";

// Typed selectors support the existing server-rendered views. FastAPI executes
// them inside a read-only transaction. API writes never use this adapter.
export const db = drizzle(new FrontendReadClient() as unknown as Pool, { schema });

export const FRONTEND_DATABASE = true;
