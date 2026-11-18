import { expect, it } from "vitest";
import { replayFeatureTrials } from "./labFeatureReplay";
import { researchFixture } from "./labResearch.test-fixture";
import { updatePredictionRecord } from "./predictionRecord";

function fixture() {
  const f = researchFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  store.results.push({
    id: "result",
    season: f.feed.season,
    gameId: f.game.id,
    startsAt: f.game.startsAt,
    observedAt: "2026-11-03T01:00:00Z",
    sourceCapturedAt: "2026-11-03T01:00:00Z",
    source: "https://example.com/result",
    awayPoints: 36,
    homePoints: 36,
  });
  const halves = Array.from({ length: 40 }, (_, i) => ({
    ...f.halves[0],
    id: `half${i}`,
    gameId: `history${i}`,
  }));
  return { ...f, store, halves, asOf: "2026-11-03T02:00:00Z" };
}
it("replays identical entries at saved odds and keeps the original record intact", () => {
  const f = fixture(),
    original = JSON.stringify(f.store);
  const replay = replayFeatureTrials(f.store, f.ledger, f.halves, f.asOf);
  expect(replay.report.methods["opponent-paper-v5"].games).toBe(1);
  expect(replay.report.methods["shooting-paper-v6"].games).toBe(1);
  expect(replay.rows[0].price).toBe(-115);
  expect(replay.report.methods["opponent-paper-v5"].net).toBeCloseTo(100 / 115);
  expect(
    replay.rows.every(
      (r) => r.fitAt <= r.recordedAt && r.quoteAt <= r.recordedAt,
    ),
  ).toBe(true);
  expect(JSON.stringify(f.store)).toBe(original);
});
it("does not score results that were observed after the requested cutoff", () => {
  const f = fixture();
  f.store.results[0].observedAt = "2026-11-03T03:00:00Z";
  expect(
    replayFeatureTrials(f.store, f.ledger, f.halves, f.asOf).rows,
  ).toHaveLength(0);
});
it("blocks later retrieved inputs instead of giving historical forecasts hindsight", () => {
  const f = fixture();
  const features = f.store.records[0].features;
  if (!features) throw new Error("No features");
  features.statsRetrievedAt = "2026-11-03T01:00:00Z";
  expect(
    replayFeatureTrials(f.store, f.ledger, f.halves, f.asOf).rows,
  ).toHaveLength(0);
});
