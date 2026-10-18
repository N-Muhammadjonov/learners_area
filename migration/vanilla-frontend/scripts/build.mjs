import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
const base=path.resolve(import.meta.dirname,'..'), root=path.resolve(base,'../..');
// This source extraction step is needed only when refreshing from the original repository.
// The archive includes all extracted runtime inputs and can build independently.
if(fs.existsSync(path.join(root,'src/app/globals.css'))){
 fs.cpSync(path.join(root,'src/fonts'),path.join(base,'fonts'),{recursive:true});
 fs.copyFileSync(path.join(root,'src/lib/nav/private-modules.mjs'),path.join(base,'js/private-modules.js'));
 fs.copyFileSync(path.join(root,'src/app/globals.css'),path.join(base,'css/source.css'));
 const transpile=p=>ts.transpileModule(fs.readFileSync(path.join(root,p),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 fs.writeFileSync(path.join(base,'tailwind.source.mjs'),transpile('tailwind.config.ts'));
 fs.mkdirSync(path.join(base,'js/i18n'),{recursive:true});
 for(const lang of ['en','uz'])fs.writeFileSync(path.join(base,'js/i18n',lang+'.js'),transpile('src/lib/i18n/'+lang+'.ts'));
 fs.writeFileSync(path.join(base,'js/safe-next.js'),transpile('src/lib/auth/safe-redirect.ts'));
 const assets=['brand/derived/favicon-32.png','brand/derived/favicon.ico','brand/derived/owner-neon-day-96.png','brand/derived/owner-neon-day-192.png','brand/derived/owner-v11-night-96.png','brand/derived/owner-v11-night-192.png','brand/Learners_Area_intro_optimized_v17.mp4'];
 // Copy only public wallpaper derivatives actually referenced by global CSS.
 const css=fs.readFileSync(path.join(base,'css/source.css'),'utf8');
 for(const m of css.matchAll(/url\(["']?(\/images\/[^)'"\s]+)["']?\)/g))assets.push(m[1].slice(1));
 for(const a of new Set(assets)){fs.mkdirSync(path.join(base,path.dirname(a)),{recursive:true});fs.copyFileSync(path.join(root,'public',a),path.join(base,a));}
 // Capture original vector geometry as a build-time extraction, never React at runtime.
 const emoji=fs.readFileSync(path.join(root,'src/components/ui/ModuleEmoji.tsx'),'utf8');const marks={};
 for(const m of emoji.matchAll(/^  (\w+): \(\s*<>\s*([\s\S]*?)\s*<\/>,?\s*\),/gm))marks[m[1]]=m[2].replaceAll('className=','class=').replaceAll(/\s+\n\s*/g,' ');
 fs.writeFileSync(path.join(base,'js/components/marks.js'),'// Original ModuleEmoji SVG geometry; trusted source only.\nexport default '+JSON.stringify(marks,null,2)+';\n');
}
execFileSync(process.execPath,[path.join(base,'scripts/convert-ui.mjs')],{cwd:base,stdio:'inherit'});
execFileSync(process.execPath,[path.join(base,'scripts/convert-views.mjs')],{cwd:base,stdio:'inherit'});
execFileSync(process.execPath,[path.join(base,'scripts/convert-dashboard.mjs')],{cwd:base,stdio:'inherit'});
execFileSync(process.execPath,[path.join(base,'scripts/convert-interactions.mjs')],{cwd:base,stdio:'inherit'});
execFileSync(process.execPath,[path.join(base,'scripts/convert-auth.mjs')],{cwd:base,stdio:'inherit'});
execFileSync(process.execPath,[path.join(base,'scripts/convert-phase1.mjs')],{cwd:base,stdio:'inherit'});
const config=path.join(base,'tailwind.config.mjs');
if(!fs.existsSync(path.join(base,'tailwind.source.mjs')))throw Error('Missing extracted Tailwind config');
fs.writeFileSync(config,`import source from './tailwind.source.mjs';\nexport default {...source, content: ['./index.html','./js/**/*.js','./modules/**/*.js','./css/source.css']};\n`);
execFileSync(process.execPath,[path.join(base,'node_modules/tailwindcss/lib/cli.js'),'-c','tailwind.config.mjs','-i','css/source.css','-o','css/global.css','--minify'],{cwd:base,stdio:'inherit'});
// Explicit allowlist: source inventory and package documentation are NOT browser-published.
fs.mkdirSync(path.join(base,'build'),{recursive:true});
for(const name of ['index.html','js','modules','css/global.css','css/fonts.css','fonts','brand','images']){
 const p=path.join(base,name);if(fs.existsSync(p)){fs.mkdirSync(path.dirname(path.join(base,'build',name)),{recursive:true});fs.cpSync(p,path.join(base,'build',name),{recursive:true});}
}
console.log('Standalone browser build created. No React/Next runtime. NOT a complete route migration.');
