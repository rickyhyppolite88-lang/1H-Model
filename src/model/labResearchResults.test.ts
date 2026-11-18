import { expect, it } from "vitest";
import { type LabStore, labForecastSchema } from "./lab";
import { captureResearchForecast } from "./labResearch";
import { researchFixture } from "./labResearch.test-fixture";
import { refereeForecastResults } from "./labResearchResults";

it("scores matched frozen V3/V4 estimates once per game including watch observations", () => {
  const f = researchFixture();
  const row = captureResearchForecast(
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
  if (!row.research) throw new Error("fixture");
  row.research.probability = 0.7;
  row.research.refereeBaselineProbability = 0.6;
  row.research.marketProbability = 0.5;
  const watch = labForecastSchema.parse({
    ...row,
    id: "last",
    version: 2,
    status: "watch_only",
    research: { ...row.research, paperUnits: 0 },
    recordedAt: "2026-11-02T23:55:00Z",
  });
  const store: LabStore = {
    schemaVersion: 1,
    startedAt: f.at,
    updatedAt: f.at,
    forecasts: [row, watch],
    halves: [],
    results: [
      {
        id: "r",
        season: row.season,
        gameId: row.gameId,
        startsAt: row.startsAt,
        observedAt: "2026-11-03T01:00:00Z",
        sourceCapturedAt: "2026-11-03T01:00:00Z",
        source: "https://example.com/result",
        awayPoints: 40,
        homePoints: 40,
      },
    ],
  };
  const result = refereeForecastResults(store);
  expect(result.overall.games).toBe(1);
  expect(result.overall.v3Brier).toBeCloseTo(0.16);
  expect(result.overall.v4Brier).toBeCloseTo(0.09);
  expect(result.overall.marketBrier).toBeCloseTo(0.25);
  expect(result.overall.qualifiedWins).toBe(0);
  expect(result.officials.a.games).toBe(1);
  store.results[0].startsAt = "2026-11-04T00:00:00Z";
  expect(refereeForecastResults(store).overall.games).toBe(0);
});

it("rejects qualified paper stakes without their saved research evidence", () => {
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
  expect(
    labForecastSchema.safeParse({ ...row, research: undefined }).success,
  ).toBe(false);
  expect(
    labForecastSchema.safeParse({
      ...row,
      research: { ...row.research, paperUnits: 0 },
    }).success,
  ).toBe(false);
});

it("counts a new referee paper trial once instead of duplicating its earlier filtered forecast", () => {
  const f = researchFixture();
  const strict = captureResearchForecast(
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
  const trial = captureResearchForecast(
    "referee-paper-v4",
    f.row,
    f.game,
    f.feed,
    f.model,
    f.modelPath,
    f.halves,
    f.refs,
    f.at,
  );
  const store: LabStore = {
    schemaVersion: 1,
    startedAt: f.at,
    updatedAt: f.at,
    forecasts: [
      { ...strict, id: "strict" },
      { ...trial, id: "trial" },
    ],
    halves: [],
    results: [
      {
        id: "result",
        gameId: trial.gameId,
        season: trial.season,
        startsAt: trial.startsAt,
        observedAt: "2026-11-03T01:00:00Z",
        sourceCapturedAt: "2026-11-03T01:00:00Z",
        source: "https://example.com/result",
        awayPoints: 40,
        homePoints: 40,
      },
    ],
  };
  expect(refereeForecastResults(store).overall.games).toBe(1);
  expect(refereeForecastResults(store).overall.qualifiedWins).toBe(1);
});
