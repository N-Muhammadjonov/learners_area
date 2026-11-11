import {dockTexture} from './dock-texture.js';

const NS='http://www.w3.org/2000/svg';let serial=0;
function svg(tag,attrs={},...children){const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));node.append(...children.flat());return node;}

const referenceKeys = [
 'dashboard', 'live-classes', 'assignments', 'mocks', 'video-lessons',
 'listening', 'reading', 'writing', 'speaking', 'grammar',
 'vocabulary', 'progress', 'management',
];
const tileWidth = 192;
const tileHeight = 197;
const atlasColumns = 4;

/** Dock-only references; entries without a supplied image keep their artwork.
 * The rest of the site's module icons keep their existing appearance. */
export function dockIcon(key){
 if(key==='leaderboard'){
  // Same visual frame and responsive sizing as the other Dock reference assets.
  // The 104px WebP is stored alongside the existing neon icon assets.
  return svg('svg',{viewBox:'0 0 104 104',class:'dock-artwork dock-artwork--reference',
   'data-dock-artwork':key,'data-dock-reference':'','aria-hidden':'true',focusable:'false'},
   svg('image',{href:'/images/dock/neon/leaderboard.webp',x:0,y:0,width:104,height:104,
    preserveAspectRatio:'xMidYMid meet'}));
 }
 const tile = referenceKeys.indexOf(key);
 if(tile >= 0){
  const clip='dock-reference-'+(++serial);
  const column = tile % atlasColumns;
  const row = Math.floor(tile / atlasColumns);
  return svg('svg',{viewBox:`0 0 ${tileWidth} ${tileHeight}`,class:'dock-artwork dock-artwork--reference','data-dock-artwork':key,'data-dock-reference':'','aria-hidden':'true',focusable:'false'},
   svg('defs',{},svg('clipPath',{id:clip,clipPathUnits:'userSpaceOnUse'},
    svg('rect',{x:tileWidth/541,y:tileHeight/555,width:539*tileWidth/541,height:553*tileHeight/555,rx:127*tileWidth/541,ry:126*tileHeight/555}))),
   svg('image',{href:dockTexture,x:-column*tileWidth,y:-row*tileHeight,width:768,height:788,'clip-path':'url(#'+clip+')'}));
 }
 const prefix='dock-art-'+(++serial),paper='url(#'+prefix+'-paper)',metal='url(#'+prefix+'-metal)',gold='url(#'+prefix+'-gold)',ink='#214469';
 const gradient=(name,top,bottom)=>svg('linearGradient',{id:prefix+'-'+name,x1:0,y1:0,x2:0,y2:1},svg('stop',{offset:0,'stop-color':top}),svg('stop',{offset:1,'stop-color':bottom}));
 const defs=svg('defs',{},gradient('paper','#ffffff','#dcecff'),gradient('metal','#ffffff','#a9c8e8'),gradient('gold','#fff0b4','#f4b630'),
  svg('filter',{id:prefix+'-shadow',x:'-30%',y:'-30%',width:'160%',height:'170%'},svg('feDropShadow',{dx:0,dy:1.2,stdDeviation:.8,'flood-color':'#12365a','flood-opacity':.24})));
 const path=(d,fill=paper,attrs={})=>svg('path',{d,fill,...attrs});
 const line=(d,color=ink,width=1.7)=>path(d,'none',{stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round'});
 const rect=(x,y,width,height,rx=3,fill=paper,attrs={})=>svg('rect',{x,y,width,height,rx,fill,...attrs});
 const circle=(cx,cy,r,fill=paper,attrs={})=>svg('circle',{cx,cy,r,fill,...attrs});
 const text=(value,x,y,size,fill=ink)=>{const n=svg('text',{x,y,'font-family':'-apple-system,BlinkMacSystemFont,Arial,sans-serif','font-size':size,'font-weight':750,fill});n.textContent=value;return n;};
 let art=[];
 switch(key){
 case 'dashboard':
  art=[[10,10],[26,10],[10,26],[26,26]].flatMap(([x,y],i)=>[rect(x,y,12,12,3,paper),rect(x+2,y+2,8,3,1,['#78d9ff','#a9c4ff','#73e1c4','#ffda86'][i]),line(`M${x+3} ${y+8}h6`,'#b4cce1',1)]);break;
 case 'live-classes':
  art=[rect(8,14,25,22,6),path('M33 21l7-5v18l-7-5Z',metal),circle(20.5,25,6.5,'#ed486e'),circle(20.5,25,3.2,'#ffafbe'),circle(34,12,4,'#fff'),circle(34,12,2.7,'#4bdaae')];break;
 case 'assignments':
  art=[rect(12,10,25,31,4,metal),rect(10,8,25,31,4),rect(17,6,11,6,2,metal),line('m16 22 4 4 9-10','#39bda0',3),line('M16 32h13','#a5bed7',2)];break;
 case 'mocks':
  art=[rect(20,6,8,4,1.4,metal),line('m34 12 3 3','#eff7ff',3),circle(24,27,15),circle(24,27,11,'#e3f5fc'),line('M24 17v3m10 7h-3m-7 10v-3m-10-7h3','#93b6cb',1.7),line('M24 27v-6m0 6 5 3','#238baf',2.6),circle(24,27,2,'#238baf')];break;
 case 'video-lessons':
  art=[rect(8,11,33,27,6,metal),rect(8,9,32,27,5),rect(11,12,26,21,3,'#ff6470'),path('m21 17 9 6-9 6Z','#fff'),line('M14 39h20','#ffe5ce',2)];break;
 case 'listening':
  art=[path('M10 27v-5a14 14 0 0 1 28 0v5h-4v-5a10 10 0 0 0-20 0v5Z',metal),rect(8,23,9,16,4),rect(31,23,9,16,4),rect(12,26,3,10,1.5,'#9ac7f4'),rect(33,26,3,10,1.5,'#9ac7f4'),line('M16 38c5 4 10 4 15 0','#bfe2ff',1.8)];break;
 case 'reading':
  art=[path('M7 12c6-2 11-1 17 2v26c-6-3-11-4-17-2Z',metal),path('M41 12c-6-2-11-1-17 2v26c6-3 11-4 17-2Z',paper),line('M24 15v24','#acc5df',1.5),line('M12 18l7 2m-7 5 7 2m10-7 7-2m-7 9 7-2','#7599b9',1.5),path('M31 10v10l3-2 3 2V9Z',gold)];break;
 case 'writing':
  art=[rect(8,13,23,28,3,paper),line('M13 22h11m-11 6h8m-8 6h5','#a4c6d6',1.6),path('m20 31 3-9L37 8l6 6-14 14Z',metal),path('m20 31 3-9 6 6Z',gold),path('m20 31 3-2-1-1Z',ink),line('m33 12 6 6','#8aa8c5',1.6)];break;
 case 'speaking':
  art=[rect(17,7,14,25,7,paper),rect(20,10,8,16,4,metal),line('M13 23v2a11 11 0 0 0 22 0v-2m-11 13v6m-6 0h12','#eaf2ff',2.8),line('M21 14h6m-6 4h6m-6 4h6','#8da8c8',1.3)];break;
 case 'grammar':
  art=[text('A',7,33,29,paper),text('a',27,33,23,paper),line('M11 39h26','#bad4ff',1.8),circle(37,12,3.5,gold)];break;
 case 'vocabulary':
  art=[rect(10,9,25,29,4,metal,{transform:'rotate(-9 24 24)'}),rect(14,11,25,30,4),text('A',19,31,20,'#ad3567'),path('M32 11v11l3-2 3 2V11Z',gold),line('M20 36h11','#c1b6cd',1.5)];break;
 case 'progress':
  art=[rect(9,28,7,12,2,metal),rect(20,22,7,18,2,paper),rect(31,15,7,25,2,paper),line('M9 23l12-9 8 3 10-10','#fff0b4',2.7),line('M33 7h6v6','#fff0b4',2.7)];break;
 case 'leaderboard':
  art=[rect(3,3,42,42,11,'#1b375c',{stroke:'#85a7da','stroke-width':1.5}),
   rect(6,6,36,36,8,'#244f78',{opacity:.8}),
   rect(7,29,11,12,2,'#acbac8'),rect(18,20,12,21,2,gold),rect(30,32,11,9,2,'#bd865b'),
   line('M11 33v4m13-12v10m12 0v3','#fff2cb',1.3),
   path('M18 11 21 14 24 8 27 14 30 11 28 18H20Z','#ffe28e'),
   circle(24,5.8,1.7,'#fff0be'),
   line('M8 42h32','#e2d4bb',1.4)];break;
 case 'courses':
  art=[rect(10,28,28,7,2,metal),rect(12,36,26,5,2,paper),path('m5 17 19-9 19 9-19 9Z',paper),path('M13 23v7c7 5 15 5 22 0v-7l-11 5Z',metal),line('M41 19v12','#ffe394',2),circle(41,33,2.3,gold)];break;
 case 'coach':
  art=[rect(9,16,30,24,8,paper),rect(13,20,22,13,4,'#263d69'),rect(17,24,4,5,2,'#79eced'),rect(27,24,4,5,2,'#79eced'),line('M20 36h8','#92afd4',1.8),line('M24 15v-4','#f5e9ff',2),path('m24 4 2 4 4 1-4 2-2 4-2-4-4-2 4-1Z',gold)];break;
 case 'reports':
  art=[path('M12 8h17l8 8v25H12Z',paper),path('M29 8v9h8Z',metal),rect(17,29,4,7,1,'#7bb2e6'),rect(23,24,4,12,1,'#568cd1'),rect(29,20,4,16,1,'#3862b7'),line('M17 15h8m-8 5h6','#9fbed8',1.6)];break;
 case 'support':
  art=[path('M15 15h23v20h-7l-6 6v-6H15Z',metal),path('M7 9h29v23H19l-7 6v-6H7Z',paper),path('M18 17a4 4 0 0 1 8 0c0 4-4 3-4 7','none',{stroke:'#45678e','stroke-width':2.6,'stroke-linecap':'round'}),circle(22,28,1.5,'#45678e')];break;
 case 'management':{
  const points=Array.from({length:64},(_,i)=>{const a=i*Math.PI/32-Math.PI/2,r=[18,18,14,14,14,14,18,18][i%8];return [24+Math.cos(a)*r,24+Math.sin(a)*r].join(',');}).join(' ');
  art=[svg('polygon',{points,fill:metal,'stroke-linejoin':'round'}),circle(24,24,10,'#9db3cd'),circle(24,24,7,paper),circle(24,24,3,'#657c99')];break;}
 default:throw new TypeError('Unknown Dock icon: '+key);
 }
 return svg('svg',{viewBox:'0 0 48 48',class:'dock-artwork','data-dock-artwork':key,'aria-hidden':'true',focusable:'false'},defs,svg('g',{filter:'url(#'+prefix+'-shadow)'},art));
}
