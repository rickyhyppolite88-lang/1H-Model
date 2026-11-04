import type { ForecastRecord, RecordStore } from "./predictionRecord";

/** Combine dated archives without counting shared forecast versions or result events twice. */
export function mergeRecordStores(
  stores: RecordStore[],
  updatedAt: string,
): RecordStore {
  const records = new Map<string, ForecastRecord>();
  const results = new Map<string, RecordStore["results"][number]>();
  let latest = updatedAt;
  for (const store of stores) {
    if (Date.parse(store.updatedAt) > Date.parse(latest))
      latest = store.updatedAt;
    for (const record of store.records) {
      const previous = records.get(record.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record))
        throw new Error("Conflicting copies of a saved forecast were found.");
      records.set(record.id, record);
    }
    for (const result of store.results) {
      const previous = results.get(result.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(result))
        throw new Error("Conflicting copies of a result event were found.");
      results.set(result.id, result);
    }
  }
  return {
    schemaVersion: 1,
    updatedAt: latest,
    records: [...records.values()],
    results: [...results.values()].sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
    ),
  };
}
