import { describe, expect, it } from "vitest";
import {
  buildRecordIndex,
  canonicalRecords,
  recordForDate,
  recordGrade,
  recordToCsv,
  updatePredictionRecord,
} from "./predictionRecord";
import { generatePredictions } from "./predictions";
import { recordFixture } from "./record.test-fixture";

describe("permanent prediction record", () => {
  it("saves a changed post-tipoff projection as historical without replacing the real forecast", () => {
    const f = recordFixture();
    const first = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const at = "2026-11-03T02:00:00Z";
    const feed = generatePredictions(f.ledger, at);
    feed.predictions[0].projectedFirstHalfTotal = 80;
    const next = updatePredictionRecord(first, feed, f.ledger, at);
    expect(next.records).toHaveLength(2);
    expect(next.records[0]).toEqual(first.records[0]);
    expect(next.records[1].state).toBe("historical");
    expect(buildRecordIndex(next).canonicalIds).toEqual([first.records[0].id]);
  });
  it("preserves all model inputs and quote evidence and deduplicates unchanged refreshes", () => {
    const f = recordFixture();
    const first = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const before = JSON.stringify(first.records);
    f.ledger.games[0].quotes[0].latestCapturedAt = "2026-11-02T22:05:00Z";
    const next = updatePredictionRecord(
      first,
      generatePredictions(f.ledger, "2026-11-02T22:10:00Z"),
      f.ledger,
      "2026-11-02T22:10:00Z",
    );
    expect(next.records).toHaveLength(1);
    expect(JSON.stringify(next.records)).toBe(before);
    expect(first.records[0].features).toEqual(
      f.ledger.games[0].featureSnapshot,
    );
    expect(first.records[0].quotes[0].latest).toEqual({
      total: 70,
      overPrice: -115,
      underPrice: -105,
    });
    expect(first.records[0].prediction.projectedFirstHalfTotal).toBe(
      f.feed.predictions[0].projectedFirstHalfTotal,
    );
  });
  it("appends a changed line and counts the first eligible forecast once", () => {
    const f = recordFixture();
    const first = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const quote = f.ledger.games[0].quotes[0].latest;
    if (!quote) throw new Error("fixture");
    quote.total = 73;
    const next = updatePredictionRecord(
      first,
      generatePredictions(f.ledger, "2026-11-02T22:10:00Z"),
      f.ledger,
      "2026-11-02T22:10:00Z",
    );
    expect(next.records).toHaveLength(2);
    expect(next.records[0]).toEqual(first.records[0]);
    expect(next.records[1].version).toBe(2);
    expect(next.records.map((r) => r.comparison.line)).toEqual([70, 73]);
    expect(canonicalRecords(next.records).map((r) => r.id)).toEqual([
      first.records[0].id,
    ]);
    expect(buildRecordIndex(next).summary[0]).toMatchObject({
      versions: 2,
      games: 1,
      pregame: 1,
      pending: 1,
      winRate: null,
    });
  });
  it("grades the frozen line rather than replacing it with a later quote", () => {
    const f = recordFixture();
    const first = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const g = f.ledger.games[0];
    g.firstHalfComplete = true;
    g.away.firstHalfPoints = 38;
    g.home.firstHalfPoints = 38;
    const q = g.quotes[0].latest;
    if (q) q.total = 75;
    const settled = updatePredictionRecord(
      first,
      generatePredictions(f.ledger, "2026-11-03T02:00:00Z"),
      f.ledger,
      "2026-11-03T02:00:00Z",
    );
    expect(settled.records).toEqual(first.records);
    expect(settled.results).toHaveLength(1);
    expect(recordGrade(settled.records[0], settled.results)).toMatchObject({
      grade: "Win",
      actual: 76,
    });
    expect(buildRecordIndex(settled).summary[0]).toMatchObject({
      wins: 1,
      losses: 0,
      pending: 0,
      winRate: 1,
    });
  });
  it("appends score corrections and updates the grade without losing the first result", () => {
    const f = recordFixture();
    let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const g = f.ledger.games[0];
    g.firstHalfComplete = true;
    g.away.firstHalfPoints = 38;
    g.home.firstHalfPoints = 38;
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, "2026-11-03T02:00:00Z"),
      f.ledger,
      "2026-11-03T02:00:00Z",
    );
    const original = structuredClone(store.results[0]);
    g.away.firstHalfPoints = 33;
    g.home.firstHalfPoints = 33;
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, "2026-11-03T02:10:00Z"),
      f.ledger,
      "2026-11-03T02:10:00Z",
    );
    expect(store.results).toHaveLength(2);
    expect(store.results[0]).toEqual(original);
    expect(recordGrade(store.records[0], store.results)).toMatchObject({
      grade: "Loss",
      actual: 66,
    });
    expect(buildRecordIndex(store).summary[0]).toMatchObject({
      wins: 0,
      losses: 1,
      winRate: 0,
    });
  });
  it("preserves a post-tipoff estimate but excludes it from the official record", () => {
    const f = recordFixture();
    const at = f.ledger.games[0].startsAt;
    const store = updatePredictionRecord(
      f.store,
      generatePredictions(f.ledger, at),
      f.ledger,
      at,
    );
    expect(store.records[0].state).toBe("historical");
    expect(buildRecordIndex(store).canonicalIds).toEqual([]);
    expect(recordGrade(store.records[0], []).grade).toBe("Historical");
  });
  it("does not promote reconstructed estimates into recorded pregame forecasts", () => {
    const f = recordFixture();
    const features = f.ledger.games[0].featureSnapshot;
    if (!features) throw new Error("fixture");
    features.kind = "reconstructed_season_debut";
    const store = updatePredictionRecord(
      f.store,
      generatePredictions(f.ledger, f.at),
      f.ledger,
      f.at,
    );
    expect(store.records[0].state).toBe("historical");
    expect(buildRecordIndex(store).summary[0].pregame).toBe(0);
  });
  it("saves unavailable projections without inventing a pick or a win rate", () => {
    const f = recordFixture();
    f.ledger.games[0].featureSnapshot = null;
    f.ledger.games[0].away.modelId = null;
    const store = updatePredictionRecord(
      f.store,
      generatePredictions(f.ledger, f.at),
      f.ledger,
      f.at,
    );
    expect(store.records[0].state).toBe("unavailable");
    expect(recordGrade(store.records[0], []).grade).toBe("No projection");
    expect(buildRecordIndex(store).summary[0]).toMatchObject({
      games: 1,
      pregame: 0,
      winRate: null,
    });
  });
  it("excludes pushes from win percentage", () => {
    const f = recordFixture();
    let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const g = f.ledger.games[0];
    g.firstHalfComplete = true;
    g.away.firstHalfPoints = 35;
    g.home.firstHalfPoints = 35;
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, "2026-11-03T02:00:00Z"),
      f.ledger,
      "2026-11-03T02:00:00Z",
    );
    expect(buildRecordIndex(store).summary[0]).toMatchObject({
      wins: 0,
      losses: 0,
      pushes: 1,
      pending: 0,
      winRate: null,
    });
  });
  it("can start counting once the first available line arrives, retaining the unpriced version", () => {
    const f = recordFixture();
    f.ledger.games[0].quotes[0].latest = null;
    let store = updatePredictionRecord(
      f.store,
      generatePredictions(f.ledger, f.at),
      f.ledger,
      f.at,
    );
    expect(recordGrade(store.records[0], []).grade).toBe("No line");
    f.ledger.games[0].quotes[0].latest = {
      total: 70,
      overPrice: -110,
      underPrice: -110,
    };
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, "2026-11-02T22:10:00Z"),
      f.ledger,
      "2026-11-02T22:10:00Z",
    );
    expect(store.records).toHaveLength(2);
    expect(buildRecordIndex(store).canonicalIds).toEqual([store.records[1].id]);
  });
  it.each(["incomplete", "missing score"])(
    "does not grade an %s half",
    (kind) => {
      const f = recordFixture();
      let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
      const g = f.ledger.games[0];
      g.firstHalfComplete = kind !== "incomplete";
      g.away.firstHalfPoints = 35;
      g.home.firstHalfPoints = kind === "missing score" ? null : 35;
      store = updatePredictionRecord(
        store,
        generatePredictions(f.ledger, "2026-11-03T02:00:00Z"),
        f.ledger,
        "2026-11-03T02:00:00Z",
      );
      expect(store.results).toHaveLength(0);
      expect(recordGrade(store.records[0], store.results).grade).toBe(
        "Pending",
      );
    },
  );
  it("rejects backdated updates instead of replacing the record", () => {
    const f = recordFixture();
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    expect(() =>
      updatePredictionRecord(store, f.feed, f.ledger, "2026-11-02T21:59:00Z"),
    ).toThrow("backdate");
  });
  it("keeps schedule changes pending review rather than automatically claiming a win", () => {
    const f = recordFixture();
    let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
    const g = f.ledger.games[0];
    g.startsAt = "2026-11-04T00:00:00Z";
    g.firstHalfComplete = true;
    g.away.firstHalfPoints = 40;
    g.home.firstHalfPoints = 40;
    store = updatePredictionRecord(
      store,
      generatePredictions(f.ledger, "2026-11-04T02:00:00Z"),
      f.ledger,
      "2026-11-04T02:00:00Z",
    );
    expect(recordGrade(store.records[0], store.results)).toMatchObject({
      grade: "Pending",
      actual: 80,
      error: null,
    });
    expect(buildRecordIndex(store).summary[0].winRate).toBeNull();
  });
  it("preserves observation evidence without backdating a newly calculated signal", () => {
    const f = recordFixture();
    const later = "2026-11-03T02:00:00Z";
    const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at, {
      origin: "published_observation",
      evidence: {
        url: "https://example.com/published.json",
        sha256: "a".repeat(64),
      },
      signalAt: later,
    });
    expect(store.records[0]).toMatchObject({
      recordedAt: f.at,
      signalCalculatedAt: later,
      state: "pregame",
      signal: { score: null, label: "Closed" },
    });
    expect(
      buildRecordIndex(store).summary[0].bands.find(
        (b) => b.label === "Unranked / review",
      )?.pending,
    ).toBe(1);
  });
  it("exports frozen features and later versions with one counted marker", () => {
    const f = recordFixture();
    f.ledger.games[0].away.name = "=SUM(1,2)";
    const store = updatePredictionRecord(
      f.store,
      generatePredictions(f.ledger, f.at),
      f.ledger,
      f.at,
    );
    const index = buildRecordIndex(store);
    const csv = recordToCsv(store, index.canonicalIds);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain("away_offensiveEfficiency");
    expect(csv).toContain("counted_in_record");
    expect(csv.trim().split("\r\n")).toHaveLength(2);
    const shard = recordForDate(store, "2026-11-02");
    expect(shard.records).toEqual(store.records);
    expect(recordForDate(store, "2026-11-01").records).toEqual([]);
  });
});
