import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read=(p: string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("campus map excludes reset button and preserves app search",()=>{
 const c=read("src/components/campus/CampusWorld.tsx");
 const css=read("src/components/campus/campus.css");
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
test("module names remain reachable while camera orbits",()=>{
 const code=read("public/campus/v2/src/campus-labels.js");
 assert.match(code,/occupied\.push\(selected\.box\)/);
 assert.ok(!code.includes("visibility=clipped||colliding"));
 assert.match(code,/el\.style\.visibility='visible'/);
});

test("campus retains the full header and bottom launcher for report, AI and Focus",()=>{
 const header=read("src/components/shell/Topbar.tsx"),brand=read("src/components/campus/CampusTopbarBrand.tsx");
 const layout=read("src/app/app/(shell)/layout.tsx"),utilities=read("src/components/shell/ShellUtilities.tsx");
 for(const name of ["CampusTopbarBrand","GlobalSearch","ThemeToggle","LocaleSwitcher","ProfileMenu"])assert.ok(header.includes(`<${name}`));
 assert.match(brand,/<BrandLogo/);assert.match(brand,/Take your learning journey with us/);
 assert.match(layout,/<Topbar/);assert.match(layout,/<ShellUtilities/);
 for(const name of ["data-utilities-launcher","data-shell-utilities-panel","data-coach-fab","data-focus-toggle","ReportProblem"])assert.ok(utilities.includes(name));
 assert.match(utilities,/fixed bottom-4 right-4 flex flex-col/);
 assert.ok(utilities.indexOf('id="shell-utilities-panel"')<utilities.indexOf('data-utilities-launcher'));
});
