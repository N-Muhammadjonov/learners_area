import {el} from '../../js/dom.js';
import {field,formSubmit,errorNode} from '../shared/forms.js';
export function renderOnboarding(context){const {dict,locale,signal,navigate}=context;
 const form=el('form',{class:'grid grid-cols-1 gap-5 sm:grid-cols-2'}),inputs={};
 const options={preferredLanguage:[['uz',"O'zbek"],['en','English']],currentLevel:['A2','B1','B2','C1','C2'].map(v=>[v,v]),strongestSkill:['listening','reading','writing','speaking'].map(v=>[v,dict.nav[v]]),weakestSkill:['listening','reading','writing','speaking'].map(v=>[v,dict.nav[v]])};
 const defaults={preferredLanguage:locale,currentLevel:'B1',currentBand:'',targetBand:'7',examDate:'',dailyStudyMinutes:'60',strongestSkill:'reading',weakestSkill:'writing'};
 for(const name of ['preferredLanguage','currentLevel','currentBand','targetBand','examDate','dailyStudyMinutes','strongestSkill','weakestSkill']){
  if(options[name]){const select=el('select',{id:name,name,class:'input'},options[name].map(([value,label])=>el('option',{value},label)));select.value=defaults[name];inputs[name]=select;form.append(el('div',{},el('label',{for:name,class:'mb-1.5 block text-sm font-medium text-ink-700'},dict.onboarding[name]),select));}
  else{const attrs=name==='examDate'?{type:'date'}:name==='dailyStudyMinutes'?{type:'number',min:5,max:600,required:true}:{type:'number',min:name==='targetBand'?4:0,max:9,step:.5,required:name==='targetBand'};const f=field(dict.onboarding[name],name,attrs);f.input.value=defaults[name];inputs[name]=f.input;form.append(f.node);}
 }
 const error=errorNode(),button=el('button',{type:'submit',class:'btn-primary w-full'},dict.onboarding.finish);form.append(el('div',{class:'sm:col-span-2'},error,button));
 formSubmit({form,button,error,dict,signal,endpoint:'/api/onboarding',body:()=>Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,['currentBand','examDate'].includes(key)?input.value||undefined:input.value])),success:()=>navigate('/app')});
 return el('div',{class:'flex min-h-dvh items-center justify-center bg-paper-sunken p-4'},el('div',{class:'w-full max-w-xl'},el('div',{class:'card p-6'},el('h1',{class:'font-display text-xl text-ink-900'},dict.onboarding.title),el('p',{class:'mt-1 text-sm text-ink-500'},dict.onboarding.subtitle),el('div',{class:'mt-6'},form))));
}
