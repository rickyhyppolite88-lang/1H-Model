import { expect, it } from "vitest";
import { captureResearchForecast } from "./labResearch";
import { researchFixture } from "./labResearch.test-fixture";
import { labDecision, predictionDecision } from "./playDecision";
import { recordFixture } from "./record.test-fixture";

function fixture() {
  const f = recordFixture();
  const row = f.feed.predictions[0];
  row.markets = row.markets.map((m) => ({ ...m, capturedAt: f.at }));
  return { ...f, row, now: Date.parse(f.at) };
}
it("makes either side a binary play at a fresh pregame line without sizing by confidence", () => {
  const f = fixture();
  expect(predictionDecision(f.row, "betmgm", "latest", f.now).yes).toBe(true);
  f.row.projectedFirstHalfTotal = 68;
  expect(predictionDecision(f.row, "betmgm", "latest", f.now).yes).toBe(true);
});
it("returns no bet for tipped games, stale/future lines, missing inputs, no lean and outliers", () => {
  const f = fixture(),
    decide = () => predictionDecision(f.row, "betmgm", "latest", f.now);
  f.row.markets[0].capturedAt = "2026-11-02T21:00:00Z";
  expect(decide().yes).toBe(false);
  f.row.markets[0].capturedAt = "2026-11-02T23:00:00Z";
  expect(decide().yes).toBe(false);
  f.row.markets[0].capturedAt = f.at;
  expect(predictionDecision(f.row, "unknown", "latest", f.now).yes).toBe(false);
  f.row.projectedFirstHalfTotal = 70;
  expect(decide().yes).toBe(false);
  f.row.projectedFirstHalfTotal = 90;
  expect(decide().yes).toBe(false);
  f.row.projectedFirstHalfTotal = 72;
  f.row.simpleTotal = null;
  expect(decide().yes).toBe(false);
  f.row.simpleTotal = 72;
  f.row.startsAt = f.at;
  expect(decide().yes).toBe(false);
});
it("shows no new Lab bet for stale lines or watch/gap decisions while retaining the saved observation", () => {
  const f = researchFixture();
  f.row.startsAt = "2026-11-03T02:00:00Z";
  f.game.startsAt = f.row.startsAt;
  const row = captureResearchForecast(
    "market-paper-v3",
    f.row,
    f.game,
    f.feed,
    f.model,
    f.modelPath,
    f.halves,
    f.refs,
    f.at,
  );
  expect(row.status).toBe("paper_test");
  const original = JSON.stringify(row);
  expect(labDecision(row, Date.parse(f.at)).yes).toBe(true);
  expect(labDecision(row, Date.parse(f.at) + 46 * 60_000).yes).toBe(false);
  expect(
    labDecision({ ...row, status: "data_gap" }, Date.parse(f.at)).yes,
  ).toBe(false);
  expect(
    labDecision({ ...row, status: "watch_only" }, Date.parse(f.at)).yes,
  ).toBe(false);
  expect(JSON.stringify(row)).toBe(original);
});
