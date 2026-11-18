import { expect, it } from "vitest";
import {
  canonicalLabForecasts,
  gradeLab,
  type LabStore,
  labForecastSchema,
  labSummary,
} from "./lab";
import { captureResearchForecast } from "./labResearch";
import { researchFixture } from "./labResearch.test-fixture";
import { labUnitPlay, updateUnitLedger } from "./units";

function fixture() {
  const f = researchFixture();
  f.at = "2026-11-02T23:00:00Z";
  f.feed.marketCapturedAt = f.at;
  f.game.quotes[0].latestCapturedAt = f.at;
  f.refs.checks[0].checkedAt = f.at;
  f.refs.assignments[0].observedAt = f.at;
  f.model.coefficients = [0, 0];
  const forecast = (
    method:
      | "market-paper-v3"
      | "referee-paper-v4"
      | "market-core-v3" = "market-paper-v3",
  ) =>
    labForecastSchema.parse(
      captureResearchForecast(
        method,
        f.row,
        f.game,
        f.feed,
        f.model,
        f.modelPath,
        f.halves,
        f.refs,
        f.at,
      ),
    );
  const store = (forecasts: LabStore["forecasts"]): LabStore => ({
    schemaVersion: 1,
    startedAt: f.at,
    updatedAt: f.at,
    forecasts,
    results: [],
    halves: [],
  });
  return { f, forecast, store };
}

it("records 1u paper below the return threshold and outside the last 15 minutes, preserving the earlier filtered method", () => {
  const { f, forecast, store } = fixture();
  const trial = { ...forecast(), id: "first" };
  expect(trial.status).toBe("paper_test");
  expect(trial.research?.expectedReturn).toBeLessThan(0);
  expect(trial.research?.selectionPolicy).toBe("all-usable-paper-v1");
  expect(forecast("market-core-v3").status).toBe("watch_only");
  const lab = store([trial]);
  const ledger = updateUnitLedger(null, f.store, lab, f.at);
  expect(ledger.assignments).toHaveLength(1);
  expect(ledger.assignments[0].units).toBe(1);
  expect(labUnitPlay(trial, lab, ledger).entryPolicy).toBe(
    "last-usable-paper-v1",
  );
  expect(labUnitPlay(trial, lab, null).units).toBeNull();
  expect(
    labForecastSchema.safeParse({ ...trial, status: "qualified" }).success,
  ).toBe(false);
});

it("counts the last usable pre-tip forecast once and never replaces it with a later gap or post-tip row", () => {
  const { f, forecast, store } = fixture();
  const first = { ...forecast(), id: "first" };
  const original = JSON.stringify(first);
  const lab = store([first]);
  const initial = updateUnitLedger(null, f.store, lab, f.at);
  f.at = "2026-11-02T23:20:00Z";
  f.feed.marketCapturedAt = f.at;
  f.game.quotes[0].latestCapturedAt = f.at;
  if (!f.game.quotes[0].latest) throw new Error("fixture");
  f.game.quotes[0].latest.total = 71.5;
  const last = { ...forecast(), id: "last", version: 2 };
  const gap = labForecastSchema.parse({
    ...last,
    id: "gap",
    version: 3,
    status: "data_gap",
    recordedAt: "2026-11-02T23:30:00Z",
    research: { ...last.research, paperUnits: 0, probability: null },
  });
  lab.forecasts.push(last, gap);
  const ledger = updateUnitLedger(initial, f.store, lab, f.at);
  expect(JSON.stringify(first)).toBe(original);
  expect(ledger.assignments).toHaveLength(2);
  expect(canonicalLabForecasts(lab.forecasts).map((r) => r.id)).toEqual([
    "last",
  ]);
  const postTip = {
    ...last,
    id: "post",
    version: 4,
    recordedAt: "2026-11-03T00:01:00Z",
  };
  expect(labForecastSchema.safeParse(postTip).success).toBe(false);
  expect(
    canonicalLabForecasts([...lab.forecasts, postTip]).map((r) => r.id),
  ).toEqual(["last"]);
  lab.results = [
    {
      id: "result",
      gameId: last.gameId,
      season: last.season,
      startsAt: last.startsAt,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      source: "https://example.com/result",
      awayPoints: 40,
      homePoints: 40,
    },
  ];
  expect(labSummary(lab.forecasts, lab).wins).toBe(1);
  expect(labUnitPlay(last, lab, ledger).net).toBeCloseTo(100 / 115);
  expect(
    updateUnitLedger(null, f.store, lab, "2026-11-03T01:00:00Z").assignments,
  ).toEqual([]);
});

it("grades integer paper lines as pushes without estimating return", () => {
  const { f, forecast, store } = fixture();
  if (!f.game.quotes[0].latest) throw new Error("fixture");
  f.game.quotes[0].latest.total = 70;
  const row = { ...forecast(), id: "integer" };
  expect(row.status).toBe("paper_test");
  expect(row.research?.expectedReturn).toBeNull();
  const lab = store([row]);
  const ledger = updateUnitLedger(null, f.store, lab, f.at);
  lab.results = [
    {
      id: "push",
      gameId: row.gameId,
      season: row.season,
      startsAt: row.startsAt,
      observedAt: "2026-11-03T01:00:00Z",
      sourceCapturedAt: "2026-11-03T01:00:00Z",
      source: "https://example.com/result",
      awayPoints: 35,
      homePoints: 35,
    },
  ];
  expect(gradeLab(row, lab).grade).toBe("Push");
  expect(labUnitPlay(row, lab, ledger).net).toBe(0);
});

it("uses neutral shrunk priors for new verified officials but never invents a missing crew", () => {
  const { f, forecast } = fixture();
  f.model.refereeProfiles = [];
  const row = forecast("referee-paper-v4");
  expect(row.status).toBe("paper_test");
  expect(row.research?.refereePointsEquivalent).toBe(0);
  expect(row.research?.crew.map((r) => r.pricedGames)).toEqual([0, 0, 0]);
  expect(row.reason).toContain("neutral prior");
  f.refs.checks[0].assignmentId = null;
  expect(forecast("referee-paper-v4").status).toBe("data_gap");
});
