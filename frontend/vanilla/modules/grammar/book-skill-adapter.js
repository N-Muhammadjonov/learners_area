/* Adapt uploaded Speaking/Writing curricula to the existing native Grammar exercise engine. */
const NAMES={mcq:'mcq',judge:'judge',match:'match',order:'order',bank:'typed',fix:'fix',typed:'typed',transform:'transform',dialogue:'typed',translate:'tr',record:'speak',longtext:'write'};
const INSTRUCTIONS={mcq:'To‘g‘ri javobni tanlang.',judge:'Gap grammatik jihatdan to‘g‘rimi?',match:'O‘zbekcha ma’noga mos inglizcha gapni tanlang.',order:'So‘zlarni to‘g‘ri tartibga qo‘ying.',bank:'Mazmun asosida gapni to‘liq yozing.',fix:'Xatoni tuzating.',typed:'Savolga yozma javob bering.',transform:'Ma’nosini saqlab qayta yozing.',dialogue:'Suhbatni davom ettiring.',translate:'Inglizchaga tarjima qiling.',record:'Javobingizni ovozli yozing.',longtext:'Matnni mustaqil yozing.'};
const INTRO={Tushunish:'Qoidani misollardan aniqlang.',Mustahkamlash:'Shakl va so‘z tartibini mashq qiling.',Qo‘llash:'Qoidani yangi gaplarda ishlating.','Erkin qo‘llash':'Mustaqil javob yarating.'};
const clean=value=>String(value??'').replace(/ELI\s*[- ]?\s*5\s*:\s*/gi,'').replace(/\bELI\s*[- ]?\s*5\b/gi,'').trim();
const unique=items=>Array.from(new Set(items));
const sameWords=(a,b)=>a.length===b.length&&a.slice().sort().join('|')===b.slice().sort().join('|');
function buildExercise(source,group){
 const kind=NAMES[group.type];
 if(!kind)throw Error('Unknown grammar exercise type: '+group.type);
 const result={letter:group.label,kind,instr:INSTRUCTIONS[group.type],note:['typed','dialogue','translate','transform','longtext'].includes(group.type)?'Erkin javoblar uchun bir nechta to‘g‘ri variant bo‘lishi mumkin.':'',strict:false};
 if(kind==='write'){
   if(group.items.length!==1)throw Error('Expected one writing item in '+source.id);
   const item=group.items[0];
   result.placeholder=clean(item.prompt);
   result.min=Number(item.minWords)||35;
   result.model='Namunaviy boshlanish (to‘liq essay emas): '+clean(item.answer);
   result.instr+=' Kamida '+result.min+' ta so‘z yozing.';
   return result;
 }
 result.items=group.items.map(item=>{
   const q=clean(item.prompt),a=clean(item.answer);
   if(kind==='mcq'){
     const opts=(item.options||[]).map(clean);
     if(!opts.includes(a))throw Error('Missing correct option in '+source.id);
     return {q,opts,a};
   }
   if(kind==='judge'){
     const good=['to‘g‘ri',"to'g'ri",'true'].includes(a.toLowerCase());
     return {q,t:good,fix:!good&&/^Because\s+/i.test(q)?q.replace(/^Because\s+/i,''):''};
   }
   if(kind==='match')return {l:q,r:a};
   if(kind==='order'){
     let words=q.slice(q.lastIndexOf(':')+1).trim().split(' / ');
     if(!sameWords(words,a.split(/\s+/)))words=a.split(/\s+/).reverse();
     return {words,a:[a]};
   }
   if(kind==='speak')return {q,a:[a]};
   return {q,a:[a]};
 });
 if(kind==='match'){
   result.rights=unique(group.items.flatMap(item=>(item.options||[]).map(clean)));
   for(const item of result.items)if(!result.rights.includes(item.r))result.rights.push(item.r);
 }
 return result;
}
function visualUri(raw,visuals){
 const figure=visuals?.[raw.visual_type];
 if(!figure)return undefined;
 const found=figure.match(/<svg\b[\s\S]*?<\/svg>/i);
 if(!found)return undefined;
 const markup=found[0]
   .replace(/<script\b[\s\S]*?<\/script>/gi,'')
   .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi,'')
   .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi,'')
   .replace(/\s+(?:href|xlink:href)\s*=\s*"[^"]*"/gi,'');
 return 'data:image/svg+xml,'+encodeURIComponent(markup);
}
export function adaptSkillUnit(raw,visuals={}){
 const points=[clean(raw.simple_explanation),clean(raw.specific_rule),...(raw.steps||[]).map(clean),...(raw.deep_rules||[]).slice(0,12).map(clean),...(raw.warnings||[]).map(clean)];
 if(raw.practice_qa?.length){
   points.push('IELTS Speaking savol-javob namunalari:');
   for(const qa of raw.practice_qa)points.push([qa.part,qa.question,qa.answer].filter(Boolean).join(' — '));
 }
 const rule={title:clean(raw.title),table:[['QOIDA','QOLIP','QO‘LLANISH'],['Asosiy tuzilma',clean(raw.formula),clean(raw.specific_rule)]],points:points.filter(Boolean),examples:(raw.examples||[]).map(item=>[clean(item.en),clean(item.uz)])};
 const stages=raw.stages.map((stage,index)=>({n:String(index+1),name:stage.title,sub:INTRO[stage.title]||'',ex:stage.groups.map(group=>buildExercise(raw,group))}));
 if(stages.length!==4||stages.some(stage=>stage.ex.length!==3))throw Error('Incomplete lesson '+raw.id);
 const result={id:raw.id,code:raw.group,title:clean(raw.title),lessons:String(raw.number),rule,stages};
 const img=visualUri(raw,visuals);
 if(img)result.img=img;
 return result;
}
