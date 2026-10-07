import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productSql, type ListeningProductKind } from "@/lib/listening/product";

/**
 * The product ONE Listening test is, read from the database.
 *
 * The classifier itself lives in `src/lib/listening/product.ts` and is SHARED with the
 * catalogues (`academicProductSql` / `generalProductSql`) — this reader only runs it for a
 * single id, so a page or a route can ask "is this a standalone section or a full test?"
 * without hand-writing the decision a second time. Returns null when the row does not exist.
 */
export async function listeningProductOf(testId: string, database = db): Promise<ListeningProductKind | null> {
  const result = await database.execute<{ product: ListeningProductKind }>(sql`
    select ${productSql({
      testId: sql.raw("t.id"),
      payload: sql.raw("p.payload"),
      payloadIsNull: sql.raw("p.payload is null"),
    })} as product
    from listening_tests t
    left join listening_packages p on p.test_id = t.id
    where t.id = ${testId}
    limit 1
  `);
  return result.rows[0]?.product ?? null;
}
