import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..'),root=path.resolve(base,'../..');if(!fs.existsSync(path.join(root,'src')))process.exit(0);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');const ast=s=>ts.createSourceFile('input.tsx',s,ts.ScriptTarget.Latest,true);const find=(s,name)=>ast(s).statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const compile=s=>ts.transpileModule(s,{fileName:'native.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'fragment'}}).outputText;
for(const [file,name,vars] of [
 ['src/components/listening/McqMastery.tsx','McqMastery','questions,open,payload,text,error,busy,openDrill,advance,setText,dict,dayNavigation,audioUrl'],
 ['src/components/support/ReportProblem.tsx','ReportProblem','dict,floating,open,setOpen,message,setMessage,state,viewport,lastError,error,pathname,moduleName,send'],
 ['src/components/shell/ShellUtilities.tsx','ShellUtilities','dict,on,open,setOpen,useful,pathname,applyFocus,ReportProblem,containerRef,launcherRef'],
 ['src/app/app/(shell)/listening/mcq/day/[day]/page.tsx','ListeningMcqDayPage','day,dict,t,questions,complete,activeIndex,active,MCQ_FINAL_STAGE,McqMastery'],
 ]){const source=read(file),fn=find(source,name),expr=fn.body.statements.filter(ts.isReturnStatement).at(-1).expression.getText();let constants='';if(name==='McqMastery'){const a=ast(source);constants=a.statements.filter(n=>ts.isVariableStatement(n)&&/^(const STAGE_LABEL|const FIELD_LABEL)/.test(n.getText())).map(n=>n.getText()).join('\n');}
 const imports=`import {h,fragment,Link} from '../native.js';\nimport {Card} from './ui.js';\nimport {Button,BackLink} from '../../modules/shared/presentation.js';\nimport {IconAlert,IconClose,IconTarget,IconSparkles} from './icons.js';\nimport {ModuleEmoji} from './module-emoji.js';\n`;
 const code=constants+`\nexport function render(scope){const {${vars}}=scope;return ${expr};}`;fs.writeFileSync(path.join(base,'js/generated',name+'.js'),`// Reviewed source render expression: ${file}. State/events are native modules.\n`+imports+compile(code));
}
// Only reviewed, framework-free authored isolation/bridge/media utilities. No content or keys.
for(const [file,out] of [
 ['src/lib/listening/authored-sandbox.ts','authored-sandbox.js'],['src/lib/listening/authored-media-bridge.ts','authored-media-bridge.js'],['src/lib/client/private-resource.ts','private-resource.js'],['src/lib/client/authored-media-controller.ts','authored-media-controller.js']])fs.writeFileSync(path.join(base,'js/generated',out),compile(read(file)).replaceAll("'@/lib/client/private-resource'","'./private-resource.js'"));
const authored=read('src/components/listening/AuthoredListeningFrame.tsx');fs.writeFileSync(path.join(base,'js/generated/authored-helpers.js'),compile(['bridge','resolvePath'].map(n=>'export '+find(authored,n).getText()).join('\n')));
const rule=read('src/lib/listening/mcq-program.ts');fs.writeFileSync(path.join(base,'js/generated/mcq-position.js'),compile("export const MCQ_FINAL_STAGE='reasoned';\n"+find(rule,'mcqActivePosition').getText()));
console.log('Converted reviewed interaction render expressions and safe authored utilities');

const words=read('src/components/vocabulary/ClickableText.tsx'),wf=find(words,'WordPopover');
const portal=wf.body.statements.filter(ts.isReturnStatement).at(-1).expression.arguments[0].getText();
fs.writeFileSync(path.join(base,'js/generated/word-popover.js'),"import {h,fragment} from '../native.js';\n"+compile(`export function render(scope){const {dict,t,word,onClose,position,popupRef,error,loading,busy,setLookupVersion,known,saved,unresolved,contextual,catalogueLookup,meaning,setMeaning,uzbek,setUzbek,folderId,setFolderId,sourceType,folders,save,speak,needsMeaning}=scope;return ${portal};}`));

const hub=read('src/app/app/(focus)/listening/tests/[id]/page.tsx');
let hubExpression=find(hub,'Hub').body.statements.filter(ts.isReturnStatement).at(-1).expression.getText();
hubExpression=hubExpression.replace('detail.pkg.payload.sections.length','meta.parts').replace('detail.pkg.payload.questions.length','meta.questions').replace('Math.round(detail.pkg.payload.audio.durationSec / 60)','meta.min');
fs.writeFileSync(path.join(base,'js/generated/listening-hub.js'),"import {h,fragment,Link} from '../native.js';\n"+compile(`export function render(scope){const {dict,test,meta,cards,id}=scope;const detail={test},t=dict.fullListeningHub,r=t.research;${ast(hub).statements.find(n=>ts.isVariableStatement(n)&&n.getText().startsWith('const fill')).getText()}return ${hubExpression};}`));
const locked=read('src/components/listening/ListeningSequenceLocked.tsx');
fs.writeFileSync(path.join(base,'js/generated/listening-locked.js'),"import {h,fragment,Link} from '../native.js';\n"+compile(locked.replace(/^import[\s\S]*?;\s*$/gm,'')));
