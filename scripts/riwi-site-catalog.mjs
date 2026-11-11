/** Refresh the code-derived route inventory. Production only validates this snapshot; no Node build dependency. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import routes from '../frontend/vanilla/js/routes.js';
import reviewed from '../frontend/vanilla/js/generated/view-registry.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const staff=fs.readFileSync(path.join(root,'frontend/vanilla/modules/staff-final30/routes.js'),'utf8');
const rows=routes.map(r=>{
 const staffModule=staff.match(new RegExp("pattern:'"+r.pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"'.*?load:t\\('([^']+)'"))?.[1];
 const module=staffModule?'modules/staff-final30/'+staffModule+'.js':r.load.toString().match(/import\(['"]\.\.\/([^'"]+)['"]\)/)?.[1]??null;
 const roles=r.roles??reviewed.find(x=>x.path===r.pattern)?.roles??
   (r.pattern.startsWith('/app/owner')?['owner']:
    r.pattern.startsWith('/app/admin')||r.pattern==='/app/listening/import'?['admin','owner']:
    r.pattern.startsWith('/app/teacher')||r.pattern==='/app/management'||r.pattern.endsWith('/lessons/author')?['teacher','admin','owner']:
    ['student','teacher','admin','owner']);
 return {path:r.pattern,roles,module,focus:r.layout==='focus',redirect:!!r.redirectOnly};
});
const sources={};
function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
 const name=dir+'/'+entry.name;
 if(entry.isDirectory()){if(!['vendor','build','node_modules'].includes(entry.name))walk(name);}
 else if(/\.(js|css)$/.test(name))sources[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
}}
for(const dir of ['frontend/vanilla/js','frontend/vanilla/modules','frontend/vanilla/css'])walk(dir);
for(const file of ['browser_staff.py','browser_authoring.py','admin_authoring_port.py','riwi_capabilities.py','riwi_site.py']){
 const name='services/backend/app/'+file;sources[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
}
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--output' || !args[1])){
 throw new Error('Usage: node scripts/riwi-site-catalog.mjs [--output path]');
}
const target=args.length?path.resolve(args[1]):path.join(root,'services/backend/app/data/riwi_site_catalog.json');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,JSON.stringify({version:1,routes:rows,sources},null,2)+'\n');
console.log(JSON.stringify({routes:rows.length,sources:Object.keys(sources).length}));
