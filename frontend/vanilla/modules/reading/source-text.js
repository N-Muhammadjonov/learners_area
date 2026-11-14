/** Match source HTML text to the canonical passage without deriving any meaning.
 * Only whitespace and typographic apostrophes are normalized for alignment.
 * The returned map keeps dictionary offsets in canonical source coordinates.
 */
function normalize(text){
 const chars=[],positions=[];
 for(let index=0;index<text.length;index++){
  let char=text[index];
  if(/\s/.test(char)){if(!chars.length||chars.at(-1)===' ')continue;char=' ';}
  if(char==='’'||char==='‘')char="'";
  chars.push(char);positions.push(index);
 }
 while(chars.at(-1)===' '){chars.pop();positions.pop();}
 return {text:chars.join(''),positions};
}
export function sourceTextRange(body,text,cursor=0){
 const source=normalize(body),fragment=normalize(text);
 const variants=[0];
 // Some legacy HTML retains the printed paragraph label; the database body
 // omits it. Keep that label visible, but never give it a dictionary identity.
 if(/^[A-Z] /.test(fragment.text))variants.push(2);
 for(const skip of variants){
  const needle=fragment.text.slice(skip);if(!needle)continue;
  const after=source.positions.findIndex(at=>at>=cursor);
  if(after<0)continue;
  const hit=source.text.indexOf(needle,after);
  if(hit<0||source.text.indexOf(needle,hit+1)>=0)continue;
  const map=new Array(text.length).fill(null);
  for(let index=skip;index<fragment.positions.length;index++){
   const local=fragment.positions[index],at=source.positions[hit+index-skip];
   if(at===undefined)return null;
   map[local]=at;
  }
  return {map,start:source.positions[hit],end:source.positions[hit+needle.length-1]+1};
 }
 return null;
}
