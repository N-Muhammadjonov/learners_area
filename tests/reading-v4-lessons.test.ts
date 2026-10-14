import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(path,"utf8");
test("READ-LESSON uses the same generic Content OS and private notes, explicit area only", () => {
  const index = read("src/app/app/(shell)/reading/lessons/page.tsx");
  assert.match(index, /listLessonLibrary\(\{ area: "reading"/);
  assert.doesNotMatch(index, /lessons\/author/, "learner Lessons stays focused on learning");
  const author = read("src/app/app/(shell)/reading/lessons/author/page.tsx");
  assert.match(author, /requireStaff\(\)/);
  assert.match(author, /mayAuthorContent\(user\.role, "lesson", "lesson"\)/);
  const detail = read("src/app/app/(shell)/reading/lessons/[lessonId]/page.tsx");
  assert.match(detail, /loadLessonLibraryDetail\(lessonId, user.id, "reading"\)/);
  assert.match(detail, /\["description", "teacher-notes", "xulosangiz"\]/);
  assert.match(detail, /LessonNotesPanel/);
  assert.ok(detail.indexOf("<ListeningLessonBody") < detail.indexOf("role=\"tablist\""));
});
