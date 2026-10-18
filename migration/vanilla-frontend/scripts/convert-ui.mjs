/** Build-time conversion of reviewed pure presentation functions only.
 * Stateful React components are NEVER auto-translated. No original imports,
 * server queries, hooks, secrets or protected content enter generated modules. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..'),root=path.resolve(base,'../..');
if(!fs.existsSync(path.join(root,'src/components')))process.exit(0);
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'fragment'}}).outputText;
const header="// Generated native DOM from reviewed source. No React runtime.\nimport {h,fragment,Link,InstantLink} from '../native.js';\n";
for(const [source,dest] of [['ui/icons.tsx','icons.js'],['ui/ModuleEmoji.tsx','module-emoji.js']]){
 let text=fs.readFileSync(path.join(root,'src/components',source),'utf8');
 // Source React elements are immutable descriptions; native nodes are consumable.
 // Emit factories for each static SVG mark so repeat mounts never move/empty a shared fragment.
 if(dest==='module-emoji.js'){const ast=ts.createSourceFile('marks.tsx',text,ts.ScriptTarget.Latest,true);let object;function find(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='marks')object=n.initializer;ts.forEachChild(n,find);}find(ast);if(!object||!ts.isObjectLiteralExpression(object))throw Error('Unexpected ModuleEmoji source');const replacement='{'+object.properties.map(p=>p.name.getText(ast)+':()=>('+p.initializer.getText(ast)+')').join(',')+'}';text=text.slice(0,object.pos)+replacement+text.slice(object.end);text=text.replace('{marks[kind]}','{marks[kind]()}');}
 fs.writeFileSync(path.join(base,'js/generated',dest),header+transpile(text.replace(/^import .*?;\s*$/gm,'')));
}
const pure=['ui/Card.tsx','ui/EmptyState.tsx','ui/ProgressBar.tsx'];
let text=header;
for(const f of pure)text+=transpile(fs.readFileSync(path.join(root,'src/components',f),'utf8').replace(/^import .*?;\s*$/gm,''));
fs.writeFileSync(path.join(base,'js/generated/ui.js'),text);
const source=fs.readFileSync(path.join(root,'src/components/shell/SidebarNav.tsx'),'utf8');
const ast=ts.createSourceFile('nav.tsx',source,ts.ScriptTarget.Latest,true);
const functions=ast.statements.filter(ts.isFunctionDeclaration);
const group=functions.find(f=>f.name.text==='Group').getText(ast);
const nav=functions.find(f=>f.name.text==='SidebarNav');
const body=nav.body.getText(ast);const pureBody=body.slice(body.indexOf('const nav ='));
const out=header+"import {ModuleEmoji,moduleEmojiFor} from './module-emoji.js';\nimport * as Icons from './icons.js';\nconst {"+[...new Set([...source.matchAll(/<(Icon\w+)/g)].map(m=>m[1]))].join(',')+"}=Icons;\nimport {LinkPending} from '../../modules/shell/link-pending.js';\nconst isManagementRoute=p=>['/app/management','/app/admin','/app/owner','/app/teacher'].some(x=>p===x||p.startsWith(x+'/'));\n"+transpile(group.replace('data-sidebar-link={item.href}', 'data-sidebar-link={item.href} data-nav-active-prefix={canonical} data-nav-exact={Boolean(item.exact)}')+`\nexport function SidebarNav({dict,role,email,pathname,pendingPath=null}){const activePath=pendingPath??pathname;\n${pureBody}`);
fs.writeFileSync(path.join(base,'js/generated/sidebar.js'),out);
console.log('Converted reviewed pure icon/UI/sidebar presentation functions to native DOM');
