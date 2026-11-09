/** V63: Original Next.js /app/listening/tests/page.tsx.
 * Academic full-test catalogue uses exactly the same source service as the Academic listing,
 * but keeps the /tests/:id destination rather than substituting /academic/:id.
 * The existing Arena read adapter is proposed: no fake test or learner state on failure.
 */
import {answerProgress} from '../shared/progress.js';
import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {academicCatalogueDTO} from '../../js/adapters/listening-v10.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {EmptyState} from '../../js/generated/ui.js';
import {listeningAudio} from './audio-preload.js';

export function testsHref(testId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId))
    throw new TypeError('Invalid test UUID');
  return `/app/listening/tests/${testId}`;
}
export function catalogueModel(raw) { return academicCatalogueDTO(raw); }

export function mount(ctx) {
  const {root,signal,dict,url}=ctx;
  const t=dict.listening.academic;
  const host=el('div',{'data-native-view':'listening-tests','data-route-usable':'listening-academic',class:'mx-auto flex w-full max-w-6xl flex-col gap-5'});
  root.append(host);
  let ticket=0;
  let pending=false;
  const audioLabels=new Map(),uz=document.documentElement.lang.startsWith('uz');
  function audioStatus(value){
    const node=audioLabels.get(value.id);if(!node)return;
    const percent=value.total?Math.min(100,Math.floor(value.loaded/value.total*100)):0;
    node.replaceChildren(document.createTextNode(value.state==='ready'?(uz?'Audio tayyor':'Audio ready'):
      value.state==='error'?(uz?'Audio yuklanmadi. ':'Audio could not load. '):
      value.state==='loading'?(uz?'Audio yuklanmoqda':'Downloading audio')+(percent?' · '+percent+'%':''):
      value.state==='queued'?(uz?'Audio yuklash navbatida':'Audio queued'):''));
    if(value.state==='error'){
      const retry=el('button',{type:'button',class:'underline'},dict.errorPage.retry);
      retry.addEventListener('click',()=>listeningAudio.retry(value.id),{signal});node.append(retry);
    }
  }
  const stopAudioStatus=listeningAudio.subscribe(audioStatus);
  function loading(){host.replaceChildren(el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,'data-async-loading':'listening-academic-catalogue',class:'grid gap-4'},
    el('div',{class:'h-12 animate-pulse rounded bg-ink-50'}),el('div',{class:'h-28 animate-pulse rounded bg-ink-50'})));}
  function render({cards,total,page,hasMore}) {
    audioLabels.clear();
    const heading=el('p',{class:'text-sm text-ink-500','data-listening-test-count':''},t.catalogueCount.replace('{n}',String(total)));
    if(!cards.length){host.replaceChildren(heading,EmptyState({icon:'◉',title:t.emptyTitle,body:t.emptyHint,'data-listening-academic-empty':''}));return;}
    const grid=el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4','data-listening-academic-grid':''});
    for(const card of cards){
      const meta=el('p',{class:'text-xs text-ink-300'},
        el('span',{'data-listening-academic-card-parts':''},t.parts.replace('{n}',String(card.parts))),' · ',
        el('span',{'data-listening-academic-card-questions':''},t.questions.replace('{n}',String(card.questions))));
      if(card.minutes!==null)meta.append(' · ',el('span',{},String(card.minutes),' ',t.minutes));
      const progress=el('p',{class:'text-xs text-ink-500','data-listening-academic-card-progress':''},
        t.activitiesLabel.replace('{done}',String(card.completed)).replace('{total}',String(card.activityCount)));
      const exam=card.exam?
        el('p',{class:'text-xs text-ink-500','data-listening-academic-card-exam':''},t.examResult.replace('{score}',String(card.exam.score??'—')).replace('{total}',String(card.exam.total??'—'))):
        null;
      const audio=card.locked?null:el('p',{class:'text-xs text-ink-500','data-listening-audio':card.testId,'aria-live':'polite'});
      if(audio){audioLabels.set(card.testId,audio);audioStatus(listeningAudio.status(card.testId));}
      const last=card.locked?
        el('div',{class:'mt-auto space-y-2','data-listening-test-locked':''},
          el('button',{type:'button',class:'btn-secondary px-3 py-2 text-sm',disabled:true},'🔒 ',t.locked),
          el('p',{class:'text-xs text-ink-500'},t.lockedHint)):
        el('a',{href:testsHref(card.testId),class:'btn-primary mt-auto self-start px-3 py-2 text-sm','data-listening-academic-open':''},card.started?t.open:t.openTest);
      grid.append(el('article',{class:'card min-w-0 p-4','data-listening-academic-card':card.testId},
        el('div',{class:'flex h-full flex-col gap-2'},el('h2',{class:'min-w-0 text-base font-semibold leading-snug text-ink-900'},card.title),meta,answerProgress({state:card.answerProgress?.state??'not_started',done:card.answerProgress?.answeredCount,total:card.answerProgress?.totalQuestions,label:card.answerProgress?.state==='completed'?t.complete:card.answerProgress?.state==='in_progress'?dict.readingHub.stateInProgress:t.noProgress,attrs:{'data-listening-answer-progress':''}}),progress,exam,audio,last)));
    }
    host.replaceChildren(heading,grid);
    if(page>1||hasMore){const nav=el('nav',{class:'flex justify-between gap-3'});if(page>1)nav.append(el('a',{href:`/app/listening/tests?page=${page-1}`,class:'btn-secondary'},dict.people.previousPage));if(hasMore)nav.append(el('a',{href:`/app/listening/tests?page=${page+1}`,class:'btn-secondary'},dict.people.nextPage));host.append(nav);}
  }
  async function load(){const current=++ticket;if(signal.aborted||pending)return;pending=true;loading();
    try{
      // Source uses academicListeningCards for both /listening/tests and /listening/academic.
      // Reuse the established Arena projection and validate its exact DTO.
      const page=url.searchParams.get('page');
      const data=catalogueModel(await viewData('/app/listening/academic'+(page?'?page='+encodeURIComponent(page):''),signal));
      if(signal.aborted||ticket!==current)return;
      render(data);
      // Catalogue navigation does not download complete private recordings.
      // Opening a selected test acquires its audio with fresh server authority.
    }catch(e){if(signal.aborted||ticket!==current)return;
      if(e?.status===401){void ctx.navigate('/login',{replace:true});return;}
      host.replaceChildren(RegionFailureNotice({region:'listening-tests',message:dict.auth.errorServer,retryLabel:dict.errorPage.retry,refresh:load}));
    }finally{pending=false;}
  }
  signal.addEventListener('abort',()=>{ticket++;stopAudioStatus();audioLabels.clear();host.replaceChildren();},{once:true});
  void load();
}
