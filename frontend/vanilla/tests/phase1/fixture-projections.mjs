// Isolated UI QA. Shapes and examples reuse fixtures.mjs, v63-four, reading-source-cd,
// browser-reading-v45, dashboard-v3 and browser-progress-v54. Never production data.
import {fixtureSession,viewFixture,publicPolicy,mock} from '../fixtures.mjs';
export const ID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function projection(route,region,empty=false){
 const path=route.split('?')[0];
 if(['/app','/app/dashboard'].includes(path))return viewFixture('/app');
 if(['/app/listening/tests','/app/listening/academic'].includes(path))return {cards:empty?[]:Array.from({length:6},(_,i)=>({testId:ID(i+1),title:`Synthetic Listening Test ${i+1}`,parts:4,questions:40,minutes:30,completed:i===1?2:i===2?5:0,activityCount:5,started:i===1,locked:i>3,exam:null,answerProgress:{state:['not_started','in_progress','completed'][i%3],answeredCount:i===1?12:i===2?40:0,totalQuestions:40}})),total:empty?0:6};
 if(path==='/app/reading/academic')return {sets:empty?[]:Array.from({length:6},(_,i)=>({id:ID(i+1),title:`Synthetic Reading Test ${i+1}`,locked:i>3,assessmentStatus:['not_started','in_progress','completed'][i%3],attemptId:i===1?ID(99):null,answeredCount:i===1?12:i===2?40:0,totalQuestions:40,passages:[{passageNo:1,title:'Synthetic passage one'},{passageNo:2,title:'Synthetic passage two'},{passageNo:3,title:'Synthetic passage three'}]}))};
 if(path==='/app/writing')return {lessons:empty?[]:Array.from({length:6},(_,i)=>({id:ID(i+1),title:`Synthetic writing lesson ${i+1}`,category:'task2',summary:'Isolated presentation fixture. This is not learning content.',durationMinutes:20,completedAt:i===2?'2026-10-01':null}))};
 if(path==='/app/listening/attempts/'+ID(88))return {kind:'exam',exam:{attemptId:ID(88),testId:ID(1),title:'Synthetic listening exam',audioUrl:'/api/resources/synthetic.mp3',imageUrl:null,questions:[{id:ID(87),number:1,section:1,text:'Synthetic question',instruction:'Choose TWO',options:['A one','B two','C three','D four','E five'],input:'multi'}],initial:{},audioPosition:0,audioStartedAt:null,duration:60}};
 if(path==='/app/progress'){
  const byState={new:0,learning:0,review:0,known:0,mastered:0,activated:0};
  return {progressSummary:{reading:{attempts:0,submitted:0,score:0,total:0,accuracy:null},listening:{attempts:0,submitted:0,score:0,total:0,accuracy:null},speaking:{attempts:0,submitted:0,transcribed:0},writing:{submissions:0,latestBand:null,latestEvaluationAt:null,lastSubmittedAt:null,evaluationUnavailable:false},vocabulary:{total:0,due:0,byState},lessons:{total:0,open:0,inProgress:0,completed:0},assignments:{total:0,open:0,completed:0},mocks:{attempts:0,finished:0,bestBand:null},unavailableRegions:[]},progressStreak:{streak:0},progressTrends:{reading:[],listening:[],writing:[],speaking:[],heatmap:[],retention:[]},progressMocks:mock};
 }
 if(path==='/app/reading/attempts/'+ID(99))return {kind:'attempt',detail:{attempt:{id:ID(99),status:'in_progress',startedAt:new Date().toISOString(),score:null,totalQuestions:null},passage:{title:'Synthetic passage',bodyText:'Paragraph A text. Water boils at one hundred degrees.',suggestedMinutes:20,testNo:null,passageNo:null,difficultyLevel:'B2'},sections:[],groups:[{id:ID(98),position:1,typeCode:'sentence_completion',instructionsText:'Complete the sentence.',fromQuestionNo:1,toQuestionNo:1,sharedChoices:[]}],paragraphs:[],questions:[{id:ID(97),groupId:ID(98),questionNo:1,order:1,type:'short_answer',typeCode:'sentence_completion',questionText:'Water boils at ___ degrees.',options:null,answerConstraint:{max_words:2}}],answers:[],occurrences:[]}};
 return viewFixture(path);
}
export function fixtureReply(url,cookie='',referer='http://fixture.invalid'){
 const p=url.pathname,role=new URL(referer).searchParams.get('qa_role')||'owner';
 if(p==='/api/frontend/session')return fixtureSession(role);
 if(p==='/api/frontend/public')return publicPolicy;
 if(p==='/api/auth/state')return {role,accountStatus:'active',expiresAt:Math.floor(Date.now()/1000)+3600};
 if(p==='/api/notifications')return {notifications:[],unread:0};
 if(p==='/api/frontend/view')return {version:1,route:url.searchParams.get('route'),data:projection(url.searchParams.get('route')||'/app',url.searchParams.get('region'),new URL(referer).searchParams.get('qa_empty')==='1')};
 if(p==='/api/vocabulary/summary')return {ok:true,summary:{total:0,due:0,byMastery:{},bySource:{}}};
 if(p==='/api/vocabulary/folders')return {ok:true,folders:[]};
 if(p==='/api/vocabulary/packs')return {ok:true,packs:[]};
 if(p==='/api/vocabulary')return {ok:true,words:[],hasMore:false};
 if(p==='/api/vocabulary/leaderboard')return {points:0,rank:null,streak:0,top:[],awards:[],awardsUnavailable:false};
 if(p==='/api/speaking/practice/facets')return {parts:[{part:'part1',count:0},{part:'part2',count:0},{part:'part3',count:0}]};
 return undefined;
}
