/** Overall estimates come only from completed full mocks, never individual skills. */
export function summarizeMocks(attempts, catalogueIds) {
    const finished = attempts.filter((a) => a.skill === "full" && a.finishedAt !== null);
    const points = finished
        .filter((a) => a.estimatedBand !== null &&
        Number.isFinite(a.estimatedBand) &&
        a.estimatedBand >= 0 &&
        a.estimatedBand <= 9)
        .sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime() ||
        a.id.localeCompare(b.id));
    const bands = points.map((a) => a.estimatedBand);
    const eligibleBands = points.filter(a => a.averageEligible !== false).map(a => a.estimatedBand);
    const latest = bands.at(-1) ?? null;
    // Only attempts whose mock is still in the catalogue count towards catalogue
    // progress; a removed mock must not inflate or block it.
    const completed = new Set(finished
        .map((a) => a.mockTestId)
        .filter((id) => id !== null && catalogueIds.includes(id))).size;
    return {
        points,
        completed,
        total: catalogueIds.length,
        attempts: finished.length,
        latest,
        best: bands.length ? Math.max(...bands) : null,
        average: eligibleBands.length
            ? eligibleBands.reduce((sum, n) => sum + n, 0) / eligibleBands.length
            : null,
        change: bands.length >= 2 ? latest - bands[0] : null,
    };
}
