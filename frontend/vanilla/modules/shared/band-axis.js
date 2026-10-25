/** Reference band charts show every level from 4.0 through 9.0. Extend the
 * bottom only when a genuine lower score exists, so no stored result is lost. */
export function bandAxis(values,{top=30,bottom=280}={}){
 const scores=values.filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=9);
 const min=Math.min(4,...scores.map(Math.floor)),max=9;
 return {min,max,ticks:Array.from({length:max-min+1},(_,i)=>min+i),
  y:value=>bottom-(value-min)/(max-min)*(bottom-top)};
}
