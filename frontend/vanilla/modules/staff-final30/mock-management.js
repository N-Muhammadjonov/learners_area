/** Weekly Mock management landing: authoring and grading are separate workspaces. */
import {el} from './kit.js';

const COPY = {
  uz: {title:'Mock Tests',sub:'Haftalik IELTS Mock imtihonlarini boshqarish',
    create:'Mock yaratish',createHelp:'Imtihon tuzish, rasmiy materiallarni ulash va nashr qilish',
    grade:'Mock tekshirish',gradeHelp:'Writing va Speaking baholarini import qilish, tekshirish va e’lon qilish'},
  en: {title:'Mock Tests',sub:'Manage weekly IELTS Mock examinations',
    create:'Create Mock',createHelp:'Compose exams, bind published materials and publish',
    grade:'Grade Mock',gradeHelp:'Import, review and publish Writing and Speaking scores'},
};

export async function mount(ctx){
  if (!['teacher','owner'].includes(ctx.session?.user?.role)) {
    void ctx.navigate('/app/management',{replace:true});return;
  }
  const L=COPY[ctx.locale==='uz'?'uz':'en'];
  const card=(href,title,body)=>el('a',{href,
    class:'panel group flex min-h-[150px] flex-col gap-3 transition-colors hover:border-gold/45 hover:bg-paper-sunken',
    'data-mock-management-link':href},
    el('h2',{class:'card-title'},title),
    el('p',{class:'body-text flex-1'},body),
    el('span',{class:'text-sm font-medium text-ink-500 group-hover:text-ink-900'},'→'));
  ctx.root.append(el('div',{class:'flex flex-col gap-6','data-mock-management-home':''},
    el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},L.title),
      el('p',{class:'mt-1 text-sm text-ink-500'},L.sub)),
    el('div',{class:'grid grid-cols-1 gap-5 md:grid-cols-2'},
      card('/app/management?view=mock-create',L.create,L.createHelp),
      card('/app/management?view=mock-grading',L.grade,L.gradeHelp))));
}
