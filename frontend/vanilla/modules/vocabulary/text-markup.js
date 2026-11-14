/** Preserve sanitized inline formatting while all text shares one selection
 * surface. A word split by <strong> or <em> keeps one token/occurrence identity.
 */
export function readingTokens(text){
 const tokens=[],pattern=/[A-Za-z]+(?:['’\u2011-][A-Za-z]+)*/g;
 let end=0;
 for(const match of text.matchAll(pattern)){
  if(match.index>end)tokens.push({value:text.slice(end,match.index),clean:'',isWord:false,start:end,end:match.index});
  tokens.push({value:match[0],clean:match[0],isWord:true,start:match.index,end:match.index+match[0].length});
  end=match.index+match[0].length;
 }
 if(end<text.length)tokens.push({value:text.slice(end),clean:'',isWord:false,start:end,end:text.length});
 return tokens;
}
export function markedMarkup(markupRoot,tokens,eligible,highlights,highlightStyle){
 const fragment=document.createDocumentFragment();
 fragment.append(...[...markupRoot.childNodes].map(node=>node.cloneNode(true)));
 const walker=document.createTreeWalker(fragment,document.defaultView.NodeFilter.SHOW_TEXT),nodes=[];
 let node;while((node=walker.nextNode()))nodes.push(node);
 const wordNodes=new Map();let offset=0,index=0;
 for(const textNode of nodes){
  const text=textNode.nodeValue??'',start=offset,end=start+text.length;offset=end;
  const replacement=document.createDocumentFragment();
  while(index<tokens.length&&tokens[index].end<=start)index++;
  for(let at=index;at<tokens.length&&tokens[at].start<end;at++){
   const token=tokens[at],from=Math.max(start,token.start),to=Math.min(end,token.end);
   const cuts=new Set([from,to]);
   for(const highlight of highlights){if(highlight.start>from&&highlight.start<to)cuts.add(highlight.start);if(highlight.end>from&&highlight.end<to)cuts.add(highlight.end);}
   const points=[...cuts].sort((a,b)=>a-b),content=document.createDocumentFragment();
   for(let part=0;part<points.length-1;part++){
    const a=points[part],b=points[part+1],value=text.slice(a-start,b-start);
    const highlight=highlights.find(row=>row.start<=a&&row.end>a);
    if(highlight){const mark=document.createElement('mark');mark.dataset.highlightId=highlight.id;mark.dataset.highlightColor=highlight.color??'blue';Object.assign(mark.style,highlightStyle(highlight.color));mark.textContent=value;content.append(mark);}
    else content.append(document.createTextNode(value));
   }
   if(eligible(at)){
    const span=document.createElement('span');span.dataset.word=token.clean;span.dataset.token=String(at);span.dataset.lexicalSaved='false';span.className='lexical-dotted-word';span.style.cursor='text';span.append(content);
    const list=wordNodes.get(at)??[];list.push(span);wordNodes.set(at,list);replacement.append(span);
   }else replacement.append(content);
  }
  textNode.replaceWith(replacement);
 }
 return {fragment,wordNodes};
}
