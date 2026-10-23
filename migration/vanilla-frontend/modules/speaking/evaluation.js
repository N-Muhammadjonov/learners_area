import {el} from '../../js/dom.js';
/** Exact learner-facing, non-staff attribution. Source: EvaluationView.tsx. */
const PUBLIC_CHECKED_BY='RIWI';
const card=(...children)=>el('section',{class:'card flex flex-col gap-2 p-4'},...children);
function listCard(title,items){return Array.isArray(items)&&items.length?card(el('h3',{class:'text-xs font-medium uppercase tracking-wide text-ink-300'},title),el('ul',{class:'list-inside list-disc space-y-1 text-sm text-ink-500'},items.map(i=>el('li',{},i)))):null;}
export function evaluationView(dict,e){
 const t=dict.coach,wrap=el('section',{class:'flex flex-col gap-4','data-evaluated-by':PUBLIC_CHECKED_BY});
 const band=typeof e.overallEstimate==='number'&&Number.isFinite(e.overallEstimate);
 const verdict=e.verdict==='correct'?t.verdicts.correct:e.verdict==='mostly_correct'?t.verdicts.mostly_correct:e.verdict==='needs_correction'?t.verdicts.needs_correction:'';
 wrap.append(card(el('span',{class:'text-xs uppercase tracking-wide text-ink-300'},band?t.estimatedBand:t.overallVerdict),el('strong',{class:'font-display text-4xl text-ink-900'},band?e.overallEstimate.toFixed(1):verdict),el('span',{class:'text-xs text-ink-500'},`${t.confidence}: ${Math.round((e.confidence??0)*100)}%`),el('span',{class:'text-xs text-ink-300'},t.automatedNotice)));
 if(e.fallbackUsed)wrap.append(card(el('p',{class:'text-xs text-signal-700'},t.fallbackNotice)));
 if(e.criteria?.length){const list=card(el('h3',{class:'text-xs font-medium uppercase tracking-wide text-ink-300'},t.criteria));
  for(const c of e.criteria)list.append(el('div',{class:'flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 py-2'},el('div',{class:'flex flex-col'},el('p',{class:'text-sm text-ink-700'},t.criterionLabels?.[c.key]??c.label),c.note?el('p',{class:'text-xs text-ink-500'},c.note):null),el('span',{class:c.limited||c.band==null?'badge-locked':'badge'},c.limited||c.band==null?t.limited:String(c.band))));wrap.append(list);
 }
 if(e.issues?.length){const list=card(el('h3',{class:'text-xs font-medium uppercase tracking-wide text-ink-300'},t.issues));for(const issue of e.issues)list.append(el('article',{class:'flex flex-col gap-1'},el('p',{class:'text-xs font-medium text-ink-500'},`${t.categoryLabels?.[issue.category]??issue.category} · ${issue.severity}`),el('p',{class:'text-sm text-ink-900'},issue.message),issue.excerpt?el('p',{class:'rounded-sm bg-paper-sunken p-2 font-mono text-xs text-ink-700'},issue.excerpt):null,issue.suggestion?el('p',{class:'text-xs text-ink-500'},`${t.suggestion}: ${issue.suggestion}`):null));wrap.append(list);}
 const strengths=listCard(t.strengths,e.strengths),weaknesses=listCard(t.weaknesses,e.weaknesses),actions=listCard(t.nextActions,e.nextActions);
 const paired=el('div',{class:'grid gap-4 sm:grid-cols-2'},strengths,weaknesses);if(strengths||weaknesses)wrap.append(paired);if(actions)wrap.append(actions);
 if(e.recommendedExercises?.length){const r=card(el('h3',{class:'text-xs font-medium uppercase tracking-wide text-ink-300'},t.recommended));for(const x of e.recommendedExercises)r.append(el('article',{class:'flex flex-col gap-1'},x.href&&typeof x.href==='string'&&x.href.startsWith('/app/')?el('a',{href:x.href,class:'btn-secondary'},x.label):el('span',{class:'text-sm font-medium text-ink-900'},x.label),x.reason?el('p',{class:'text-xs text-ink-500'},x.reason):null));wrap.append(r);}
 wrap.append(el('footer',{class:'flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300'},el('span',{},`${t.processedIn} ${e.processedInMs}ms`),el('span',{'data-checked-by':PUBLIC_CHECKED_BY,class:'badge bg-signal-100 text-signal-700'},`${t.checkedBy} ${PUBLIC_CHECKED_BY}`)));
 return wrap;
}
