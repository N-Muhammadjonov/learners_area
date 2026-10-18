/** Small native DOM construction helper, not a component framework: no virtual DOM,
 * mounting runtime, hooks, hydration or diffing. All lifecycle/state is explicit. */
const svgTags=new Set(['svg','path','circle','rect','line','polyline','polygon','ellipse','g','defs','use','linearGradient','stop','title','text']);
export function fragment({children=[]}){const f=document.createDocumentFragment();append(f,children);return f;}
function append(parent,children){for(const c of [children].flat(Infinity)){if(c==null||typeof c==='boolean')continue;parent.append(c instanceof Node?c:document.createTextNode(String(c)));}}
export function h(tag,props,...children){props??={};if(typeof tag==='function')return tag({...props,children:children.length?children:props.children??[]});
 const n=svgTags.has(tag)?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag);
 for(let [key,value] of Object.entries(props)){
  if(['key','ref','prefetch','intentPrefetch','children'].includes(key)||value==null)continue;
  if(key==='dangerouslySetInnerHTML')throw TypeError('Unsafe HTML is not supported');
  if(/^on[A-Z]/.test(key)){if(typeof value!=='function')throw TypeError('Expected event handler');let event=key.slice(2).toLowerCase();if(event==='change'&&tag!=='select'&&!['radio','checkbox'].includes(props.type))event='input';n.addEventListener(event,value);continue;}
  if(key==='className')key='class';if(key==='htmlFor')key='for';
  if(key==='style'){for(const [k,v] of Object.entries(value)){if(k.startsWith('--'))n.style.setProperty(k,String(v));else n.style[k]=typeof v==='number'&&!['opacity','zIndex','fontWeight','lineHeight','flex','flexGrow','flexShrink','order'].includes(k)?v+'px':v;}continue;}
  if(['href','src','action','formaction','xlink:href'].includes(key)&&typeof value==='string'&&/^[\s\u0000-\u001f]*(?:javascript|vbscript|data):/i.test(value))throw TypeError('Unsafe URL');
  key=({'fontSize':'font-size','textAnchor':'text-anchor','strokeWidth':'stroke-width','strokeLinecap':'stroke-linecap','strokeLinejoin':'stroke-linejoin','tabIndex':'tabindex','autoComplete':'autocomplete','minLength':'minlength','maxLength':'maxlength','readOnly':'readonly','playsInline':'playsinline','autoPlay':'autoplay','srcSet':'srcset','fetchPriority':'fetchpriority'}[key]??key);
  if(typeof value==='boolean'){if(key.startsWith('aria-')||key.startsWith('data-'))n.setAttribute(key,String(value));else if(value)n.setAttribute(key,'');}else n.setAttribute(key,String(value));
 }
 append(n,children.length?children:props.children??[]);if(props.value!=null&&['input','select','textarea'].includes(tag))n.value=String(props.value);return n;
}
export const Link=({children,...props})=>h('a',props,children);
/** Original per-link intent opt-in. Timers/byte prewarm are owned by the shell. */
export function InstantLink({intentPrefetch=false,prefetch,onMouseEnter,onMouseLeave,onFocus,onBlur,onTouchStart,onPointerDown,children,...props}){
 const hint=(element,action,delay)=>element.dispatchEvent(new CustomEvent('learners-area:prefetch-intent',{bubbles:true,detail:{action,delay}}));
 const prepare=(e,callback,delay=90)=>{callback?.(e);if(!e.defaultPrevented&&intentPrefetch&&prefetch!==false)hint(e.currentTarget,'prepare',delay);};
 const cancel=(e,callback)=>{callback?.(e);hint(e.currentTarget,'cancel');};
 return h('a',{...props,'data-instant-navigation':true,onMouseEnter:e=>prepare(e,onMouseEnter),onMouseLeave:e=>cancel(e,onMouseLeave),onFocus:e=>prepare(e,onFocus),onBlur:e=>cancel(e,onBlur),onTouchStart:e=>prepare(e,onTouchStart,0),onPointerDown:e=>{if(e.pointerType!=='touch')prepare(e,onPointerDown,0);else onPointerDown?.(e);}},children);
}
