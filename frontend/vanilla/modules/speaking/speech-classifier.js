// WebRTC libfvad, @echogarden/fvad-wasm 0.2.0. The export names below are
// the ABI of this pinned binary. Audio samples stay in browser memory.
let compiled;
const frameSamples=320;
const modelURL=new URL('../../js/vendor/webrtc-vad/fvad.wasm',import.meta.url);

async function model(){
 compiled??=fetch(modelURL,{credentials:'same-origin'}).then(response=>{
  if(!response.ok)throw Error('vad_asset');
  return response.arrayBuffer();
 }).then(bytes=>WebAssembly.compile(bytes)).catch(error=>{compiled=null;throw error;});
 return compiled;
}

export async function openSpeechClassifier(module){
 const instance=await WebAssembly.instantiate(module??await model(),{
  a:{a(){throw Error('vad_assertion');},b(){return 0;}}
 });
 const {c:memory,d:init,e:allocateVad,f:malloc,h:freeVad,i:free,j:mode,k:rate,l:process}=instance.exports;
 init();
 const vad=allocateVad(),frame=malloc(frameSamples*2);
 if(!vad||!frame||mode(vad,3)!==0||rate(vad,16000)!==0){
  if(vad)freeVad(vad);if(frame)free(frame);
  throw Error('vad_init');
 }
 const pcm=new Int16Array(memory.buffer,frame,frameSamples);
 let disposed=false,previousLevel=0,previousCorrelation=0,recentChanges=0,voiceFrames=0;
 return {
  classify(samples){
   if(disposed||samples.length<frameSamples)return false;
   const ratio=samples.length/frameSamples;
   let power=0,laggedPower=0,previous=0;
   for(let i=0;i<frameSamples;i++){
    const from=Math.floor(i*ratio),to=Math.floor((i+1)*ratio);
    let sum=0;
    for(let j=from;j<to;j++)sum+=samples[j];
    const value=sum/(to-from);
    pcm[i]=Math.max(-32768,Math.min(32767,Math.round(value*32767)));
    power+=value*value;
    laggedPower+=value*previous;
    previous=value;
   }
   const level=Math.sqrt(power/frameSamples),correlation=power>0?laggedPower/power:0;
   const changing=Math.abs(level-previousLevel)>Math.max(.0003,Math.max(level,previousLevel)*.14)
    ||Math.abs(correlation-previousCorrelation)>.12;
   // A motor can pass libfvad at startup. Require two envelope/timbre
   // changes in twelve frames and reject uncorrelated broadband noise.
   recentChanges=((recentChanges<<1)|Number(changing))&4095;
   previousLevel=level;previousCorrelation=correlation;
   const candidate=process(vad,frame,frameSamples)===1&&correlation>.25&&
    (recentChanges&(recentChanges-1))!==0;
   // Debounce single noisy VAD positives. A brief continuous speech onset
   // must be present before game physics counts the microphone as speech.
   voiceFrames=candidate?Math.min(3,voiceFrames+1):0;
   return voiceFrames>=3;
  },
  dispose(){if(!disposed){disposed=true;freeVad(vad);free(frame);}}
 };
}
