import {createSpeechAssetFetch} from './riwi-speech-assets.js';
const root=new URL('./vendor/riwi-speech/',import.meta.url);
let loading,busy=false;
async function load(){
 if(!loading)loading=(async()=>{
  const read=globalThis.fetch.bind(globalThis),response=await read(new URL('manifest.json',root),{method:'GET',credentials:'same-origin',redirect:'error'});
  if(!response.ok)throw Error('asr_asset_unavailable');const manifest=await response.json();
  globalThis.fetch=createSpeechAssetFetch({root,manifest,fetch:read,onProgress:progress=>postMessage({type:'progress',progress})});
  const {pipeline,env}=await import(new URL('transformers.min.js',root).href);
  env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=new URL('models/',root).href;
  env.useBrowserCache=false;env.backends.onnx.wasm.wasmPaths=root.href;env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
  const asr=await pipeline('automatic-speech-recognition','riwi-asr',{device:'wasm',dtype:'q8',local_files_only:true});
  globalThis.fetch.clear();postMessage({type:'ready'});return asr;
 })();
 return loading;
}
globalThis.onmessage=async({data})=>{
 if(!data||!['load','transcribe'].includes(data.type))return;
 try{
  if(data.type==='load'){await load();return;}
  if(busy)throw Error('dictation_busy');
  if(!(data.audio instanceof Float32Array)||data.audio.length<1600||data.audio.length>16000*65||!['auto','uz','en'].includes(data.language))throw Error('dictation_invalid_audio');
  let energy=0;for(const x of data.audio){if(!Number.isFinite(x))throw Error('dictation_invalid_audio');energy+=x*x;}
  if(Math.sqrt(energy/data.audio.length)<.003)throw Error('dictation_no_speech');
  busy=true;const asr=await load(),options={task:'transcribe',chunk_length_s:30,stride_length_s:5};
  if(data.language!=='auto')options.language=data.language==='uz'?'uzbek':'english';
  const result=await asr(data.audio,options),text=result.text?.trim();
  if(!text)throw Error('dictation_no_speech');if(text.length>4000)throw Error('dictation_text_limit');
  postMessage({type:'result',id:data.id,text});
 }catch(error){postMessage({type:'error',id:data.id,code:/^(asr_asset_|asr_network_|dictation_)/.test(error.message)?error.message:'dictation_unavailable',
   ...(data.diagnostic===true?{diagnostic:String(error.message??error).slice(0,300)}:{})});}
 finally{if(data.type==='transcribe'){if(data.audio instanceof Float32Array)data.audio.fill(0);busy=false;}}
};
