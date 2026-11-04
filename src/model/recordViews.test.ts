import { describe, expect, it } from "vitest";
import { recordGrade, updatePredictionRecord } from "./predictionRecord";
import { recordFixture } from "./record.test-fixture";
import { mergeRecordStores } from "./recordViews";

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
