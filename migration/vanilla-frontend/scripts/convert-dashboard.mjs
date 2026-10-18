import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..'),root=path.resolve(base,'../..');if(!fs.existsSync(path.join(root,'src')))process.exit(0);
const compile=text=>ts.transpileModule(text,{fileName:'native.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'fragment'}}).outputText;
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const noImports=s=>s.replace(/^import[\s\S]*?;\s*$/gm,'');
for(const [src,dest] of [['src/lib/time.ts','time.js'],['src/lib/progress/mock-summary.ts','mock-summary.js']])fs.writeFileSync(path.join(base,'js/generated',dest),compile(noImports(read(src))));
fs.writeFileSync(path.join(base,'js/generated/mock-band.js'),"import {h,fragment} from '../native.js';\n"+compile(noImports(read('src/components/progress/MockBandPanel.tsx'))));
fs.writeFileSync(path.join(base,'js/generated/badges.js'),"import {h,fragment} from '../native.js';\n"+compile(read('src/components/ui/Badge.tsx')));
function functions(source){const ast=ts.createSourceFile('input.tsx',source,ts.ScriptTarget.Latest,true);return new Map(ast.statements.filter(ts.isFunctionDeclaration).map(f=>[f.name.text,f]));}
const text=read('src/app/app/(shell)/page.tsx'),f=functions(text);
const declaration=name=>f.get(name).getText().replace(/^async /,'');
let content=declaration('DashboardContent').replace('const data = await getDashboardData(user.id);','const data = scope.dashboard;');
let lessons=declaration('DashboardOpenLessons').replace('const result = await openLessonsPromise;','const result = scope.openLessonsResult;');
let mock=functions(read('src/components/progress/MockProgressOverview.tsx')).get('MockProgressOverview').getText().replace('export async function','function').replace('data = await getMockOverview(userId);','data = scope.mock;');
const expr=f.get('DashboardPage').body.statements.filter(ts.isReturnStatement).at(-1).expression.getText();
const imports=`import {h,fragment,Link} from '../native.js';
import {Card,StatCard} from './ui.js';
import {Button,RegionFailureNotice as FailureNotice} from '../../modules/shared/presentation.js';
import {BandBadge,StateBadge} from './badges.js';
import {formatDate,formatDateTime} from './time.js';
import {summarizeMocks} from './mock-summary.js';
import {MockBandPanel} from './mock-band.js';\n`;
const code=`export function render(scope){const {context,dict,locale,user}=scope;const openLessonsPromise=scope.openLessonsResult;const SKILLS=['listening','reading','writing','speaking'];
// Source success compositions: all async regions are loaded by native Fetch in module mount.
const Suspense=({children})=>fragment({children});const RegionFailureNotice=p=>FailureNotice({...p,refresh:context.refresh});
${content}\n${lessons}\n${declaration('DashboardSkeleton')}\n${declaration('DashboardOpenLessonsSkeleton')}\n${mock}\nreturn ${expr};}`;
fs.writeFileSync(path.join(base,'js/generated/dashboard.js'),'// Exact source success markup; explicit native lifecycle/data adapters. No React runtime.\n'+imports+compile(code));
// Mock catalogue/reporting, intentionally no runner: the current source does not enable it.
const mocks=functions(read('src/app/app/(shell)/mocks/page.tsx'));
const mc=mocks.get('MocksContent').getText().replace(/^async /,'').replace('const data = await getMockOverview(user.id);','const data = scope.mock;');
const me=mocks.get('MocksPage').body.statements.filter(ts.isReturnStatement).at(-1).expression.getText();
const ms=mocks.get('MocksSkeleton').getText();
fs.writeFileSync(path.join(base,'js/generated/mocks.js'),imports+compile(`export function render(scope){const {context,dict,user}=scope;const t=dict.mocks;const Suspense=({children})=>fragment({children}),RegionFailureNotice=p=>FailureNotice({...p,refresh:context.refresh});${mc}\n${ms}\nreturn ${me};}`));
console.log('Converted Dashboard and Mocks source success views and original mock chart');
