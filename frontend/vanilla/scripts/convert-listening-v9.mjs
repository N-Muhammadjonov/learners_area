/** Presentation only, original source remains read-only. No hook emulation/framework. */
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..'),root=path.resolve(base,'../..');if(!fs.existsSync(path.join(root,'src')))process.exit(0);
const compile=s=>ts.transpileModule(s,{fileName:'source.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'fragment'}}).outputText;
for(const [file,name,vars,pre]of [
 ['src/app/app/(shell)/listening/general/[sectionId]/page.tsx','GeneralListeningSectionPage','dict,view,SectionListeningActivity,SectionRetakeButton','const t=dict.listening.general;'],
 ['src/app/app/(shell)/listening/academic/[testId]/page.tsx','AcademicListeningTestPage','dict,test','const t=dict.listening.academic;'],
 ]){const src=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile('s.tsx',src,ts.ScriptTarget.Latest,true),f=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name),expr=f.body.statements.filter(ts.isReturnStatement).at(-1).expression.getText();fs.writeFileSync(path.join(base,'js/generated',name+'-v9.js'),"import {h,fragment,Link} from '../native.js';import {Card} from './ui.js';import {ListeningAnalysis} from './listening-analysis.js';import {BackLink} from '../../modules/shared/presentation.js';\n"+compile(`export function render(scope){const {${vars}}=scope;${pre}return ${expr};}`));}
