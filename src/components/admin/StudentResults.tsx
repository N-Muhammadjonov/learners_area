import type { Dictionary } from "@/lib/i18n/en";
import { getMockOverview } from "@/lib/data/mocks";
import { summarizeMocks } from "@/lib/progress/mock-summary";
import { MockBandPanel } from "@/components/progress/MockBandPanel";
import { learningSummary, resultHistory, retentionSummary } from "@/lib/data/management-statistics";
import { LearningSummary, ResultHistory } from "./LearningResults";
export async function StudentResults({studentId,dict,filter={},baseHref=`/app/teacher/students/${studentId}`}:{studentId:string;dict:Dictionary;filter?:{module?:string;page?:string};baseHref?:string}){
 const [mocks,summary,history,retention]=await Promise.all([getMockOverview(studentId),learningSummary(studentId),resultHistory(studentId,filter.module,Number(filter.page??1)),retentionSummary(studentId)]);
 const t=dict.managementStats;
 const rounds=retention.reduce((n,r)=>n+r.rounds,0),average=rounds?retention.reduce((n,r)=>n+(r.average??0)*r.rounds,0)/rounds:null;
 return <section className="min-w-0 space-y-6" data-student-results>
  {mocks.attemptsUnavailable||mocks.attemptTitlesUnavailable?<p role="alert">{dict.errors.unknown}</p>:<MockBandPanel summary={summarizeMocks(mocks.attempts,mocks.tests.filter(t=>t.skill==='full').map(t=>t.id))} uz={dict.people.name==='Ism'}/>}
  <section className="card space-y-3 p-5" data-student-retention><h2 className="font-display text-2xl">{t.retention}</h2><p>{t.average}: {average==null?"—":`${average.toFixed(1)}%`} · {t.completed}: {rounds}</p>{!retention.length?<p>{t.empty}</p>:<div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>{t.levels}</th><th>{t.completed}</th><th>{t.average}</th><th>{t.best}</th></tr></thead><tbody>{retention.map(r=><tr key={r.level}><th className="py-3 text-left">{r.level}</th><td>{r.rounds}</td><td>{r.average?.toFixed(1)??'—'}%</td><td>{r.best??'—'}%</td></tr>)}</tbody></table></div>}</section>
  <LearningSummary rows={summary} dict={dict} baseHref={baseHref} selected={history.module}/>
  <ResultHistory history={history} dict={dict} baseHref={baseHref}/>
 </section>;
}
