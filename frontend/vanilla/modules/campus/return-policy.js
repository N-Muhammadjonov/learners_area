import routes from '../../js/routes.js';
import {compilePattern} from '../../js/router.js';
import {canonicalPath} from '../../js/navigation.js';
import {previousAppPath} from '../../js/return-navigation.js';
const tabbed=new Set(['listening','reading','writing','grammar','vocabulary']);
const paths=routes.map(route=>({path:route.pattern,match:compilePattern(route.pattern),layout:route.layout}));
const exists=path=>paths.some(route=>route.match.test(path));
/** A direct detail URL has a real parent even without a prior browser entry. */
export function returnPolicy(url,{previous=null}={}){
 const path=url.pathname.replace(/\/+$/,'')||'/',segments=path.split('/').filter(Boolean),module=segments[1];
 if(path==='/app')return {mode:'hidden',href:'/app'};
 if(path==='/app/study-plan/leaderboard')return {mode:'main',href:'/app'};
 if(path==='/app/riwi')return {mode:'back',href:'/app'};
 if(path==='/app/plan/level-check')return {mode:'back',href:'/app/assignments#study-plan-30'};
 if(path==='/app/management'&&['mock-create','mock-grading'].includes(url.searchParams.get('view')))return {mode:'back',href:'/app/management?view=mocks'};
 if(path==='/app/management'&&url.searchParams.get('view')==='mocks')return {mode:'back',href:'/app/management'};
 if(tabbed.has(module)&&paths.find(route=>route.match.test(path))?.layout!=='focus')return {mode:'main',href:'/app'};
 if(module==='speaking'&&path==='/app/speaking/practice'){
  if(url.searchParams.has('topic')){const q=new URLSearchParams();const part=url.searchParams.get('part');if(['part1','part2','part3'].includes(part))q.set('part',part);return {mode:'back',href:'/app/speaking/practice'+(q.size?'?'+q:'')};}
  if(url.searchParams.has('part'))return {mode:'back',href:'/app/speaking/practice'};
 }
 const staff=['admin','teacher','owner'].includes(module);
 if(staff||segments.length>2){
  for(let n=segments.length-1;n>1;n--){const parent='/'+segments.slice(0,n).join('/');if(exists(parent)&&(canonicalPath(new URL(parent,url.origin))??parent).split('?')[0]!==path)return {mode:'back',href:parent};}
  const home='/app/'+module;if(!staff&&(!exists(home)||(canonicalPath(new URL(home,url.origin))??home).split('?')[0]===path))return {mode:'main',href:'/app'};
  return {mode:'back',href:staff?'/app/management':home};
 }
 if(['reports','support'].includes(module)&&previous&&/^\/app\/(management|admin|teacher|owner)(?:\/|\?|$)/.test(previous))return {mode:'back',href:previous};
 return {mode:'main',href:'/app'};
}
export function returnForWindow(url,win=window){return returnPolicy(url,{previous:previousAppPath(win)});}
