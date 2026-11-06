import { expect, it } from "vitest";
import { contextForecast } from "./gameContext";
import { contextFixture, contextModelPath } from "./gameContext.test-fixture";
import { generatePredictions } from "./predictions";

it("estimates context without changing the Actual algorithm or feed", () => {
  const f = contextFixture();
  const before = generatePredictions(f.ledger, f.at);
  const result = contextForecast(
    f.game,
    f.model,
    contextModelPath,
    f.feed.season,
    f.at,
  );
  expect(result?.homeAwayAdjustment).toBe(1);
  expect(result?.crowdAdjustment).toBe(1);
  expect(result?.total).toBeCloseTo((result?.baselineTotal ?? 0) + 2);
  expect(generatePredictions(f.ledger, f.at)).toEqual(before);
});
it.each([1000, 2999])(
  "keeps low attendance (%s) fully neutral including centering offsets",
  (attendance) => {
    const f = contextFixture();
    f.model.venues["id:1"].attendanceTotal = attendance * 10;
    f.model.profiles["2025-26:a"]["crowd:large"] = 0.8;
    const result = contextForecast(
      f.game,
      f.model,
      contextModelPath,
      f.feed.season,
      f.at,
    );
    expect(result).toMatchObject({
      crowdAdjustment: 0,
      crowdEligible: false,
      homeAwayAdjustment: 1,
    });
    expect(result?.crowdReason).toContain("disabled");
  },
);
it("keeps unknown or sparse attendance neutral", () => {
  const f = contextFixture();
  f.model.venues["id:1"].games = 2;
  expect(
    contextForecast(f.game, f.model, contextModelPath, f.feed.season, f.at),
  ).toMatchObject({ expectedAttendance: null, crowdAdjustment: 0 });
  delete f.model.venues["id:1"];
  expect(
    contextForecast(f.game, f.model, contextModelPath, f.feed.season, f.at)
      ?.crowdAdjustment,
  ).toBe(0);
});
it("separates neutral sites and tournaments and bounds combined point changes", () => {
  const f = contextFixture();
  if (!f.game.context) throw new Error("fixture");
  f.game.context.neutralSite = true;
  f.game.context.matchupType = "conference_tournament";
  f.model.coefficients["type:conference_tournament"] = -10;
  const result = contextForecast(
    f.game,
    f.model,
    contextModelPath,
    f.feed.season,
    f.at,
  );
  expect(result).toMatchObject({
    homeAwayAdjustment: 0,
    neutralAdjustment: -1,
    adjustment: -4,
  });
  expect(result?.unboundedAdjustment).toBeLessThan(-4);
});
it("rejects future evidence, source identity mismatches, and captures after tipoff", () => {
  const f = contextFixture();
  const run = (at = f.at) =>
    contextForecast(f.game, f.model, contextModelPath, f.feed.season, at);
  expect(run("2026-11-03T00:10:00Z")).toBeNull();
  f.model.fittedAt = "2026-11-02T23:00:00Z";
  expect(run()).toBeNull();
  f.model.fittedAt = "2026-11-02T19:00:00Z";
  f.game.contextRetrievedAt = "2026-11-02T23:00:00Z";
  expect(run()).toBeNull();
  f.game.contextRetrievedAt = f.at;
  f.game.home.modelId = "wrong-team";
  expect(run()).toBeNull();
});
