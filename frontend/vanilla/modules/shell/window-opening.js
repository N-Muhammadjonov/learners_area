const SVG='http://www.w3.org/2000/svg';
const OPENING_MS=400;
let serial=0;
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

/** A temporary, inert picture of an already-authorized window. It owns no app
 * listeners, embedded players, timers or network-backed document frames. */
export function captureWindow(source){
 if(!source)return null;
 const box=source.getBoundingClientRect();if(!box.width||!box.height)return null;
 const view=source.ownerDocument.defaultView,node=source.cloneNode(true),originals=[source,...source.querySelectorAll('*')],copies=[node,...node.querySelectorAll('*')],scroll=new Map();
 for(let i=0;i<originals.length;i++){
  const original=originals[i],copy=copies[i];
  if(i&&!node.contains(copy))continue;
  // Pictures need only the visible viewport. Keep off-screen flow geometry,
  // without multiplying thousands of invisible catalogue cards per band.
  if(i&&original.namespaceURI!==SVG&&original.childElementCount&&original.clientHeight&&!/^(TABLE|THEAD|TBODY|TFOOT|TR|TH|TD|SELECT)$/.test(original.tagName)){
   const rect=original.getBoundingClientRect();
   if((rect.bottom<=box.top||rect.top>=box.bottom||rect.right<=box.left||rect.left>=box.right)&&view.getComputedStyle(original).position!=='fixed'){
    copy.replaceChildren();Object.assign(copy.style,{boxSizing:'border-box',width:rect.width+'px',height:rect.height+'px',minHeight:rect.height+'px',visibility:'hidden'});continue;
   }
  }
  if(original.scrollTop||original.scrollLeft){copy.dataset.dockScroll=String(i);scroll.set(String(i),[original.scrollLeft,original.scrollTop]);}
  if(original.localName==='input'){if(original.type!=='file')copy.value=original.value;copy.checked=original.checked;}
  if(original.localName==='textarea')copy.textContent=original.value;
  if(original.localName==='select')for(let j=0;j<original.options.length;j++)copy.options[j].selected=original.options[j].selected;
  if(['canvas','video','iframe','audio','object','embed'].includes(original.localName)){
   const replacement=document.createElement('div');replacement.style.cssText=`width:${original.clientWidth}px;height:${original.clientHeight}px;background:${view.getComputedStyle(original).backgroundColor}`;
   try{
    let image;
    if(original.localName==='canvas')image=original.toDataURL();
    else if(original.localName==='video'&&original.readyState>=2){const canvas=document.createElement('canvas');canvas.width=original.videoWidth;canvas.height=original.videoHeight;canvas.getContext('2d').drawImage(original,0,0);image=canvas.toDataURL();}
    if(image){const picture=document.createElement('img');picture.src=image;picture.style.cssText='width:100%;height:100%;object-fit:contain';replacement.append(picture);}
   }catch{/* A protected media surface is never read or reloaded for an effect. */}
   copy.replaceWith(replacement);
  }
 }
 for(const child of [node,...node.querySelectorAll('*')]){
  if(['script','style','link','source','track'].includes(child.localName)){child.remove();continue;}
  for(const attribute of [...child.attributes])if(/^on/i.test(attribute.name)||['autofocus','form','name'].includes(attribute.name))child.removeAttribute(attribute.name);
  if(child.namespaceURI!==SVG)child.removeAttribute('id');
 }
 const computed=view.getComputedStyle(source);
 for(let i=0;i<computed.length;i++){const name=computed[i];if(name.startsWith('--'))node.style.setProperty(name,computed.getPropertyValue(name));}
 Object.assign(node.style,{position:'absolute',left:'0',top:'0',margin:'0',boxSizing:'border-box',minWidth:'0',maxWidth:'none',flex:'none',transform:'none',opacity:'1'});
 node.style.setProperty('width',box.width+'px','important');node.style.setProperty('height',box.height+'px','important');node.style.setProperty('overflow','hidden','important');
 node.dataset.dockSnapshot='';node.inert=true;node.setAttribute('aria-hidden','true');
 return {node,box,scroll,count:node.querySelectorAll('*').length+1};
}

function placeSnapshot(snapshot,parent,top=0){
 const node=snapshot.node.cloneNode(true),prefix='dock-picture-'+(++serial)+'-',ids=new Map();
 for(const element of node.querySelectorAll('[id]')){const id=element.id;ids.set(id,prefix+id);element.id=prefix+id;}
 for(const element of node.querySelectorAll('*'))for(const attr of [...element.attributes]){
  let value=attr.value;
  if((attr.localName==='href')&&value.startsWith('#')&&ids.has(value.slice(1)))value='#'+ids.get(value.slice(1));
  value=value.replace(/url\(["']?#([^\s)"']+)["']?\)/g,(match,id)=>ids.has(id)?'url(#'+ids.get(id)+')':match);
  if(value!==attr.value)element.setAttribute(attr.name,value);
 }
 node.style.top=-top+'px';parent.append(node);
 return ()=>{for(const element of [node,...node.querySelectorAll('[data-dock-scroll]')]){const position=snapshot.scroll.get(element.dataset.dockScroll);if(position){element.scrollLeft=position[0];element.scrollTop=position[1];}}};
}

