/** Port of the original lib/progress/mock-summary.ts. Presentation arithmetic over server-stored
 * estimates only: never grading. Overall estimates come only from completed FULL mocks. */
export function summarizeMocks(attempts, catalogueIds) {
  const finished = attempts.filter(a => a.skill === 'full' && a.finishedAt !== null);
  const points = finished
    .filter(a => a.estimatedBand !== null && Number.isFinite(a.estimatedBand) && a.estimatedBand >= 0 && a.estimatedBand <= 9)
    .sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime() || a.id.localeCompare(b.id));
  const bands = points.map(a => a.estimatedBand);
  const latest = bands.at(-1) ?? null;
  // A removed mock must neither inflate nor block catalogue progress.
  const completed = new Set(
    finished.map(a => a.mockTestId).filter(id => id !== null && catalogueIds.includes(id)),
  ).size;
  return {
    points,
    completed,
    total: catalogueIds.length,
    attempts: finished.length,
    latest,
    best: bands.length ? Math.max(...bands) : null,
    average: points.some(a=>a.averageEligible!==false) ? points.filter(a=>a.averageEligible!==false).reduce((sum,a)=>sum+a.estimatedBand,0)/points.filter(a=>a.averageEligible!==false).length : null,
    change: bands.length >= 2 ? latest - bands[0] : null,
  };
}
