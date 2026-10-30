/** Native equivalent of cleanStudyHtml's display allowlist (rich-text.ts).
 * Never trust HTML returned in Speaking study support as executable markup. */
const TAGS=new Set(['p','div','span','br','b','strong','i','em','u','s','mark','font','ul','ol','li','blockquote','h2','h3','h4','table','tbody','tr','th','td','sub','sup']);
const STYLES={
 'font-family':/^[a-zA-Z0-9 ,'"-]+$/,
 'font-size':/^(?:[1-9]\d?|1[0-4]\d)(?:px|pt)$|^(?:[0-3](?:\.\d+)?)(?:em|rem)$/,
 'font-weight':/^(?:normal|bold|[1-9]00)$/,
 'font-style':/^(?:normal|italic)$/,
 'text-decoration':/^(?:none|underline|line-through)$/,
 'text-align':/^(?:left|center|right|justify)$/,
 'color':/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d., %]+\))$/,
 'background-color':/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d., %]+\))$/
};
function clean(node,owner){
 if(node.nodeType===Node.TEXT_NODE)return owner.createTextNode(node.nodeValue??'');
 if(node.nodeType!==Node.ELEMENT_NODE)return owner.createDocumentFragment();
 const tag=node.tagName.toLowerCase(),target=TAGS.has(tag)?owner.createElement(tag):owner.createDocumentFragment();
 if(target.nodeType===Node.ELEMENT_NODE){
  if(tag==='font')for(const k of ['face','color','size']){const value=node.getAttribute(k);if(value&&value.length<200&&/^[#A-Za-z0-9 ,.-]+$/.test(value))target.setAttribute(k,value);}
  if(tag==='th'||tag==='td')for(const k of ['colspan','rowspan']){const n=Number(node.getAttribute(k));if(Number.isInteger(n)&&n>0&&n<=20)target.setAttribute(k,String(n));}
  const styles=node.getAttribute('style');if(styles){
   const parsed=owner.createElement('div');parsed.style.cssText=styles;
   for(const [key,re]of Object.entries(STYLES)){const value=parsed.style.getPropertyValue(key).trim();if(value&&re.test(value))target.style.setProperty(key,value);}
  }
 }
 for(const child of node.childNodes)target.append(clean(child,owner));return target;
}
export function studyRich(html){
 const host=document.createElement('div');host.className='study-rich-text break-words';
 const input=new DOMParser().parseFromString(String(html??''),'text/html');
 for(const node of input.body.childNodes)host.append(clean(node,document));return host;
}
