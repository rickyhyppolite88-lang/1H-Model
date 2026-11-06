import { expect, it } from "vitest";
import {
  countRange,
  forecastFoulExposure,
  sevenFoulProbability,
} from "./foulExposure";
import { canonicalLabForecasts, gradeLab, labToCsv } from "./lab";
import { currentLabFixture } from "./lab.test-fixture";
import { captureLab } from "./labCapture";

it("calculates bounded foul probabilities and overdispersed free-throw ranges", () => {
  expect(sevenFoulProbability(0)).toBe(0);
  expect(sevenFoulProbability(7)).toBeGreaterThan(0.5);
  expect(sevenFoulProbability(20)).toBeGreaterThan(0.99);
  expect(() => sevenFoulProbability(-1)).toThrow();
  expect(countRange(0)).toEqual([0, 0]);
  const narrow = countRange(10),
    wide = countRange(10, 3);
  expect(wide[1] - wide[0]).toBeGreaterThan(narrow[1] - narrow[0]);
  expect(() => countRange(Number.NaN)).toThrow();
});
it("uses neutral priors for teams without history and requires measured league coverage", () => {
  const f = currentLabFixture();
  const exposure = forecastFoulExposure("new-a", "new-b", 35, f.inputs.halves);
  expect(exposure).toMatchObject({
    awayHistoryGames: 0,
    homeHistoryGames: 0,
    pointsAdjustment: 0,
  });
  expect(exposure?.expectedAwayFTA).toBeCloseTo(exposure?.baselineAwayFTA ?? 0);
  expect(
    forecastFoulExposure("1", "2", 35, f.inputs.halves.slice(0, 29)),
  ).toBeNull();
});
it("combines the Actual core, defense, venue and joint FT/foul effects without stacking a second bonus", () => {
  const f = currentLabFixture();
  const original = structuredClone({ feed: f.feed, ledger: f.ledger });
  const first = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  expect(first.forecasts).toHaveLength(1);
  const row = first.forecasts[0];
  expect(row).toMatchObject({
    methodId: "enhanced-baseline-v2",
    status: "qualified",
  });
  expect(row.context?.crowdAdjustment).toBe(1);
  expect(row.foulExposure?.leagueGames).toBe(40);
  expect(row.total).toBeCloseTo(
    Number(row.inputs.defenseAdjustedTotal) +
      (row.context?.adjustment ?? 0) +
      (row.foulExposure?.pointsAdjustment ?? 0),
  );
  expect(row.inputs.bonusPointsAdjustment).toBeUndefined();
  expect(row.total).toBeCloseTo(
    0.6 * (row.simpleTotal ?? 0) + 0.4 * (row.paceTotal ?? 0),
  );
  expect(row.bonusMinutes).not.toBeNull();
  expect({ feed: f.feed, ledger: f.ledger }).toEqual(original);
  const same = captureLab(
    first,
    f.config,
    f.feed,
    f.ledger,
    f.inputs,
    "2026-11-02T22:10:00Z",
  );
  expect(same.forecasts).toEqual(first.forecasts);
  f.feed.predictions[0].markets[0].latestLine = 73;
  const next = captureLab(
    first,
    f.config,
    f.feed,
    f.ledger,
    f.inputs,
    "2026-11-02T22:10:00Z",
  );
  expect(next.forecasts).toHaveLength(2);
  expect(next.forecasts[0]).toEqual(row);
  expect(canonicalLabForecasts(next.forecasts)).toEqual([row]);
  expect(labToCsv(next)).toContain("expected_away_fta");
  expect(labToCsv(next)).toContain("Test Arena");
});
it("keeps crowd penalties neutral and labels missing context as a gap", () => {
  const f = currentLabFixture();
  if (!f.inputs.contextModel) throw new Error("fixture");
  f.inputs.contextModel.venues["id:1"].attendanceTotal = 10000;
  let row = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at)
    .forecasts[0];
  expect(row.context).toMatchObject({
    crowdEligible: false,
    crowdAdjustment: 0,
  });
  delete f.ledger.games[0].context;
  row = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at)
    .forecasts[0];
  expect(row).toMatchObject({ status: "data_gap", total: null });
});
it("excludes target/future/unresolved halves and does not backfill after tipoff", () => {
  const f = currentLabFixture();
  f.inputs.halves = f.inputs.halves.map((half, i) =>
    i < 11 ? { ...half, observedAt: "2026-11-03T00:00:00Z" } : half,
  );
  const row = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at)
    .forecasts[0];
  expect(row).toMatchObject({ status: "data_gap", total: null });
  expect(
    captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      "2026-11-03T01:00:00Z",
    ).forecasts,
  ).toHaveLength(0);
});
it("grades actual FT attempts and foul-call probabilities only against reconciled completed halves", () => {
  const f = currentLabFixture();
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  const row = store.forecasts[0];
  store.results = [
    {
      id: "result",
      season: row.season,
      gameId: row.gameId,
      startsAt: row.startsAt,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      source: "https://example.com/result",
      awayPoints: 35,
      homePoints: 35,
    },
  ];
  store.halves = [
    {
      ...f.inputs.halves[0],
      id: "outcome",
      gameId: row.gameId,
      startsAt: row.startsAt,
      teams: f.inputs.halves[0].teams.map((t) => ({ ...t, points: 35 })),
    },
  ];
  expect(gradeLab(row, store)).toMatchObject({
    actualFTA: 24,
    actualFouls: 14,
  });
  expect(gradeLab(row, store).foulBrier).not.toBeNull();
  store.results[0].awayPoints = 36;
  expect(gradeLab(row, store)).toMatchObject({
    actualFTA: null,
    actualFouls: null,
    foulBrier: null,
  });
});
