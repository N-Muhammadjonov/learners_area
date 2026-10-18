/** No untrusted HTML interpolation. Event handlers belong to a view AbortSignal. */
export function el(tag, attrs={}, ...children) {
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs)){
  if(value==null||value===false)continue;
  if(key==='class')node.className=value;
  else if(key==='text')node.textContent=value;
  else if(key==='style')Object.assign(node.style,value);
  else node.setAttribute(key,value===true?'':String(value));
 }
 for(const child of children.flat(Infinity))if(child!=null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
}
export function listen(node,event,fn,signal){node.addEventListener(event,fn,{signal});}
