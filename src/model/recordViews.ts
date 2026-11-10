import { dailyRecordGames } from "./dailyRecord";
import { mergeEntryPolicies } from "./entryPolicy";
import {
  type ForecastRecord,
  type RecordStore,
  recordGrade,
} from "./predictionRecord";

/** Only completed first-half result events make a game visible in the record page. */
export function finishedRecordStore(store: RecordStore): RecordStore {
  const finished = new Set(
    store.results.map((result) => `${result.season}:${result.gameId}`),
  );
  return {
    ...store,
    records: store.records.filter((record) =>
      finished.has(`${record.season}:${record.gameId}`),
    ),
  };
}

/** Count original official settled picks once; keep other finished games visible for coverage. */
export function finishedRecordSummary(
  store: RecordStore,
  canonicalIds: string[],
) {
  const finished = finishedRecordStore(store);
  const ids = new Set(canonicalIds);
  const games = dailyRecordGames(finished.records, canonicalIds);
  const official = games
    .filter((record) => ids.has(record.id))
    .map((record) => ({ record, ...recordGrade(record, finished.results) }));
  const wins = official.filter((result) => result.grade === "Win").length;
  const losses = official.filter((result) => result.grade === "Loss").length;
  const pushes = official.filter((result) => result.grade === "Push").length;
  const labels = ["0–24", "25–49", "50–74", "75–100", "Unranked / review"];
  const bands = labels.map((label, index) => {
    const results = official.filter(({ record }) => {
      const score = record.signal.score;
      return score === null
        ? index === 4
        : Math.min(3, Math.floor(score / 25)) === index;
    });
    const bandWins = results.filter((result) => result.grade === "Win").length;
    const bandLosses = results.filter(
      (result) => result.grade === "Loss",
    ).length;
    return {
      label,
      wins: bandWins,
      losses: bandLosses,
      pushes: results.filter((result) => result.grade === "Push").length,
      winRate:
        bandWins + bandLosses ? bandWins / (bandWins + bandLosses) : null,
    };
  });
  return {
    games: games.length,
    versions: finished.records.length,
    wins,
    losses,
    pushes,
    counted: wins + losses + pushes,
    ungraded: games.length - wins - losses - pushes,
    review: official.filter((result) => result.grade === "Pending").length,
    winRate: wins + losses ? wins / (wins + losses) : null,
    bands,
  };
}

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
    ...(stores.some((store) => store.entryPolicy)
      ? {
          entryPolicy: mergeEntryPolicies(
            stores.map((store) => store.entryPolicy),
          ),
        }
      : {}),
    updatedAt: latest,
    records: [...records.values()],
    results: [...results.values()].sort(
      (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
    ),
  };
}
