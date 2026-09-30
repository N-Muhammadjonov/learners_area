import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";
import { registerSchema } from "../src/lib/validation/auth";
import { updateProfileNameSchema } from "../src/lib/validation/profile";
import { buildPeopleCountQuery, buildPeopleListQuery } from "../src/lib/data/people";

const root = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Management People search is parameterized in SQL before a fixed, deterministic page limit", () => {
  const filters = { q: "Ada 100%_\\", role: "teacher" as const, status: "active" as const };
  const page = buildPeopleListQuery(filters, 2).toSQL();
  const count = buildPeopleCountQuery(filters).toSQL();

  assert.match(page.sql, /where \("users"\."role" = \$\d+ and "users"\."account_status" = \$\d+ and \("users"\."name" ilike \$\d+ or "users"\."email" ilike \$\d+\)\)/);
  assert.ok(page.sql.indexOf(" where ") < page.sql.indexOf(" limit "));
  assert.match(page.sql, /order by "users"\."created_at" desc, "users"\."id" desc limit \$\d+ offset \$\d+$/);
  assert.deepEqual(page.params, ["teacher", "active", "%Ada 100\\%\\_\\\\%", "%Ada 100\\%\\_\\\\%", 25, 25]);
  assert.match(count.sql, /count\(\*\)::int from "users" where/);
  assert.doesNotMatch(count.sql, / limit | offset /);
  assert.equal(count.params.length, 4);

  const directory = read("src/app/(app)/admin/people/page.tsx");
  const table = read("src/components/admin/PeopleTable.tsx");
  assert.match(directory, /role: isRole\(rawRole\)[\s\S]*status: isAccountStatus\(rawStatus\)[\s\S]*page: pageNumber/);
  assert.match(table, /action="\/admin\/people" method="get"/);
  assert.match(table, /peoplePageHref\(filters, page [+-] 1\)/);
  assert.match(table, /router\.refresh\(\)/);
  assert.match(table, /\/api\/admin\/users\/\$\{person\.id\}\/role/);
  assert.match(table, /\/api\/admin\/users\/\$\{person\.id\}\/status/);
});

test("profile self-edit accepts only a validated display name and binds it to the session user", () => {
  assert.deepEqual(updateProfileNameSchema.parse({ name: "  Ada Learner  " }), { name: "Ada Learner" });
  assert.equal(updateProfileNameSchema.safeParse({ name: "A" }).success, false);
  assert.equal(updateProfileNameSchema.safeParse({ name: "Ada", email: "attacker@example.test" }).success, false);
  assert.equal(updateProfileNameSchema.safeParse({ name: "Ada", role: "owner" }).success, false);

  const route = read("src/app/api/profile/route.ts");
  const menu = read("src/components/shell/ProfileMenu.tsx");
  assert.match(route, /requireActiveUser\(\)/);
  assert.match(route, /\.set\(\{ name: parsed\.data\.name \}\)/);
  assert.match(route, /eq\(users\.id, user\.id\)/);
  assert.doesNotMatch(route, /\.set\(\{[^}]*\b(email|role|accountStatus|isOwner|gender):/);
  assert.match(menu, /href="\/profile"/);
});

test("registration declares and persists a canonical gender while keeping legacy and provider users nullable", () => {
  const identity = { name: "Ada Learner", email: "ada@example.test", password: "password-123" };
  assert.equal(registerSchema.safeParse(identity).success, false);
  assert.equal(registerSchema.safeParse({ ...identity, gender: "male" }).success, true);
  assert.equal(registerSchema.safeParse({ ...identity, gender: "female" }).success, true);
  assert.equal(registerSchema.safeParse({ ...identity, gender: "other" }).success, false);

  const schema = read("src/db/schema.ts");
  const register = read("src/app/api/auth/register/route.ts");
  const registerForm = read("src/components/auth/RegisterForm.tsx");
  const telegram = read("src/app/api/auth/telegram/callback/route.ts");
  const migration = read("drizzle/0021_registration_gender.sql");
  assert.match(schema, /gender: genderEnum\("gender"\),/);
  assert.doesNotMatch(registerForm, /<select/);
  assert.match(registerForm, /type="radio"[\s\S]*name="gender"[\s\S]*required/);
  assert.match(registerForm, /body: \{ name, email, password, gender \}/);
  assert.match(register, /\.values\(\{ name, gender, email, passwordHash/);
  assert.equal(en.auth.gender, "Gender");
  assert.equal(uz.auth.gender, "Jins");
  assert.equal(en.auth.genderMale, "Male");
  assert.equal(uz.auth.genderFemale, "Ayol");
  assert.match(telegram, /\.values\(\{ name, telegramId, role: "student"/);
  assert.doesNotMatch(telegram, /gender:/);
  assert.match(migration, /CREATE TYPE .*gender.*'male', 'female'/i);
  assert.match(migration, /ALTER TABLE "users" ADD COLUMN "gender" "gender"/);
  assert.doesNotMatch(migration, /NOT NULL/i);
});

test("reset request and confirmation both retain a localized route back to login", () => {
  for (const path of ["src/components/auth/ResetRequestForm.tsx", "src/components/auth/ResetConfirmForm.tsx"]) {
    const form = read(path);
    assert.match(form, /href="\/login"/);
    assert.match(form, /dict\.auth\.loginCta/);
  }
});

test("floating AI Coach action opens the existing Coach dashboard without an invented chat", () => {
  const utilities = read("src/components/shell/ShellUtilities.tsx");
  assert.match(utilities, /href="\/coach"/);
  assert.match(utilities, /data-coach-fab/);
  assert.match(utilities, /IconSparkles/);
  assert.match(utilities, /dict\.nav\.coach/);
  assert.ok(read("src/app/(app)/coach/page.tsx").includes("CoachPage"));
});

test("TED / PODCAST is the complete learner-facing section identity in both locales", () => {
  // PART 1 FINAL RETENTION ARCHITECTURE OVERRIDE V2 supersedes the old Reading-hub
  // videos tab: TED / PODCAST is a standalone section in the shell navigation and
  // must NOT appear as a tab inside Reading. The identity assertions below stay
  // exactly as they were for the section itself; the Reading-tab assertions are
  // replaced by the assertion that the tab is gone, rather than deleted.
  assert.equal(en.nav.videoLessons, "TED / PODCAST");
  assert.equal(uz.nav.videoLessons, "TED / PODCAST");
  assert.equal(en.videoLessons.title, "TED / PODCAST");
  assert.equal(uz.videoLessons.title, "TED / PODCAST");

  const hub = read("src/app/(app)/reading/page.tsx");
  assert.doesNotMatch(hub, /data-reading-videos/);
  assert.doesNotMatch(hub, /tabVideos|videosGoToLibrary|videosEmptyHint/);
  assert.equal(
    Object.keys(en.readingHub).some((key) => key.toLowerCase().includes("video")),
    false,
    "the Reading hub dictionary must not ship a videos tab identity any more"
  );
  assert.equal(
    Object.keys(uz.readingHub).some((key) => key.toLowerCase().includes("video")),
    false,
    "the Reading hub dictionary must not ship a videos tab identity any more"
  );
});
