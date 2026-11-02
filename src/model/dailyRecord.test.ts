import { describe, expect, it } from "vitest";
import {
  dailyRecordCoverage,
  dailyRecordGames,
  dailyRecordStatus,
} from "./dailyRecord";
import { buildRecordIndex, updatePredictionRecord } from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";

describe("complete daily record coverage", () => {
  it("shows every game once, including missing inputs, unpriced forecasts and historical estimates", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const base = store.records[0];
    const later = {
      ...base,
      id: "later",
      version: 2,
      recordedAt: "2026-11-02T22:10:00Z",
      comparison: { ...base.comparison, line: 75 },
    };
    const unpriced = {
      ...base,
      id: "unpriced",
      gameId: "unpriced",
      comparison: { line: null, signedEdge: null, lean: null },
    };
    const historical = {
      ...base,
      id: "historical",
      gameId: "historical",
      state: "historical" as const,
      recordedAt: "2026-11-03T02:00:00Z",
    };
    const missing = {
      ...base,
      id: "missing",
      gameId: "missing",
      state: "unavailable" as const,
      prediction: { ...base.prediction, projectedFirstHalfTotal: null },
    };
    const push = {
      ...base,
      id: "push",
      gameId: "push",
      comparison: { ...base.comparison, lean: "PUSH" as const },
    };
    store.records = [base, later, unpriced, historical, missing, push];
    store.results = [
      {
        id: "zero-score",
        gameId: "missing",
        season: base.season,
        observedAt: "2026-11-03T02:00:00Z",
        sourceCapturedAt: "2026-11-03T02:00:00Z",
        awayPoints: 0,
        homePoints: 0,
        source: "https://example.com/results",
      },
    ];
    const games = dailyRecordGames(store.records, [base.id]);
    expect(games).toHaveLength(5);
    expect(games.find((r) => r.gameId === base.gameId)?.id).toBe(base.id);
    expect(dailyRecordCoverage(store, [base.id])).toEqual({
      games: 5,
      projected: 4,
      unavailable: 1,
      counted: 1,
      unpriced: 1,
      historical: 1,
      noLean: 1,
      otherPregame: 0,
      withResults: 1,
    });
    expect(dailyRecordStatus(missing, new Set([base.id]))).toBe(
      "Missing model inputs",
    );
  });
  it("prefers a saved pregame estimate over a later historical reconstruction", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const base = store.records[0];
    const old = {
      ...base,
      id: "old",
      comparison: { line: null, signedEdge: null, lean: null },
    };
    const later = {
      ...base,
      id: "after",
      state: "historical" as const,
      recordedAt: "2026-11-03T02:00:00Z",
    };
    expect(dailyRecordGames([old, later], [])[0].id).toBe("old");
  });
  it("adds date-specific coverage and an all-games CSV path without treating UTC midnight as a new day", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const index = buildRecordIndex(store);
    expect(index.archives[0]).toMatchObject({
      date: "2026-11-02",
      gamesCsvPath: "data/prediction-record/2026-11-02-games.csv",
      coverage: { games: 1, projected: 1, counted: 1 },
    });
  });
});
