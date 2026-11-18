import { canonicalLabForecasts, gradeLab, type LabStore } from "./lab";
import {
  isAllForecastPaperMethod,
  isRefereeLabMethod,
  isStakedLabStatus,
} from "./labVersions";

export function refereeForecastResults(store: LabStore) {
  const canonical = canonicalLabForecasts(
    store.forecasts,
    store.entryPolicy,
  ).filter((row) => isRefereeLabMethod(row.methodId));
  const selected = new Map<string, (typeof canonical)[number]>();
  for (const row of canonical) {
    if (row.research?.probability == null) continue;
    const key = `${row.season}:${row.gameId}`;
    const old = selected.get(key);
    if (!old || isAllForecastPaperMethod(row.methodId)) selected.set(key, row);
  }
  const rows = [...selected.values()].flatMap((row) => {
    if (
      !isRefereeLabMethod(row.methodId) ||
      !row.research ||
      row.line === null ||
      !row.side ||
      row.side === "PUSH"
    )
      return [];
    const result = gradeLab(row, store);
    const probability = row.research.probability,
      baseline = row.research.refereeBaselineProbability,
      market = row.research.marketProbability;
    if (
      result.actual === null ||
      result.error === null ||
      result.actual === row.line ||
      probability === null ||
      baseline === null ||
      market === null
    )
      return [];
    const win = Number(result.actual > row.line === (row.side === "OVER"));
    return [
      {
        officials: row.research.crew.map((r) => r.id),
        v3: (baseline - win) ** 2,
        v4: (probability - win) ** 2,
        market: ((row.side === "OVER" ? market : 1 - market) - win) ** 2,
        qualified: isStakedLabStatus(row.status),
        win,
      },
    ];
  });
  const summary = (selected: typeof rows) => ({
    games: selected.length,
    v3Brier: selected.length
      ? selected.reduce((n, r) => n + r.v3, 0) / selected.length
      : null,
    v4Brier: selected.length
      ? selected.reduce((n, r) => n + r.v4, 0) / selected.length
      : null,
    marketBrier: selected.length
      ? selected.reduce((n, r) => n + r.market, 0) / selected.length
      : null,
    qualifiedWins: selected.filter((r) => r.qualified && r.win).length,
    qualifiedLosses: selected.filter((r) => r.qualified && !r.win).length,
  });
  return {
    overall: summary(rows),
    officials: Object.fromEntries(
      [...new Set(rows.flatMap((r) => r.officials))].map((id) => [
        id,
        summary(rows.filter((r) => r.officials.includes(id))),
      ]),
    ),
  };
}
