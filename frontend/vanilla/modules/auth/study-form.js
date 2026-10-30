import {el,listen} from '../../js/dom.js';
import {field,formSubmit,errorNode} from '../shared/forms.js';
import {publishSessionEvent} from '../../js/session-events.js';

/** Main's study fields, shared by first-time onboarding and the profile editor. */
export function studyForm(context,{initial={},profile=false}={}){
 const {dict,locale,signal}=context,form=el('form',{class:'grid grid-cols-1 gap-5 sm:grid-cols-2','data-study-form':profile?'profile':'onboarding'}),inputs={};
 const defaults={preferredLanguage:locale,currentLevel:'B1',currentBand:'',targetBand:7,examDate:'',dailyStudyMinutes:60,strongestSkill:'reading',weakestSkill:'writing',...initial};
 const state=context.state??{},draft=state[profile?'profileStudy':'onboarding']??={};
 const options={preferredLanguage:[['uz',"O'zbek"],['en','English']],currentLevel:['A2','B1','B2','C1','C2'].map(v=>[v,v]),strongestSkill:['listening','reading','writing','speaking'].map(v=>[v,dict.nav[v]]),weakestSkill:['listening','reading','writing','speaking'].map(v=>[v,dict.nav[v]])};
 for(const name of ['preferredLanguage','currentLevel','currentBand','targetBand','examDate','dailyStudyMinutes','strongestSkill','weakestSkill']){
  const value=String(draft[name]??defaults[name]??'');
  if(name==='examDate'){
   const hidden=el('input',{type:'hidden',name,id:name,value}),parts=value.split('-'),box=el('fieldset',{},el('legend',{class:'mb-1.5 text-sm font-medium'},dict.onboarding.examDate)),row=el('div',{class:'grid grid-cols-[1fr_1fr_1.4fr] gap-2'}),dates={};inputs[name]=hidden;box.append(row,hidden);
   for(const [key,index,min,max,placeholder]of [['day',2,1,31,'DD'],['month',1,1,12,'MM'],['year',0,1900,2100,'YYYY']]){
    const input=el('input',{class:'input mt-1 w-full',type:'number',inputmode:'numeric','aria-label':dict.profile[key],min,max,placeholder,value:parts[index]??''});dates[key]=input;
    row.append(el('label',{class:'text-xs'},dict.profile[key],input));
    listen(input,'input',()=>{delete draft.saved;saved.remove();draft.examParts=Object.fromEntries(Object.entries(dates).map(([k,n])=>[k,n.value]));syncDate();},signal);
   }
   if(draft.examParts)for(const [key,input]of Object.entries(dates))input.value=draft.examParts[key]??'';
   function syncDate(){const any=Object.values(dates).some(n=>n.value);for(const n of Object.values(dates))n.required=any;
    hidden.value=Object.values(dates).every(n=>n.value)?`${dates.year.value.padStart(4,'0')}-${dates.month.value.padStart(2,'0')}-${dates.day.value.padStart(2,'0')}`:'';draft.examDate=hidden.value;
    const date=new Date(hidden.value+'T00:00:00.000Z'),valid=!hidden.value||Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===hidden.value;dates.day.setCustomValidity(valid?'':dict.onboarding.examDate);
   }syncDate();form.append(box);continue;
  }
  if(options[name]){const select=el('select',{id:name,name,class:'input'},options[name].map(([v,label])=>el('option',{value:v},label)));select.value=value;inputs[name]=select;form.append(el('div',{},el('label',{for:name,class:'mb-1.5 block text-sm font-medium text-ink-700'},dict.onboarding[name]),select));}
  else{const attrs=name==='dailyStudyMinutes'?{type:'number',min:5,max:600,required:true}:{type:'number',min:name==='targetBand'?4:0,max:9,step:.5,required:name==='targetBand'};const f=field(dict.onboarding[name],name,attrs);f.input.value=value;inputs[name]=f.input;form.append(f.node);}
  listen(inputs[name],inputs[name].tagName==='SELECT'?'change':'input',()=>{draft[name]=inputs[name].value;delete draft.saved;saved.remove();},signal);
 }
 const error=errorNode(),saved=el('p',{role:'status',class:'mt-2 text-sm text-band-good'},dict.profile.studySaved),button=el('button',{type:'submit',class:'btn-primary w-full'},profile?dict.profile.saveStudy:dict.onboarding.finish),actions=el('div',{class:'sm:col-span-2'},error,button);form.append(actions);if(draft.saved)actions.append(saved);
 formSubmit({form,button,error,dict,signal,method:profile?'PATCH':'POST',endpoint:profile?'/api/profile/study':'/api/onboarding',body:()=>Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,['currentBand','examDate'].includes(key)?input.value||undefined:input.value])),success:async()=>{draft.saved=true;publishSessionEvent('refresh');context.invalidateSession?.();if(profile){actions.append(saved);await context.refresh();}else await context.navigate('/app');}});
 return form;
}
