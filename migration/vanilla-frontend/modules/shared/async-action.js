import {beginActionMeasurement} from '../../js/diagnostics.js';
import {Button} from './presentation.js';
/** Native mount-owned counterpart to the source hook; no hook/runtime emulation. */
export function createAsyncAction({signal,onPending=()=>{},beginMeasurement,finishMeasurement,category='mutation'}={}){let pending=false;const measure=(fn,...args)=>{try{return fn?.(...args)??null;}catch{return null;}};category=['local','navigation','data-view','mutation','destructive','external'].includes(category)?category:'mutation';
 return {get pending(){return pending;},async run(action){if(pending||signal?.aborted)return;pending=true;let measurement=null;const complete=beginActionMeasurement(category,signal);try{onPending(true);measurement=measure(beginMeasurement,category,'button');const value=await action();if(signal?.aborted)return;complete('success');measure(finishMeasurement,measurement,'success');return value;}catch(error){complete('failure');if(!signal?.aborted)measure(finishMeasurement,measurement,'failure');throw error;}finally{pending=false;if(!signal?.aborted)onPending(false);}}};
}
export function AsyncActionButton({pending=false,pendingLabel,children,disabled,...props}){return Button({...props,disabled:disabled||pending,'aria-busy':pending||undefined,'data-interaction-type':'mutation',children:pending&&pendingLabel?pendingLabel:children});}
