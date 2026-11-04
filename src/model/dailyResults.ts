import { dailyRecordGames } from "./dailyRecord";
import { type RecordStore, recordGrade } from "./predictionRecord";

/** Summarize a scoped date against the official IDs from the full record index. */
export function dailyRecordedResults(
  store: RecordStore,
  canonicalIds: string[],
  date: string,
) {
  const records = store.records.filter((record) => record.gameDate === date);
  const ids = new Set(canonicalIds);
  const counted = records.filter((record) => ids.has(record.id));
  const grades = counted.map(
    (record) => recordGrade(record, store.results).grade,
  );
  const wins = grades.filter((grade) => grade === "Win").length;
  const losses = grades.filter((grade) => grade === "Loss").length;
  const games = dailyRecordGames(records, canonicalIds).length;
  return {
    games,
    counted: counted.length,
    excluded: games - counted.length,
    wins,
    losses,
    pushes: grades.filter((grade) => grade === "Push").length,
    pending: grades.filter((grade) => grade === "Pending").length,
    winRate: wins + losses ? wins / (wins + losses) : null,
  };
}
