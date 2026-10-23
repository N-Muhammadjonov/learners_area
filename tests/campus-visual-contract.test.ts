import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("campus map excludes reset button and preserves app search",()=>{
 const c=read("src/components/campus/CampusWorld.tsx");
 const css=read("src/components/campus/campus.css");
 assert.ok(!c.includes("la-campus-reset"));
 assert.match(css,/data-global-search/);
});
test("3D building proportions, LA floating elevation, asphalt alignment",()=>{
 const g=read("public/campus/v2/src/campus-geometry.js");
 const s=read("public/campus/v2/src/campus-scene.js");
 assert.match(g,/asphaltGeo\.rotateX\(Math\.PI\s*\/\s*2\)/);
 assert.match(g,/logoMesh\.position\.set\(0, 13\.3, 0\)/);
 assert.match(s,/bldgGroup\.scale\.set\(1\.32,1\.52,1\.32\)/);
});
test("module names remain reachable while camera orbits",()=>{
 const code=read("public/campus/v2/src/campus-labels.js");
 assert.match(code,/occupied\.push\(selected\.box\)/);
 assert.ok(!code.includes("visibility=clipped||colliding"));
 assert.match(code,/el\.style\.visibility='visible'/);
});
