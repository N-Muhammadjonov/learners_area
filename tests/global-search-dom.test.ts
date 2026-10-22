import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";
test("global search keyboard, navigation and request recovery DOM regressions",()=>{
 const env:NodeJS.ProcessEnv={...process.env,NODE_OPTIONS:"",TSX_TSCONFIG_PATH:resolve("tests/ui/tsconfig.json")};delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,["--import","tsx","--test","tests/ui/global-search.test.tsx"],{env,encoding:"utf8",timeout:20000});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/tests 2/);
});
