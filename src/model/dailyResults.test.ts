import { describe, expect, it } from "vitest";
import { dailyRecordedResults } from "./dailyResults";
import {
  type ForecastRecord,
  updatePredictionRecord,
} from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";

describe("results for a selected Eastern game date", () => {
  it("counts only original official picks for that date and respects corrections and changed tipoffs", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const base = store.records[0];
    const make = (
      gameId: string,
      changes: Partial<ForecastRecord> = {},
    ): ForecastRecord => ({
      ...base,
      id: gameId,
      gameId,
      prediction: { ...base.prediction, gameId },
      ...changes,
    });
    const official = [
      "win",
      "loss",
      "push",
      "pending",
      "corrected",
      "rescheduled",
    ].map((id) => make(id));
    const priorDay = make("other-day", { gameDate: "2026-11-01" });
    store.records = [
      ...official,
      priorDay,
      make("win", {
        id: "later-version",
        version: 2,
        comparison: { line: 75, signedEdge: -1, lean: "UNDER" },
      }),
      make("historical", { state: "historical" }),
      make("unpriced", {
        comparison: { line: null, signedEdge: null, lean: null },
      }),
      make("missing", {
        state: "unavailable",
        prediction: { ...base.prediction, projectedFirstHalfTotal: null },
      }),
      make("no-lean", {
        comparison: { line: 74, signedEdge: 0, lean: "PUSH" },
      }),
    ];
    const result = (gameId: string, total: number, suffix = "1") => ({
      id: `${gameId}-${suffix}`,
      gameId,
      season: base.season,
      observedAt: "2026-11-03T03:00:00Z",
      sourceCapturedAt: "2026-11-03T03:00:00Z",
      awayPoints: total,
      homePoints: 0,
      source: "https://example.com/results",
    });
    store.results = [
      result("win", 72),
      result("loss", 68),
      result("push", 70),
      result("other-day", 72),
      result("corrected", 72),
      result("corrected", 68, "2"),
      { ...result("rescheduled", 72), startsAt: "2026-11-03T01:00:00Z" },
    ];
    expect(
      dailyRecordedResults(
        store,
        [...official.map((r) => r.id), priorDay.id],
        "2026-11-02",
      ),
    ).toEqual({
      games: 10,
      counted: 6,
      excluded: 4,
      wins: 1,
      losses: 2,
      pushes: 1,
      pending: 2,
      winRate: 1 / 3,
    });
  });
  it("keeps the hit rate unknown without a graded win or loss and recognizes zero-point results", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const record = store.records[0];
    expect(
      dailyRecordedResults(store, [record.id], record.gameDate),
    ).toMatchObject({ wins: 0, losses: 0, pending: 1, winRate: null });
    record.comparison = { line: 70, signedEdge: -4, lean: "UNDER" };
    store.results = [
      {
        id: "zero",
        gameId: record.gameId,
        season: record.season,
        observedAt: "2026-11-03T03:00:00Z",
        sourceCapturedAt: "2026-11-03T03:00:00Z",
        awayPoints: 0,
        homePoints: 0,
        source: "https://example.com/results",
      },
    ];
    expect(
      dailyRecordedResults(store, [record.id], record.gameDate),
    ).toMatchObject({ wins: 1, pending: 0, winRate: 1 });
    expect(
      dailyRecordedResults(store, [record.id], "2026-11-03"),
    ).toMatchObject({ games: 0, counted: 0, wins: 0, winRate: null });
  });
});
