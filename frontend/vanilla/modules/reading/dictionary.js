// The original Reading pages read main's dictionaries (src/lib/i18n). The shared js/i18n bundle predates them, so
// the generated Reading overlay is merged over it for Reading routes only. Shared Listening text is not touched.
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const merged=new WeakMap();
function overlay(base,extra){const out={...base};for(const key of Object.keys(extra))out[key]=isObj(base[key])&&isObj(extra[key])?overlay(base[key],extra[key]):extra[key];return out;}
export async function readingDictionary(context){
 const base=context.dict;
 if(merged.has(base))return merged.get(base);
 const lang=context.locale==='uz'?'uz':'en';
 const {default:extra}=await import(`../../js/i18n/reading-${lang}.js`);
 const value=overlay(base,extra);
 merged.set(base,value);
 return value;
}
