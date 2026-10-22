import {id,activityFixture,reviewFixture,revisionFixture} from './listening-v8-fixtures.mjs';import {viewFixture} from './fixtures.mjs';
export {id};
export function cases(dict){const review=reviewFixture();review.test.transcript=null;const hub={kind:'hub',test:{id,title:'Synthetic listening',publicationState:'published'},meta:{parts:4,questions:40,min:30},cards:[{path:'1',activity:1,name:dict.fullListeningHub.research.full,tag:dict.fullListeningHub.research.examTag,complete:false,latest:null},{path:'3',activity:3,name:dict.fullListeningHub.research.script,tag:dict.fullListeningHub.research.reviewTag,complete:false,latest:null}]};
const days=[{testId:id,day:8,title:'Synthetic day',questionCount:5,draft:false,locked:false,status:{state:'in_progress',completed:1,total:5}}],day=viewFixture('/app/listening/mcq/day/8').day;
return [{kind:'attempt',route:'/app/listening/attempts/'+id,data:{kind:'review',review},props:review,selector:'[data-listening-native-v7] > div > div'},
{kind:'revision',route:'/app/listening/attempts/'+id+'/revision',data:{kind:'revision',revision:revisionFixture()},props:revisionFixture(),selector:'[data-listening-native-v7] > div > div'},
{kind:'activity',route:'/app/listening/tests/'+id+'/3',data:{kind:'activity',activity:activityFixture(3,{lexical:false})},props:activityFixture(3,{lexical:false}),selector:'[data-listening-native-v7] > div > div'},
{kind:'hub',route:'/app/listening/tests/'+id,data:hub,props:hub,selector:'.listening-hub'},
{kind:'mcq',route:'/app/listening/mcq',data:{days},props:{days,user:{role:'student'}},selector:'[data-route-usable=listening-mcq]'},
{kind:'day',route:'/app/listening/mcq/day/8',data:{day},props:{day,questions:day.questions,activeIndex:0,active:day.questions[0],complete:false,MCQ_FINAL_STAGE:'reasoned'},selector:'[data-route-usable=listening-mcq-day]'}];}
