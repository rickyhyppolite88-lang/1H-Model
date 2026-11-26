import { canonicalLabForecasts, type LabStore, latestHalves } from "./lab";

/** Keep the saved entry and latest observation; the full immutable archive remains separate. */
export function labDisplayStore(store: LabStore): LabStore {
  const selected = new Map(
    canonicalLabForecasts(store.forecasts, store.entryPolicy).map((row) => [
      row.id,
      row,
    ]),
  );
  const latest = new Map<string, LabStore["forecasts"][number]>();
  for (const row of store.forecasts) {
    const key = `${row.season}:${row.methodId}:${row.gameId}`;
    const old = latest.get(key);
    if (
      !old ||
      Date.parse(row.recordedAt) > Date.parse(old.recordedAt) ||
      (Date.parse(row.recordedAt) === Date.parse(old.recordedAt) &&
        row.version > old.version)
    )
      latest.set(key, row);
  }
  for (const row of latest.values()) selected.set(row.id, row);
  const results = new Map<string, LabStore["results"][number]>();
  for (const row of [...store.results].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt),
  ))
    results.set(`${row.season}:${row.gameId}`, row);
  return {
    ...store,
    forecasts: [...selected.values()].sort(
      (a, b) =>
        a.recordedAt.localeCompare(b.recordedAt) || a.version - b.version,
    ),
    results: [...results.values()],
    halves: latestHalves(store.halves),
  };
}
