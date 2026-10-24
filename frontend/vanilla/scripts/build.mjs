import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=path.resolve(import.meta.dirname,'..');
// Generated presentation modules are reviewed runtime inputs. Refreshing them
// from a different Next tree is a separate maintenance operation, never a build.
for(const required of ['index.html','js/main.js','js/generated/view-registry.js','tailwind.source.mjs'])
 if(!fs.existsSync(path.join(base,required)))throw Error('Missing frontend input: '+required);
const modules=await import(pathToFileURL(path.join(base,'js/routes.js')));
const legacy=await import(pathToFileURL(path.join(base,'js/private-modules.js')));
const patterns=modules.default.map(({pattern})=>pattern.split('/').map(part=>part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/'));
fs.writeFileSync(path.join(base,'tailwind.config.mjs'),`import source from './tailwind.source.mjs';\nexport default {...source,content:['./index.html','./js/**/*.js','./modules/**/*.js','./css/source.css']};\n`);
execFileSync(process.execPath,[path.join(base,'node_modules/tailwindcss/lib/cli.js'),'-c','tailwind.config.mjs','-i','css/source.css','-o','css/global.css','--minify'],{cwd:base,stdio:'inherit'});
const target=path.join(base,'build'),temporary=path.join(base,'.build-'+process.pid);
fs.rmSync(temporary,{recursive:true,force:true});fs.mkdirSync(temporary);
const allowed=['index.html','js','modules','css/global.css','css/fonts.css','css/campus.css','fonts','brand','images','campus'];
for(const name of allowed){const from=path.join(base,name),to=path.join(temporary,name);if(!fs.existsSync(from))continue;fs.mkdirSync(path.dirname(to),{recursive:true});fs.cpSync(from,to,{recursive:true,filter:p=>!fs.lstatSync(p).isSymbolicLink()&&(fs.statSync(p).isDirectory()||/(?:^|\/)LICENSE(?:\.[a-z]+)?$/i.test(p)||/\.(?:html|js|mjs|css|json|woff2?|ttf|png|jpe?g|webp|svg|avif|ico|mp4|webm|mp3|ogg|wav|m4a)$/i.test(p))});}
const files={};function inventory(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.name.startsWith('.'))throw Error('Private path in build');if(item.isDirectory())inventory(p);else{const name=path.relative(temporary,p).replaceAll(path.sep,'/');if(/(?:^|\/)(?:package(?:-lock)?\.json|node_modules|scripts|tests|docs)(?:\/|$)/.test(name))throw Error('Non-runtime path in build: '+name);files[name]={sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex'),bytes:fs.statSync(p).size};}}}inventory(temporary);
fs.writeFileSync(path.join(temporary,'asset-manifest.json'),JSON.stringify({version:1,files,routes:patterns,redirects:[...legacy.legacyModuleRedirects(),...legacy.appLegacyAliasRedirects(),{source:'/app/courses',destination:'/app/courses/ielts'}]},null,2)+'\n');
fs.rmSync(target,{recursive:true,force:true});fs.renameSync(temporary,target);
console.log(JSON.stringify({staticBuild:true,runtime:'Python FastAPI',files:Object.keys(files).length,routes:patterns.length,nextRuntimeRequired:false}));
