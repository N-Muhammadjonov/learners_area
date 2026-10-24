import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read=(p: string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("campus map excludes reset button and preserves app search",()=>{
 const c=read("frontend/vanilla/modules/campus/page.js");
 const css=read("frontend/vanilla/css/campus.css");
 assert.ok(!c.includes("la-campus-reset"));
 assert.match(css,/data-global-search/);
});
test("campus geometry is integrated with real lights, shadows and local postprocessing",()=>{
 const g=read("public/campus/v2/src/campus-geometry.js");
 const s=read("public/campus/v2/src/campus-scene.js");
 assert.match(g,/asphaltGeo\.rotateX\(Math\.PI\s*\/\s*2\)/);
 assert.match(s,/finishArchitecture\(bldgGroup\)/);
 assert.match(s,/shadowMap\.enabled=true/);
 assert.match(s,/EffectComposer/);
 assert.match(s,/samples:Math\.min\(4,this\.renderer\.capabilities\.maxSamples\)/);
 assert.match(s,/EffectComposer\(this\.renderer,target\)/);
 assert.ok(!s.includes("https://esm.sh/"));
});
test("module badges keep their projection and respect foreground geometry instead of scattering",()=>{
 const code=read("public/campus/v2/src/campus-labels.js");
 assert.match(code,/intersectObject\(building,true\)/);
 assert.match(code,/point\.x\*\.5/);
 assert.ok(!code.includes("occupied.push"));
 assert.match(code,/visible\?'visible':'hidden'/);
});

test("native campus shell retains search, preferences, profile and utility controls without a sidebar",()=>{
 const header=read("frontend/vanilla/modules/shell/layout.js"),brand=read("frontend/vanilla/modules/campus/chrome.js");
 const css=read("frontend/vanilla/css/campus.css"),utilities=read("frontend/vanilla/js/generated/ShellUtilities.js");
 for(const name of ["globalSearch(context)","profileMenu(context)","controls(context)","notificationBell(context)","shellUtilities(context)"])assert.ok(header.includes(name));
 assert.match(brand,/brandBlock\('',36,true\)/);assert.match(brand,/back.hidden=campus/);
 assert.match(css,/flex-wrap:nowrap/);assert.match(css,/brand-tagline[^}]*color:#fff!important/);
 assert.ok(!header.includes("data-shell-sidebar"));assert.ok(!header.includes("data-mobile-nav-toggle"));
 for(const name of ["data-utilities-launcher","data-shell-utilities-panel","data-coach-fab","data-focus-toggle","ReportProblem"])assert.ok(utilities.includes(name));
});
