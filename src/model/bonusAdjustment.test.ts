import { expect, it } from "vitest";
import {
  bonusFitRules,
  bonusPointsDelta,
  fitBonusPoints,
} from "./bonusAdjustment";
import { canonicalLabForecasts } from "./lab";
import { enhancedLabFixture } from "./lab.test-fixture";
import { captureLab, expectedBonusMinutes } from "./labCapture";

it("adds defense and bounded bonus points to the same Actual algorithm, then qualifies the combined forecast", () => {
  const f = enhancedLabFixture();
  const original = structuredClone({ feed: f.feed, ledger: f.ledger });
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  expect(store.forecasts).toHaveLength(1);
  const row = store.forecasts[0];
  expect(row.methodId).toBe("enhanced-baseline-v1");
  expect(row.baselineTotal).toBe(f.feed.predictions[0].projectedFirstHalfTotal);
  const defense = ((74 + 31.75 + 38.25) / 2) * 0.6 + 73.5 * 0.4;
  expect(row.inputs.defenseAdjustedTotal).toBeCloseTo(defense);
  expect(row.total).toBeCloseTo(
    defense + Number(row.inputs.bonusPointsAdjustment),
  );
  expect(row.total).toBeCloseTo(
    0.6 * (row.simpleTotal ?? 0) + 0.4 * (row.paceTotal ?? 0),
  );
  expect(
    Math.abs(Number(row.inputs.bonusPointsAdjustment)),
  ).toBeLessThanOrEqual(2);
  expect(row.inputs.bonusFitGames).toBe(40);
  expect(row.status).toBe("qualified");
  expect({ feed: f.feed, ledger: f.ledger }).toEqual(original);
  const saved = structuredClone(row);
  f.feed.predictions[0].markets[0].latestLine = 72;
  const next = captureLab(
    store,
    f.config,
    f.feed,
    f.ledger,
    f.inputs,
    "2026-11-02T22:10:00Z",
  );
  expect(next.forecasts[0]).toEqual(saved);
  expect(canonicalLabForecasts(next.forecasts)).toEqual([saved]);
});

it("uses the adjusted components for qualification and preserves watch-only decisions", () => {
  const f = enhancedLabFixture();
  f.feed.predictions[0].markets[0].latestLine = 72;
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  expect(store.forecasts[0].status).toBe("watch_only");
  f.feed.predictions[0].markets[0].latestLine = 69;
  const next = captureLab(
    store,
    f.config,
    f.feed,
    f.ledger,
    f.inputs,
    "2026-11-02T22:10:00Z",
  );
  expect(canonicalLabForecasts(next.forecasts)[0].status).toBe("watch_only");
});

it("requires all combined factors, sufficient historical observations, and fresh lines", () => {
  const f = enhancedLabFixture();
  const run = () =>
    captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at)
      .forecasts[0];
  f.inputs.halves = f.inputs.halves.slice(0, 29);
  expect(run()).toMatchObject({ total: null, status: "data_gap" });
  expect(run().reason).toContain("30 earlier");
  f.inputs = enhancedLabFixture().inputs;
  f.inputs.prior.teams[0].firstHalfAllowed = null;
  expect(run()).toMatchObject({ total: null, status: "data_gap" });
  f.inputs = enhancedLabFixture().inputs;
  f.feed.marketCapturedAt = "2026-11-02T20:00:00Z";
  expect(run()).toMatchObject({ line: null, status: "data_gap" });
  expect(run().total).not.toBeNull();
});

it("fits only earlier available D1 history and excludes target games, future corrections, missing makes and flagged games", () => {
  const f = enhancedLabFixture();
  const estimate = (halves = f.inputs.halves) =>
    fitBonusPoints(
      halves,
      f.feed.season,
      "game",
      f.feed.predictions[0].startsAt,
      f.at,
    );
  const original = estimate();
  expect(original?.slope).toBeGreaterThan(0);
  const invalid = [
    { ...f.inputs.halves[0], id: "self", gameId: "game" },
    {
      ...f.inputs.halves[0],
      id: "later-start",
      gameId: "later",
      startsAt: "2026-11-03T01:00:00Z",
    },
    { ...f.inputs.halves[0], id: "not-d1", gameId: "other", bothD1: false },
    {
      ...f.inputs.halves[0],
      id: "unobserved-correction",
      observedAt: "2026-11-03T00:00:00Z",
      teams: f.inputs.halves[0].teams.map((team) => ({
        ...team,
        freeThrowsMade: 12,
      })),
    },
    {
      ...f.inputs.halves[0],
      id: "missing",
      gameId: "missing",
      teams: f.inputs.halves[0].teams.map((team) => ({
        ...team,
        freeThrowsMade: undefined,
      })),
    },
  ];
  expect(estimate([...f.inputs.halves, ...invalid])).toEqual(original);
  f.inputs.excludedHistoryGames = f.inputs.halves
    .slice(0, 11)
    .map((half) => half.gameId);
  expect(
    captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at).forecasts[0]
      .status,
  ).toBe("data_gap");
});

it("centers league-neutral exposure, caps point changes, and treats unidentifiable effects as missing", () => {
  const neutral = 2 * expectedBonusMinutes(9);
  expect(bonusPointsDelta(neutral, neutral, 1)).toBe(0);
  expect(bonusPointsDelta(40, 0, 1)).toBe(bonusFitRules.maximumAdjustment);
  expect(bonusPointsDelta(0, 40, 1)).toBe(-bonusFitRules.maximumAdjustment);
  const f = enhancedLabFixture();
  const halves = f.inputs.halves.map((half) => ({
    ...half,
    teams: half.teams.map((team) => ({ ...team, bonusMinutes: 5 })),
  }));
  expect(
    fitBonusPoints(
      halves,
      f.feed.season,
      "game",
      f.feed.predictions[0].startsAt,
      f.at,
    ),
  ).toBeNull();
});
