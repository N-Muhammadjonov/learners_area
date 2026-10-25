/** Reviewed pure report form + calendar logic; server queries NEVER transpiled. */
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..'),root=path.resolve(base,'../..');if(!fs.existsSync(path.join(root,'src')))process.exit(0);
const compile=text=>ts.transpileModule(text,{fileName:'reports.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'fragment'}}).outputText;
const source=fs.readFileSync(path.join(root,'src/app/app/(shell)/reports/page.tsx'),'utf8'),ast=ts.createSourceFile('reports.tsx',source,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ReportsPage'),expr=fn.body.statements.filter(ts.isReturnStatement).at(-1).expression.getText(ast);
const formats=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(ast)==='FORMAT_LABELS').getText(ast).replace(': Record<(typeof REPORT_FORMATS)[number], string>','');
const code=`import {h,fragment} from '../native.js';import {Card} from './ui.js';import {PERIOD_KINDS} from './report-period.js';import {REPORT_FORMATS} from '../adapters/reports.js';import {TIMEZONE} from './time.js';
${formats}
export function render({dict,locale,role,query,students,scopes,errorText}){const t=dict.reporter,staff=role!=='student',teacher=role==='teacher',STUDENT_LIST_CAP=1000;
const periodLabel={on_demand:t.periodOnDemand,weekly:t.periodWeekly,monthly:t.periodMonthly,yearly:t.periodYearly,custom:t.periodCustom};const scopeLabel={owner:t.scopeOwner,teacher:teacher?t.scopeRoster:t.scopeTeacher,student:staff?t.scopeStudent:t.scopeSelf};return ${expr};}`;
// defaultValue/defaultChecked are React-only props: explicit native equivalents.
fs.writeFileSync(path.join(base,'js/generated/reports.js'),'// Reviewed source report form, no database or framework runtime.\n'+compile(code.replaceAll('defaultValue=','value=').replaceAll('defaultChecked=','checked=')));
const period=fs.readFileSync(path.join(root,'src/lib/reporter/period.ts'),'utf8').replace('"@/lib/time"','"./time.js"');fs.writeFileSync(path.join(base,'js/generated/report-period.js'),compile(period));
