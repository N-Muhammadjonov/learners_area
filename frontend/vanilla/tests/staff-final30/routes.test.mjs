import {test} from 'node:test';import assert from 'node:assert/strict';
import routes from '../../modules/staff-final30/routes.js';
import existing from '../../js/routes.js';
import {compilePattern} from '../../js/router.js';
test('every FINAL30 route loads a module exporting mount() and targets a pattern owned by the 38-route scope',async()=>{
 const scope=new Set((await import('node:fs')).readFileSync(new URL('../../docs/final30/FINAL30_SCOPE_ROUTES.txt',import.meta.url),'utf8').split('\n').filter(Boolean));assert.equal(scope.size,38);
 const added=routes.map(r=>r.pattern).filter(p=>!scope.has(p)).sort();
 assert.deepEqual(added,['/app/admin/statistics','/app/management','/app/management/study-plans']);
 assert.equal(routes.filter(r=>scope.has(r.pattern)).length,35);
 for(const r of routes){const m=await r.load();assert.equal(typeof m.mount,'function',r.pattern);}
});
test('patterns are unique, match their own example path, and exist in the V4 route table (so they replace, never add)',()=>{
 assert.equal(new Set(routes.map(r=>r.pattern)).size,routes.length);
 for(const r of routes){assert(existing.some(e=>e.pattern===r.pattern),'missing in V4 routes: '+r.pattern);const ex=r.pattern.replace(/:\w+/g,'00000000-0000-4000-8000-000000000001');assert(compilePattern(r.pattern).test(ex));}
});
test('no staff module touches browser storage, innerHTML, eval or dangerous URL schemes',async()=>{
 const fs=await import('node:fs'),path=await import('node:path');const dirs=['modules/staff-final30','js/adapters/staff-final30'].map(d=>new URL('../../'+d+'/',import.meta.url).pathname);
 for(const d of dirs)for(const f of fs.readdirSync(d)){const s=fs.readFileSync(path.join(d,f),'utf8');for(const bad of [/localStorage|sessionStorage|indexedDB/,/\.innerHTML\s*=/,/insertAdjacentHTML/,/\beval\(/,/new Function\(/,/document\.write/,/dangerouslySetInnerHTML/])assert(!bad.test(s),`${f} matches ${bad}`);}
});
