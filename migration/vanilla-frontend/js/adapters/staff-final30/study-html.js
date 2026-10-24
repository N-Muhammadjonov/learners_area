/**
 * Browser port of src/lib/speaking/rich-text.ts#cleanStudyHtml (sanitize-html allowlist). The SERVER sanitizes again on write;
 * this runs on paste and before the editor receives stored HTML, so a stored/pasted payload can never execute in the editor.
 * Disallowed tags are unwrapped (text kept); script/style/textarea/option/noscript/iframe/object/embed are removed with content.
 * No URLs, media or executable attributes survive (no href/src/on*).
 */
const TAGS=new Set(['p','div','span','br','b','strong','i','em','u','s','mark','font','ul','ol','li','blockquote','h2','h3','h4','table','tbody','tr','th','td','sub','sup']);
const DROP=new Set(['script','style','textarea','option','noscript','iframe','object','embed','template','svg','math']);
const ATTRS={font:['face','color','size'],td:['colspan','rowspan'],th:['colspan','rowspan']};
const COLOR=[/^#[0-9a-fA-F]{3,8}$/,/^[a-zA-Z]+$/,/^rgba?\([\d., %]+\)$/];
const STYLES={'font-family':[/^[a-zA-Z0-9 ,"'\-]+$/],'font-size':[/^(?:[1-9]\d?|1[0-4]\d)(?:px|pt)$/,/^(?:[0-3](?:\.\d+)?)(?:em|rem)$/],'font-weight':[/^(?:normal|bold|[1-9]00)$/],'font-style':[/^(?:normal|italic)$/],'text-decoration':[/^(?:none|underline|line-through)$/],'text-align':[/^(?:left|center|right|justify)$/],color:COLOR,'background-color':COLOR};
function cleanStyle(v){return v.split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const i=d.indexOf(':');if(i<0)return null;const k=d.slice(0,i).trim().toLowerCase(),val=d.slice(i+1).trim();return STYLES[k]?.some(r=>r.test(val))?`${k}:${val}`:null;}).filter(Boolean).join(';');}
function clean(html){
 const tpl=new DOMParser().parseFromString(`<body>${String(html??'')}</body>`,'text/html').body;
 (function walk(node){
  for(const child of [...node.childNodes]){
   if(child.nodeType===8){child.remove();continue;}if(child.nodeType!==1)continue;
   const tag=child.tagName.toLowerCase();
   if(DROP.has(tag)){child.remove();continue;}
   walk(child);
   if(!TAGS.has(tag)){child.replaceWith(...child.childNodes);continue;}
   for(const a of [...child.attributes]){const n=a.name.toLowerCase();
    if(n==='style'){const s=cleanStyle(a.value);if(s)child.setAttribute('style',s);else child.removeAttribute('style');}
    else if(!(ATTRS[tag]??[]).includes(n))child.removeAttribute(a.name);}
  }
 })(tpl);
 return tpl;
}
export const cleanStudyHtml=html=>clean(html).innerHTML;
/** Sanitized nodes for direct DOM insertion (no innerHTML assignment anywhere). */
export const cleanStudyNodes=(html,doc=document)=>[...clean(html).childNodes].map(n=>doc.importNode(n,true));
