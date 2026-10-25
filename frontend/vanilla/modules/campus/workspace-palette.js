import {CAMPUS_CONFIG} from '../../campus/v2/src/campus-config.js';
const accents=new Map(CAMPUS_CONFIG.modules.map(module=>[new URL(module.route,'https://campus.invalid').pathname.split('/')[2],module.accentHex]));
/** Share the actual map palette without loading the 3D renderer. */
export function workspaceAccent(url){
 const module=url.pathname.split('/')[2];
 return ['management','admin','teacher','owner'].includes(module)?'#d6b4ff':accents.get(module)??'#00e5ff';
}
