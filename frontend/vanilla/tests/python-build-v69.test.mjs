import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import routes from '../js/routes.js';
import {legacyModuleRedirects,appLegacyAliasRedirects} from '../js/private-modules.js';
const catalogue=JSON.parse(fs.readFileSync(new URL('../routes.json',import.meta.url)));
test('Python static route catalogue retains every current browser route and historical redirect',()=>{
 const patterns=routes.map(({pattern})=>pattern.split('/').map(part=>part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/'));
 assert.deepEqual(catalogue.routes,patterns);assert.deepEqual(catalogue.redirects,[...legacyModuleRedirects(),...appLegacyAliasRedirects(),{source:'/app/courses',destination:'/app/courses/ielts'}]);
});
