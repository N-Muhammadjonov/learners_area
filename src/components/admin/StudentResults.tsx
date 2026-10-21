import type { Dictionary } from "@/lib/i18n/en";
import { getMockOverview } from "@/lib/data/mocks";
import { summarizeMocks } from "@/lib/progress/mock-summary";
import { MockBandPanel } from "@/components/progress/MockBandPanel";
import { learningSummary, resultHistory } from "@/lib/data/management-statistics";
import { LearningSummary, ResultHistory } from "./LearningResults";
export async function StudentResults({studentId,dict,filter={},baseHref=`/app/teacher/students/${studentId}`}:{studentId:string;dict:Dictionary;filter?:{module?:string;page?:string};baseHref?:string}){
 const [mocks,summary,history]=await Promise.all([getMockOverview(studentId),learningSummary(studentId),resultHistory(studentId,filter.module,Number(filter.page??1))]);
 return <section className="min-w-0 space-y-6" data-student-results>
  {mocks.attemptsUnavailable||mocks.attemptTitlesUnavailable?<p role="alert">{dict.errors.unknown}</p>:<MockBandPanel summary={summarizeMocks(mocks.attempts,mocks.tests.filter(t=>t.skill==='full').map(t=>t.id))} uz={dict.people.name==='Ism'}/>}
  <LearningSummary rows={summary} dict={dict} baseHref={baseHref} selected={history.module}/>
  <ResultHistory history={history} dict={dict} baseHref={baseHref}/>
 </section>;
}
