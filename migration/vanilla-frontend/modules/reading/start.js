import {el} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {Button} from '../shared/presentation.js';
import {failure} from '../../js/request-errors.js';
/** Original src/components/reading/StartPassageButton.tsx. One request: POST the set (Academic) or the passage
 * (General/practice), then open the attempt. Pending always clears, and a failure is shown, never swallowed. */
export function startPassageButton(context,{passageId,setId,label,requestedType,variant='secondary'}){
 const {dict,signal}=context;
 const wrap=el('span',{class:'flex flex-col items-start gap-1'});
 const error=el('span',{class:'text-[0.8125rem] text-band-bad','data-passage-action-error':true});error.hidden=true;
 const button=Button({variant,'data-passage-action':'start',children:label});
 button.addEventListener('click',async()=>{
  button.disabled=true;button.textContent=dict.loadingPage.label;error.hidden=true;
  try{
   const result=await api.request(setId?'/api/reading/academic':'/api/reading/attempts',{method:'POST',body:setId?{setId}:{passageId},signal});
   if(result?.id){
    void context.navigate(`/app/reading/attempts/${result.id}${requestedType?`?type=${encodeURIComponent(requestedType)}`:''}`);
    return;
   }
   error.textContent=dict.errors.unknown;error.hidden=false;
  }catch(e){
   if(signal.aborted)return;
   // Original StartPassageButton: failureMessage(result, dict.auth, { unknown: dict.errors.unknown }).
   error.textContent=failure(e,dict,{unknown:dict.errors.unknown});error.hidden=false;
  }finally{
   if(!signal.aborted){button.disabled=false;button.textContent=label;}
  }
 },{signal});
 wrap.append(button,error);
 return wrap;
}