/** Project each horizontal band onto a trapezoid. Unlike clipping a flat page,
 * this bends its contents along with the edges, as a Genie window unfolds. */
export function openWindow(content,intent){
 const snapshot=captureWindow(content);if(!snapshot)return null;
 const {box}=snapshot,W=box.width,H=box.height,doc=content.ownerDocument,win=doc.defaultView,restoreScroll=[];
 const layer=doc.createElement('div');layer.className='dock-opening-layer';layer.dataset.dockOpening='';layer.inert=true;layer.setAttribute('aria-hidden','true');
 if(intent.previous){const previous=doc.createElement('div');previous.className='dock-opening-previous';previous.dataset.dockPrevious='';const b=intent.previous.box;Object.assign(previous.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});restoreScroll.push(placeSnapshot(intent.previous,previous));layer.append(previous);}
 const window=doc.createElement('div'),sheet=doc.createElement('div');window.className='dock-opening-window';window.dataset.dockWindow='';sheet.className='dock-opening-sheet';
 Object.assign(window.style,{left:box.left+'px',top:box.top+'px',width:W+'px',height:H+'px'});window.append(sheet);layer.append(window);
 const count=Math.max(10,Math.min(W<700?16:24,Math.floor(24000/Math.max(1,snapshot.count)))),bands=[];
 for(let i=0;i<count;i++){
  const start=H*i/count,end=Math.min(H,H*(i+1)/count+.5),band=doc.createElement('div');band.className='dock-opening-band';
  Object.assign(band.style,{width:W+'px',height:end-start+'px'});restoreScroll.push(placeSnapshot(snapshot,band,start));sheet.append(band);bands.push({node:band,start,end});
 }
 const outline=doc.createElementNS(SVG,'svg'),edge=doc.createElementNS(SVG,'path');outline.setAttribute('viewBox',`0 0 ${W} ${H}`);outline.classList.add('dock-opening-outline');outline.append(edge);sheet.append(outline);
 const source={left:intent.x-intent.width/2-box.left,right:intent.x+intent.width/2-box.left,top:intent.y-intent.height/2-box.top,bottom:intent.y+intent.height/2-box.top};
 function draw(t){
  // Reference recording: the head widens before it finishes rising, while
  // the neck stays at the icon until the second half of the opening.
  t=Math.max(0,Math.min(1,t));const head=1-Math.pow(1-t,3.4),spread=1-Math.pow(1-Math.min(1,t/.55),3),tail=smooth((t-.45)/.55),rim=Math.min(16,W*.02)*Math.sin(Math.PI*t);
  const top=mix(source.top,rim,head),bottom=mix(source.bottom,H-rim,tail),height=Math.max(1,bottom-top);
  const leftTop=mix(source.left,rim,spread),rightTop=mix(source.right,W-rim,spread),leftBottom=mix(source.left,rim,tail),rightBottom=mix(source.right,W-rim,tail);
  const point=u=>({left:mix(leftTop,leftBottom,smooth(u)),right:mix(rightTop,rightBottom,smooth(u)),y:mix(top,bottom,u)});
  for(const {node,start,end} of bands){
   const a=point(start/H),b=point(end/H),h=end-start,ratio=(a.right-a.left)/Math.max(.1,b.right-b.left),perspective=(ratio-1)/h;
   node.style.transform=`matrix3d(${(a.right-a.left)/W},0,0,0,${(b.left*ratio-a.left)/h},${(b.y*ratio-a.y)/h},0,${perspective},0,0,1,0,${a.left},${a.y},0,1)`;
  }
  const radius=Math.min(14,Math.max(0,rightBottom-leftBottom)/5,height/4)*(1-smooth((t-.85)/.15));
  const path=`M ${leftTop+radius} ${top} L ${rightTop-radius} ${top} Q ${rightTop} ${top} ${rightTop} ${top+radius} C ${rightTop} ${top+height/3} ${rightBottom} ${top+height*2/3} ${rightBottom} ${bottom-radius} Q ${rightBottom} ${bottom} ${rightBottom-radius} ${bottom} L ${leftBottom+radius} ${bottom} Q ${leftBottom} ${bottom} ${leftBottom} ${bottom-radius} C ${leftBottom} ${top+height*2/3} ${leftTop} ${top+height/3} ${leftTop} ${top+radius} Q ${leftTop} ${top} ${leftTop+radius} ${top} Z`;
  sheet.style.clipPath=`path("${path}")`;edge.setAttribute('d',path);window.style.opacity=String(Math.min(1,t/.06));
 }
 draw(0);(content.closest('[data-dock-shell]')??doc.body).append(layer);for(const restore of restoreScroll)restore();
 // The live window remains mounted, focusable and hydrated throughout. Only
 // these short-lived inert pictures move. There is no reverse/close effect.
 const animation=content.animate([{opacity:0},{opacity:0}],{duration:OPENING_MS,easing:'linear'});animation.id='dock-genie';
 let frame,done=false;
 const cleanup=()=>{if(done)return;done=true;win.cancelAnimationFrame(frame);layer.remove();};
 const tick=()=>{if(done)return;draw(Number(animation.currentTime??0)/OPENING_MS);frame=win.requestAnimationFrame(tick);};frame=win.requestAnimationFrame(tick);
 animation.finished?.then(cleanup,cleanup);
 return {cancel(){animation.cancel();cleanup();}};
}
