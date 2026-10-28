/** The original source's completed FULL mock aggregate; never combine skill-only bands.
 * src/lib/progress/mock-summary.ts @ main b62b78f. */
const SKILLS = Object.freeze(['reading','listening','speaking','writing']);
export function summarize(attempts, catalogueIds) {
 const finished = attempts.filter(a => a.skill === 'full' && a.finishedAt instanceof Date);
 const points = finished.filter(a => typeof a.estimatedBand === 'number' && Number.isFinite(a.estimatedBand) && a.estimatedBand >= 0 && a.estimatedBand <= 9)
  .sort((a,b) => a.finishedAt.getTime() - b.finishedAt.getTime() || a.id.localeCompare(b.id));
 const bands = points.map(a => ({id:a.id,value:a.estimatedBand,date:a.finishedAt,title:a.title,skill:a.skill}));
 const values = points.map(a => a.estimatedBand), latest = values.at(-1) ?? null;
 const visible = new Set(catalogueIds);
 const complete = new Set(finished.filter(a => a.mockTestId != null && visible.has(a.mockTestId)).map(a=>a.mockTestId)).size;
 const skillFinished = attempts.filter(a => SKILLS.includes(a.skill) && a.finishedAt instanceof Date).sort((a,b) => a.finishedAt.getTime() - b.finishedAt.getTime() || a.id.localeCompare(b.id));
 return {finished,bands,latest,best:values.length?Math.max(...values):null,
  average:points.some(a=>a.averageEligible!==false)?points.filter(a=>a.averageEligible!==false).reduce((s,a)=>s+a.estimatedBand,0)/points.filter(a=>a.averageEligible!==false).length:null,
  improvement:values.length>=2?latest-values[0]:null,total:catalogueIds.length,complete,
  chart:bands.slice(-12),skillFinished};
}
