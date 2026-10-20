import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const read=(p:string)=>readFileSync(p,"utf8");
test("Academic, General and resumed attempts own a protected focus route with no ordinary shell or Back chrome",()=>{
  for(const page of ["academic/[setId]","general/[setId]","attempts/[id]"]) {
    const path=`src/app/app/(focus)/reading/${page}/page.tsx`;
    assert.ok(existsSync(path));assert.ok(!existsSync(`src/app/app/(shell)/reading/${page}/page.tsx`));
    assert.match(read(path),/requireActiveUser/);assert.doesNotMatch(read(path),/<BackLink/);
  }
  const layout=read("src/app/app/(focus)/reading/layout.tsx");assert.match(layout,/data-reading-full-focus/);assert.doesNotMatch(layout,/Sidebar|Topbar|ModuleNavigation/);
  assert.match(read("src/app/app/(focus)/layout.tsx"),/getCurrentUser/);
});
test("section headers live above tabs and redundant catalogue actions are absent",()=>{
  const layout=read("src/app/app/(shell)/reading/layout.tsx");assert.doesNotMatch(layout,/<ReadingSectionHeading|<ModuleNavigation/);
  assert.match(read("src/components/shell/Topbar.tsx"),/<ModuleHeaderNavigation dict=\{dict\}/);
  assert.doesNotMatch(read("src/components/reading/GeneralReadingSession.tsx"),/ReadAloud/);
  for(const page of ["lessons","academic","general","question-types"])assert.doesNotMatch(read(`src/app/app/(shell)/reading/${page}/page.tsx`),/<BackLink|dict.common.back|<h1/);
  assert.doesNotMatch(read("src/app/app/(shell)/reading/lessons/page.tsx"),/data-reading-history-entry|lessons\/author/);
  assert.doesNotMatch(read("src/app/app/(shell)/reading/retention/page.tsx"),/href="\/app\/reading"/);
  const general=read("src/app/app/(shell)/reading/general/page.tsx");assert.match(general,/<ReadingLearningLibrary/);assert.doesNotMatch(general,/GeneralReadingSets|listGeneralSets/);
});
test("the CD workspace constrains scrolling to its two panes and keeps navigation/submission visible",()=>{
  const css=read("src/app/app/(focus)/reading/reading-workspace.css");
  assert.match(css,/grid-template-rows: auto minmax\(0,1fr\) auto/);assert.match(css,/overscroll-behavior: contain/);assert.match(css,/min-width: 15ch/);
  const exam=read("src/components/reading/ReadingExam.tsx");assert.doesNotMatch(exam,/data-practice-exit|t.exit|IconBack/);assert.match(exam,/data-submit-attempt/);assert.match(exam,/data-reading-question-nav/);
});
