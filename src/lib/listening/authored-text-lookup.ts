/** Runs only in the opaque authored iframe. A caret API returns the nearest
 * character even for whitespace: a word's painted rectangles must contain the
 * pointer before any lookup message is sent. Inputs/gaps are never word targets. */
export const authoredTextLookup = String.raw`
document.addEventListener('dblclick',e=>{
 if(e.button!==0)return;
 const el=e.target instanceof Element?e.target:null;
 if(!el||el.closest('button,input,textarea,select,a,[contenteditable="true"]'))return;
 const area=el.closest('#vocab,#script,#view-vocab,#view-script,#activity-vocab,#activity-script,[data-la-vocabulary],[data-la-script]');
 if(!area)return;
 let caret=document.caretRangeFromPoint?.(e.clientX,e.clientY);
 if(!caret&&document.caretPositionFromPoint){const p=document.caretPositionFromPoint(e.clientX,e.clientY);if(p){caret=document.createRange();caret.setStart(p.offsetNode,p.offset);}}
 if(!caret||caret.startContainer.nodeType!==3||!area.contains(caret.startContainer))return;
 const node=caret.startContainer;
 if(node.parentElement?.closest('button,input,textarea,select,a,[contenteditable="true"]'))return;
 const text=node.textContent||'',at=caret.startOffset;
 let l=at,r=at;
 while(l>0&&/[a-zA-Z'\u2018\u2019\u02bb\u02bc-]/.test(text[l-1]))l--;
 while(r<text.length&&/[a-zA-Z'\u2018\u2019\u02bb\u02bc-]/.test(text[r]))r++;
 const word=text.slice(l,r);if(!/[a-zA-Z]/.test(word))return;
 const painted=document.createRange();painted.setStart(node,l);painted.setEnd(node,r);
 if(!Array.from(painted.getClientRects()).some(b=>e.clientX>=b.left&&e.clientX<=b.right&&e.clientY>=b.top&&e.clientY<=b.bottom))return;
 const block=node.parentElement.closest('p,.transcript,.script-row,.script-line')||area;
 const prefix=document.createRange();prefix.selectNodeContents(block);prefix.setEnd(node,l);
 const offset=prefix.toString().length,all=block.textContent||'',base=Math.max(0,offset-1400),context=all.slice(base,offset+word.length+1400);
 send('word',{word,mode:area.id.includes('vocab')?'vocab':'script',x:e.clientX,y:e.clientY,context,start:offset-base,end:offset-base+word.length});
},true);
`;
