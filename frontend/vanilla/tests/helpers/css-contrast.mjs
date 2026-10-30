/** CSS color cascade probe for native DOM tests. It does not measure browser paint/layout. */
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
const plus=(a,b)=>a.map((v,i)=>v+b[i]);
const cmp=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
function specificity(node){
 if(node.type==='id')return [1,0,0];if(node.type==='class'||node.type==='attribute')return [0,1,0];if(node.type==='tag')return [0,0,1];
 if(node.type==='pseudo'){
  if(node.value===':where')return [0,0,0];if(node.value.startsWith('::'))return [0,0,1];
  if([':is',':not',':has'].includes(node.value)){return (node.nodes??[]).map(specificity).sort(cmp).at(-1)??[0,0,0];}
  return [0,1,0];
 }
 return (node.nodes??[]).reduce((n,child)=>plus(n,specificity(child)),[0,0,0]);
}
function mediaMatches(text,width,height){
 return text.split(',').some(query=>{
  if(/prefers-reduced-motion:\s*reduce|forced-colors:\s*active|pointer:\s*coarse|hover:\s*none/.test(query))return false;
  if(/orientation:\s*portrait/.test(query)&&width>height||/orientation:\s*landscape/.test(query)&&width<=height)return false;
  for(const m of query.matchAll(/(min|max)-(width|height):\s*([\d.]+)(px|rem|em)/g)){const n=Number(m[3])*(m[4]==='px'?1:16),size=m[2]==='width'?width:height;if(m[1]==='min'?size<n:size>n)return false;}
  return true;
 });
}
export function colorCascade(document,styles,{width=1200,height=900}={}){
 const winners=new WeakMap(),computed=new WeakMap(),unknown=new Set();let order=0;
 const put=(element,prop,entry)=>{let map=winners.get(element);if(!map){map=new Map();winners.set(element,map);}const old=map.get(prop);if(!old||Number(entry.important)>Number(old.important)||entry.important===old.important&&(cmp(entry.specificity,old.specificity)>0||cmp(entry.specificity,old.specificity)===0&&entry.order>=old.order))map.set(prop,entry);};
 function walk(container,active=true){for(const rule of container.nodes??[]){if(rule.type==='atrule'){if(rule.name.includes('keyframes'))continue;walk(rule,active&&(rule.name!=='media'||mediaMatches(rule.params,width,height)));continue;}if(!active||rule.type!=='rule')continue;
  const declarations=(rule.nodes??[]).filter(d=>d.type==='decl'&&(d.prop.startsWith('--')||['color-scheme','border','border-radius','box-shadow','max-width','border-color','color','background','background-color','display','visibility','opacity','font-size','font-weight'].includes(d.prop)));if(!declarations.length)continue;
  let selectors;try{selectors=selectorParser().astSync(rule.selector).nodes;}catch{continue;}
  for(const ast of selectors){const selector=ast.toString();if(/::|:(?:hover|active|visited|focus-visible)(?![\w-])/.test(selector))continue;let matches;try{matches=document.querySelectorAll(selector);}catch{continue;}const rank=specificity(ast);for(const element of matches)for(const decl of declarations){const entry={value:decl.value,important:!!decl.important,specificity:rank,order:order++,selector};put(element,decl.prop==='background'?'background-color':decl.prop,entry);}}
 }}
 for(const css of styles)walk(postcss.parse(css));
 for(const element of document.querySelectorAll('[style]'))for(const prop of Array.from({length:element.style.length},(_,i)=>element.style.item(i))){if(prop.startsWith('--')||['color','background-color','display','visibility','opacity'].includes(prop))put(element,prop,{value:element.style.getPropertyValue(prop),important:element.style.getPropertyPriority(prop)==='important',specificity:[100000,0,0],order:order++});}
 function property(element,name){for(let node=element;node;node=node.parentElement){const own=winners.get(node)?.get(name);if(own&&!['inherit','unset'].includes(own.value.trim()))return own.value.trim()==='initial'?null:{node,...own};}return null;}
 function substitute(value,element,depth=0){
  if(depth>15)return '';let start;
  while((start=value.indexOf('var('))!==-1){let end=start+4,nesting=1;for(;end<value.length&&nesting;end++){if(value[end]==='(')nesting++;else if(value[end]===')')nesting--;}if(nesting)return '';
   const args=value.slice(start+4,end-1),comma=args.indexOf(','),name=(comma<0?args:args.slice(0,comma)).trim(),fallback=comma<0?'':args.slice(comma+1),declared=property(element,name),replacement=declared?substitute(declared.value,declared.node,depth+1):substitute(fallback,element,depth+1);
   value=value.slice(0,start)+replacement+value.slice(end);
  }return value;
 }

 function parse(value){if(!value)return null;value=value.trim().toLowerCase();if(value==='transparent')return [0,0,0,0];if(value==='white')return [255,255,255,1];if(value==='black')return [0,0,0,1];
  const hex=value.match(/^#([a-f\d]{3,8})$/i);if(hex){let digits=hex[1];if(digits.length===3||digits.length===4)digits=[...digits].map(c=>c+c).join('');return [parseInt(digits.slice(0,2),16),parseInt(digits.slice(2,4),16),parseInt(digits.slice(4,6),16),digits.length===8?parseInt(digits.slice(6,8),16)/255:1];}
  const mix=value.match(/^color-mix\(in srgb,(.+) ([\d.]+)%,\s*transparent\)$/);if(mix){const base=parse(mix[1]);return base?[...base.slice(0,3),base[3]*Number(mix[2])/100]:null;}
  const rgb=value.match(/^rgba?\(([^()]+)\)$/);if(rgb){const values=rgb[1].replace(/[,/]/g,' ').trim().split(/\s+/);if(values.length<3)return null;return values.map((v,i)=>v.endsWith('%')?parseFloat(v)*(i<3?2.55:.01):Number(v)).concat(values.length===3?[1]:[]);}
  return null;
 }
 const blend=(top,bottom)=>{const a=top[3];return [0,1,2].map(i=>top[i]*a+bottom[i]*(1-a)).concat(1);};
 function get(element){if(!element)return {color:[0,0,0,1],background:[255,255,255,1],visible:true};let cached=computed.get(element);if(cached)return cached;const parent=get(element.parentElement),map=winners.get(element)??new Map();
  let foreground=map.get('color'),color=parent.color;
  if(foreground&&!['inherit','unset','currentcolor'].includes(foreground.value.toLowerCase())){const raw=substitute(foreground.value,element);color=parse(raw);if(!color){unknown.add(raw);color=parent.color;}}
  let backgrounds=parent.backgrounds??[parent.background];const own=map.get('background-color');if(own){let raw=substitute(own.value,element);if(raw==='currentColor')raw=foreground?.value??'transparent';const painted=parse(raw);if(painted)backgrounds=backgrounds.map(base=>blend(painted,base));
   else if(raw.startsWith('linear-gradient(')&&(raw.match(/gradient\(/g)??[]).length===1&&!raw.includes('url(')){
    const stops=[...raw.matchAll(/#[a-f\d]{3,8}\b|rgba?\([^()]+\)/gi)].map(m=>parse(m[0])).filter(Boolean),samples=[];
    // Sample every segment, not just the lightest stop. Descendant foregrounds
    // are checked again against the same painted candidates.
    for(let i=1;i<stops.length;i++)for(let n=0;n<=16;n++){const mix=stops[i-1].map((v,k)=>v+(stops[i][k]-v)*n/16);for(const base of backgrounds)samples.push(blend(mix,base));}
    if(samples.length)backgrounds=samples;else unknown.add(raw);
   }else if(!/url\(|gradient\(/.test(raw))unknown.add(raw);}
  const background=backgrounds.reduce((least,candidate)=>contrastRatio(color,candidate)<contrastRatio(color,least)?candidate:least);
  const opacity=Number(map.get('opacity')?.value??1);color=blend([...color.slice(0,3),color[3]*opacity],background);
  const visible=parent.visible&&!element.hidden&&!element.matches('.sr-only,input[type=hidden]')&&map.get('display')?.value!=='none'&&map.get('visibility')?.value!=='hidden'&&opacity>0;
  cached={color,background,backgrounds,visible,fontSize:map.get('font-size')?.value??'16px',foregroundRule:foreground?.selector??'inherited',backgroundRule:own?.selector??'inherited'};computed.set(element,cached);return cached;
 }
 return {get,unknown,winner:(element,prop)=>winners.get(element)?.get(prop),resolve:(element,prop)=>substitute(property(element,prop)?.value??'',property(element,prop)?.node??element)};
}
export function contrastRatio(foreground,background){const luminance=rgb=>rgb.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
