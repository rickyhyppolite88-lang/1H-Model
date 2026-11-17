import { expect, it } from "vitest";
import { type LabStore, labForecastSchema } from "./lab";
import {
  captureResearchForecast,
  fairOverProbability,
  fitMarketCoefficients,
  researchTrainingRows,
  returnPerUnit,
  shotOpportunity,
} from "./labResearch";
import { researchFixture } from "./labResearch.test-fixture";
import { updatePredictionRecord } from "./predictionRecord";
import { labUnitPlay, updateUnitLedger } from "./units";

it("removes the displayed margin and uses actual side prices for expected return", () => {
  expect(fairOverProbability(-110, -110)).toBe(0.5);
  expect(fairOverProbability(0, -110)).toBeNull();
  expect(returnPerUnit(0.6, -120)).toBeCloseTo(0.1);
  expect(returnPerUnit(0.55, 110)).toBeCloseTo(0.155);
});

it("fits deterministically and shrinks unsupported information to the market prior", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    features: [i % 2 ? 1 : -1, 0],
    market: 0.5,
    over: !(i % 2),
  }));
  expect(fitMarketCoefficients(rows).coefficients).toEqual([0, 0]);
  const supported = rows.map((r) => ({ ...r, over: !r.over }));
  expect(fitMarketCoefficients(supported).coefficients[0]).toBeGreaterThan(0);
  expect(fitMarketCoefficients(supported)).toEqual(
    fitMarketCoefficients(supported),
  );
});

it("ignores future and same-game first-half measurements", () => {
  const f = researchFixture();
  const original = shotOpportunity(f.game.id, "1", "2", 35, f.halves, f.at);
  const extra = {
    ...f.halves[0],
    id: "future",
    gameId: "future",
    observedAt: "2026-11-03T01:00:00Z",
    teams: f.halves[0].teams.map((t) => ({ ...t, turnovers: 100 })),
  };
  expect(
    shotOpportunity(
      f.game.id,
      "1",
      "2",
      35,
      [...f.halves, extra, { ...extra, gameId: f.game.id, observedAt: f.at }],
      f.at,
    ),
  ).toBe(original);
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  store.results = [
    {
      id: "future-result",
      season: f.ledger.season,
      gameId: f.game.id,
      observedAt: "2026-11-03T13:00:00Z",
      sourceCapturedAt: "2026-11-03T13:00:00Z",
      source: "https://example.com/result",
      awayPoints: 35,
      homePoints: 35,
    },
  ];
  expect(
    researchTrainingRows(store, f.ledger, f.halves, "2026-11-03T12:00:00Z"),
  ).toEqual([]);
  store.results[0].observedAt = "2026-11-03T11:00:00Z";
  store.results[0].sourceCapturedAt = "2026-11-03T11:00:00Z";
  expect(
    researchTrainingRows(store, f.ledger, f.halves, "2026-11-03T12:00:00Z"),
  ).toHaveLength(1);
});

it("retains Actual's projection and direction, requires a final-window quote and records flat 1u paper", () => {
  const f = researchFixture();
  const row = captureResearchForecast(
    "market-core-v3",
    f.row,
    f.game,
    f.feed,
    f.model,
    f.modelPath,
    f.halves,
    f.refs,
    f.at,
  );
  expect(row.status).toBe("qualified");
  expect(row.total).toBe(f.row.projectedFirstHalfTotal);
  expect(row.side).toBe("OVER");
  expect(row.research?.paperUnits).toBe(1);
  const lab: LabStore = {
    schemaVersion: 1,
    startedAt: f.at,
    updatedAt: f.at,
    forecasts: [labForecastSchema.parse({ ...row, id: "paper" })],
    results: [],
    halves: f.halves,
  };
  const ledger = updateUnitLedger(null, f.store, lab, f.at);
  expect(ledger.assignments[0].units).toBe(1);
  expect(ledger.assignments[0].policy).toBe("lab-flat-paper-v1");
  expect(labUnitPlay(lab.forecasts[0], lab, null).units).toBeNull();
  f.game.quotes[0].latestCapturedAt = "2026-11-02T23:40:00Z";
  expect(
    captureResearchForecast(
      "market-core-v3",
      f.row,
      f.game,
      f.feed,
      f.model,
      f.modelPath,
      f.halves,
      f.refs,
      f.at,
    ).status,
  ).toBe("watch_only");
});

it("does not qualify integer lines, unavailable quotes or future daily models", () => {
  const f = researchFixture();
  // A later integer quote must never create an automatic paper stake.
  const quote = f.game.quotes[0].latest;
  if (!quote) throw new Error("Missing fixture quote");
  quote.total = 70.5;
  const forecast = () =>
    captureResearchForecast(
      "market-core-v3",
      f.row,
      f.game,
      f.feed,
      f.model,
      f.modelPath,
      f.halves,
      f.refs,
      f.at,
    );
  expect(forecast().status).toBe("qualified");
  quote.total = 70;
  expect(forecast().reason).toContain("Integer");
  f.model.fittedAt = "2026-11-03T00:00:00Z";
  expect(forecast().research?.probability).toBeNull();
  f.game.quotes[0].latestCapturedAt = "2026-11-03T01:00:00Z";
  expect(forecast().side).toBeNull();
});

it("v4 averages crew effects, requires pregame verification and never borrows a missing crew", () => {
  const f = researchFixture();
  const forecast = () =>
    captureResearchForecast(
      "referee-core-v4",
      f.row,
      f.game,
      f.feed,
      f.model,
      f.modelPath,
      f.halves,
      f.refs,
      f.at,
    );
  const row = forecast();
  expect(row.research?.refereePointsEquivalent).toBe(1);
  expect(row.research?.crew).toHaveLength(3);
  expect(row.research?.probability).toBeGreaterThan(
    row.research?.refereeBaselineProbability ?? 1,
  );
  f.refs.checks[0].assignmentId = null;
  expect(forecast().research?.probability).toBeNull();
  expect(forecast().status).toBe("data_gap");
  f.refs.checks[0].assignmentId = "crew";
  f.refs.assignments[0].observedAt = "2026-11-03T00:01:00Z";
  expect(forecast().research?.crew).toEqual([]);
});
