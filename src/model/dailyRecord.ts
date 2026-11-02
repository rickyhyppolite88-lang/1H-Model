import { z } from "zod";
import type { ForecastRecord, RecordStore } from "./predictionRecord";

export const dailyCoverageSchema = z.object({
  games: z.number().int().min(0),
  projected: z.number().int().min(0),
  unavailable: z.number().int().min(0),
  counted: z.number().int().min(0),
  unpriced: z.number().int().min(0),
  historical: z.number().int().min(0),
  noLean: z.number().int().min(0),
  otherPregame: z.number().int().min(0),
  withResults: z.number().int().min(0),
});
export type DailyCoverage = z.infer<typeof dailyCoverageSchema>;

/** One visible row per game: counted forecast first, otherwise the best saved estimate. */
export function dailyRecordGames(
  records: ForecastRecord[],
  canonicalIds: string[],
) {
  const ids = new Set(canonicalIds);
  const games = new Map<string, ForecastRecord>();
  const priority = (r: ForecastRecord) =>
    ids.has(r.id)
      ? 3
      : r.prediction.projectedFirstHalfTotal === null
        ? 0
        : r.state === "pregame"
          ? 2
          : 1;
  for (const r of records) {
    const key = `${r.season}:${r.gameDate}:${r.gameId}`;
    const previous = games.get(key);
    if (
      !previous ||
      priority(r) > priority(previous) ||
      (priority(r) === priority(previous) &&
        (Date.parse(r.recordedAt) > Date.parse(previous.recordedAt) ||
          (r.recordedAt === previous.recordedAt &&
            r.version > previous.version)))
    )
      games.set(key, r);
  }
  return [...games.values()].sort(
    (a, b) =>
      a.prediction.startsAt.localeCompare(b.prediction.startsAt) ||
      a.gameId.localeCompare(b.gameId),
  );
}

export function dailyRecordStatus(
  record: ForecastRecord,
  canonicalIds: Set<string>,
) {
  if (canonicalIds.has(record.id)) return "Counted pregame";
  if (record.prediction.projectedFirstHalfTotal === null)
    return "Missing model inputs";
  if (record.state !== "pregame") return "Historical estimate";
  if (record.comparison.line === null) return "No recorded line";
  if (!record.comparison.lean || record.comparison.lean === "PUSH")
    return "No model lean";
  return "Other pregame version";
}

export function dailyRecordCoverage(
  store: RecordStore,
  canonicalIds: string[],
): DailyCoverage {
  const records = dailyRecordGames(store.records, canonicalIds);
  const ids = new Set(canonicalIds);
  const statuses = records.map((r) => dailyRecordStatus(r, ids));
  const count = (status: string) => statuses.filter((s) => s === status).length;
  const completed = new Set(
    store.results.map((r) => `${r.season}:${r.gameId}`),
  );
  return {
    games: records.length,
    projected: records.filter(
      (r) => r.prediction.projectedFirstHalfTotal !== null,
    ).length,
    unavailable: count("Missing model inputs"),
    counted: count("Counted pregame"),
    unpriced: count("No recorded line"),
    historical: count("Historical estimate"),
    noLean: count("No model lean"),
    otherPregame: count("Other pregame version"),
    withResults: records.filter((r) => completed.has(`${r.season}:${r.gameId}`))
      .length,
  };
}
