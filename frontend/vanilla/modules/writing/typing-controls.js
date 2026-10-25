/** Browser SVG controls, shared by the toolbar and saved result. */
export function typingControlIcon(kind,paused=false){
 const make=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
 const svg=make('svg',{width:kind==='pause'?22:20,height:kind==='pause'?22:20,viewBox:'0 0 24 24',fill:'none','aria-hidden':'true'});
 if(kind==='pause'){svg.setAttribute('class','typing-pause-orb-svg');svg.append(make('circle',{class:'typing-pause-orb-ring',cx:12,cy:12,r:9,stroke:'currentColor','stroke-width':1.7,opacity:.72}),make('circle',{class:'typing-pause-orb-dot',cx:12,cy:2.7,r:1.25,fill:'currentColor'}));if(paused)svg.append(make('path',{d:'M9.4 7.8 16 12l-6.6 4.2V7.8Z',fill:'currentColor'}));else for(const x of [8.2,13.1])svg.append(make('rect',{x,y:7.4,width:2.7,height:9.2,rx:1.15,fill:'currentColor'}));}
 else{for(const [key,value]of Object.entries({stroke:'currentColor','stroke-width':2.2,'stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);svg.append(make('path',{d:kind==='next'?'M5 12h14M13 6l6 6-6 6':'M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4'}));}
 return svg;
}
