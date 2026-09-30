import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecentAwardsQuery,
  buildStandingQueries,
} from "../src/lib/services/vocabulary/engine";

const qaUserId = "00000000-0000-0000-0000-000000000001";

test("Drizzle compiles the effective-score CTE for standing, streak, and awards", () => {
  // Calling toSQL() deliberately exercises Drizzle's CTE field selection without
  // opening a database connection. A missing .as() on a raw SQL projection used
  // to throw here before any PostgreSQL query could run.
  const standing = buildStandingQueries(qaUserId);
  const standingSql = standing.totals().toSQL();
  const streakSql = standing.streakDays().toSQL();
  const awardsSql = buildRecentAwardsQuery(qaUserId).toSQL();

  for (const query of [standingSql, streakSql, awardsSql]) {
    assert.match(query.sql, /with "effective_vocab_point_rows" as/);
    assert.match(query.sql, /END::int as "effective_points"/);
    assert.match(query.sql, /row_number\(\) OVER/);
    assert.match(query.sql, /AT TIME ZONE \$\d+::text/);
  }

  assert.match(standingSql.sql, /"users"\."role" = \$\d+/);
  assert.match(standingSql.sql, /having sum\("effective_points"\) > 0/);
  assert.match(standingSql.sql, /order by sum\("effective_points"\) desc, "users"\."name" asc, "effective_vocab_point_rows"\."user_id" asc/);
  assert.match(streakSql.sql, /"user_id" = \$\d+[\s\S]*?"effective_points" > \$\d+/);
  assert.match(awardsSql.sql, /"user_id" = \$\d+[\s\S]*?"effective_points" > \$\d+/);
  assert.match(awardsSql.sql, /limit \$\d+/);
});
