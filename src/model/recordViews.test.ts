import { describe, expect, it } from "vitest";
import { recordGrade, updatePredictionRecord } from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";
import {
  finishedRecordStore,
  finishedRecordSummary,
  mergeRecordStores,
} from "./recordViews";

describe("full record archive merge", () => {
  it("deduplicates shared immutable records and grades against the latest chronological result event", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const record = store.records[0];
    const result = {
      id: "early",
      season: record.season,
      gameId: record.gameId,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    };
    const first = { ...store, results: [result] };
    const second = {
      ...store,
      updatedAt: "2026-11-04T15:00:00Z",
      results: [
        {
          ...result,
          id: "correction",
          observedAt: "2026-11-04T01:00:00Z",
          awayPoints: 30,
          homePoints: 30,
        },
        result,
      ],
    };
    const before = structuredClone([first, second]);
    const merged = mergeRecordStores([second, first], f.at);
    expect(merged.records).toHaveLength(1);
    expect(merged.results).toHaveLength(2);
    expect(merged.updatedAt).toBe(second.updatedAt);
    expect(recordGrade(merged.records[0], merged.results).grade).toBe("Loss");
    expect([first, second]).toEqual(before);
  });
  it("rejects conflicting copies and supports an empty saved history", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const conflicting = structuredClone(store);
    conflicting.records[0].comparison.line = 75;
    expect(() => mergeRecordStores([store, conflicting], f.at)).toThrow(
      "Conflicting copies",
    );
    expect(mergeRecordStores([], f.at)).toEqual({
      schemaVersion: 1,
      updatedAt: f.at,
      records: [],
      results: [],
    });
  });
});

describe("finished first-half records", () => {
  function fixture() {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const first = store.records[0];
    const result = {
      id: "finished",
      season: first.season,
      gameId: first.gameId,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    };
    store.results = [result];
    return { store, first, result };
  }

  it("requires a result event for the same season, even when a frozen status says final", () => {
    const { store, first, result } = fixture();
    store.records.push({
      ...first,
      id: "unfinished",
      gameId: "unfinished",
      prediction: { ...first.prediction, status: "Final" },
    });
    store.results.push({
      ...result,
      id: "other-season",
      gameId: "unfinished",
      season: "2025-26",
    });
    const before = structuredClone(store);
    expect(finishedRecordStore(store).records.map((r) => r.id)).toEqual([
      first.id,
    ]);
    expect(store).toEqual(before);
    expect(first.prediction.status).toBe("Scheduled");
  });

  it("counts the original pick once while retaining later completed-game versions", () => {
    const { store, first } = fixture();
    store.records.push({
      ...first,
      id: "later",
      version: 2,
      comparison: { ...first.comparison, line: 73 },
    });
    expect(finishedRecordSummary(store, [first.id])).toMatchObject({
      games: 1,
      versions: 2,
      wins: 1,
      losses: 0,
      pushes: 0,
      counted: 1,
      ungraded: 0,
      winRate: 1,
    });
  });

  it("retains completed data gaps and historical estimates without treating them as official picks", () => {
    const { store, first, result } = fixture();
    store.records.push(
      {
        ...first,
        id: "missing",
        gameId: "missing",
        state: "unavailable",
        prediction: { ...first.prediction, projectedFirstHalfTotal: null },
      },
      { ...first, id: "historical", gameId: "historical", state: "historical" },
    );
    store.results.push(
      ...["missing", "historical"].map((gameId) => ({
        ...result,
        id: `${gameId}-result`,
        gameId,
      })),
    );
    expect(finishedRecordSummary(store, [first.id])).toMatchObject({
      games: 3,
      wins: 1,
      counted: 1,
      ungraded: 2,
    });
  });

  it("accepts a zero result and excludes pushes from the win rate", () => {
    const { store, first } = fixture();
    store.results[0].awayPoints = 0;
    store.results[0].homePoints = 0;
    expect(finishedRecordStore(store).records).toHaveLength(1);
    expect(finishedRecordSummary(store, [first.id])).toMatchObject({
      losses: 1,
      winRate: 0,
    });
    store.results[0].homePoints = 70;
    expect(finishedRecordSummary(store, [first.id])).toMatchObject({
      pushes: 1,
      counted: 1,
      winRate: null,
    });
  });

  it("keeps a completed rescheduled game visible but requests review rather than grading the old schedule", () => {
    const { store, first, result } = fixture();
    store.results = [{ ...result, startsAt: "2026-11-04T00:00:00Z" }];
    expect(finishedRecordSummary(store, [first.id])).toMatchObject({
      games: 1,
      counted: 0,
      ungraded: 1,
      review: 1,
      winRate: null,
    });
  });
});
