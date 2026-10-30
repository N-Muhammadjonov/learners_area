/** Fixed visual IELTS range. Values remain unchanged in labels and tables;
 * results below 4.0 use the lower edge and an explicit downward marker. */
export function bandAxis(values,{top=30,bottom=280}={}){
 const min=4,max=9;
 return {min,max,ticks:[4,5,6,7,8,9],below:value=>Number.isFinite(value)&&value<min,
  y:value=>bottom-(Math.max(min,Math.min(max,value))-min)/(max-min)*(bottom-top)};
}
