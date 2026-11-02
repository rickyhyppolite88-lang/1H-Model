import { describe, expect, it } from "vitest";
import { recordFixture } from "./record.test-fixture";
import { predictionSignal, signalFill } from "./signals";

describe("research signal gradient", () => {
  it("increases with the model gap and halves strength when components disagree", () => {
    const { feed, at } = recordFixture();
    const base = {
      ...feed.predictions[0],
      projectedFirstHalfTotal: 74,
      simpleTotal: 74,
      paceAdjustedTotal: 74,
    };
    const strong = predictionSignal(base, "betmgm", "latest", at);
    const weak = predictionSignal(
      { ...base, projectedFirstHalfTotal: 72 },
      "betmgm",
      "latest",
      at,
    );
    const mixed = predictionSignal(
      { ...base, paceAdjustedTotal: 68 },
      "betmgm",
      "latest",
      at,
    );
    expect(strong).toMatchObject({ score: 50, label: "Aligned" });
    expect(weak.score).toBe(25);
    expect(mixed).toMatchObject({ score: 25, label: "Mixed" });
    expect(parseInt(signalFill(75).slice(1, 3), 16)).toBeLessThan(
      parseInt(signalFill(25).slice(1, 3), 16),
    );
    expect(strong.reason).toContain("not a hit percentage");
  });
  it("holds extreme model gaps for review instead of making them darkest green", () => {
    const { feed, at } = recordFixture();
    expect(
      predictionSignal(
        { ...feed.predictions[0], projectedFirstHalfTotal: 78 },
        "betmgm",
        "latest",
        at,
      ),
    ).toMatchObject({ score: null, fill: null, label: "Outlier review" });
  });
  it("does not color completed, started, reconstructed, unpriced or missing projections", () => {
    const { feed, at } = recordFixture();
    const row = feed.predictions[0];
    for (const changed of [
      { ...row, actualFirstHalfTotal: 74 },
      { ...row, startsAt: at },
      { ...row, featureKind: "reconstructed_season_debut" as const },
      { ...row, markets: [] },
      { ...row, projectedFirstHalfTotal: null },
    ]) {
      expect(
        predictionSignal(changed, "betmgm", "latest", at).score,
      ).toBeNull();
    }
  });
  it("respects the selected book and quote basis", () => {
    const { feed, at } = recordFixture();
    const row = feed.predictions[0];
    row.markets[0].openingLine = 73;
    expect(predictionSignal(row, "betmgm", "opening", at).score).not.toBe(
      predictionSignal(row, "betmgm", "latest", at).score,
    );
    expect(predictionSignal(row, "missing", "latest", at).score).toBeNull();
  });
  it("cannot rank quotes or input snapshots not available at the requested time", () => {
    const { feed, at } = recordFixture();
    const row = feed.predictions[0];
    row.markets[0].capturedAt = "2026-11-02T23:00:00Z";
    expect(predictionSignal(row, "betmgm", "latest", at).score).toBeNull();
  });
  it("leaves an exact model/line tie neutral", () => {
    const { feed, at } = recordFixture();
    expect(
      predictionSignal(
        { ...feed.predictions[0], projectedFirstHalfTotal: 70 },
        "betmgm",
        "latest",
        at,
      ),
    ).toMatchObject({ label: "No lean", score: null });
  });
});
