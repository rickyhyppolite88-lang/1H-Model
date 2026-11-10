import { describe, expect, it } from "vitest";
import { gradeLab } from "./lab";
import { currentLabFixture } from "./lab.test-fixture";
import { captureLab } from "./labCapture";
import {
  labComponentComparison,
  labComponentsToCsv,
  savedLabComponents,
} from "./labComponents";

function fixture() {
  const f = currentLabFixture();
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  const row = store.forecasts.find(
    (r) => r.methodId === "enhanced-baseline-v2",
  );
  if (!row?.context || !row.foulExposure) throw new Error("fixture");
  row.baselineTotal = 67;
  row.inputs.defenseAdjustedTotal = 68;
  Object.assign(row.context, {
    homeAwayAdjustment: 6,
    neutralAdjustment: 1,
    matchupAdjustment: -1,
    crowdAdjustment: 0,
    adjustment: 4,
    unboundedAdjustment: 6,
  });
  row.foulExposure.pointsAdjustment = -0.5;
  row.total = 71.5;
  row.line = 69.5;
  row.side = "OVER";
  row.status = "qualified";
  store.results.push({
    id: "r",
    gameId: row.gameId,
    season: row.season,
    startsAt: row.startsAt,
    observedAt: "2026-11-03T02:00:00Z",
    sourceCapturedAt: "2026-11-03T02:00:00Z",
    awayPoints: 35,
    homePoints: 34,
    source: "https://example.com/result",
  });
  return { row, store };
}

describe("frozen Lab component comparison", () => {
  it("holds the cohort and prices fixed, and reapplies the cap when removing context factors", () => {
    const { row, store } = fixture();
    expect(savedLabComponents(row)).toMatchObject({
      baseline: 67,
      defense: 68,
      context: 72,
      full: 71.5,
      noHomeAway: 67.5,
      noNeutral: 71.5,
    });
    const before = JSON.stringify(store);
    const rows = labComponentComparison([row], store);
    expect(rows.find((r) => r.key === "baseline")).toMatchObject({
      games: 1,
      mae: 2,
      wins: 1,
      losses: 0,
      delta: 0,
    });
    expect(rows.find((r) => r.key === "full")).toMatchObject({
      games: 1,
      mae: 2.5,
      delta: 0.5,
      wins: 0,
      losses: 1,
    });
    expect(JSON.stringify(store)).toBe(before);
    expect(labComponentsToCsv([row], store)).toContain(
      "same_lab_selected_cohort_wins",
    );
  });
  it("uses first decisions, excludes missing/pending/review rows, and keeps watch-only out of W/L", () => {
    const { row, store } = fixture();
    const watch = {
      ...row,
      id: "watch",
      gameId: "watch",
      status: "watch_only" as const,
    };
    const future = { ...row, id: "future", gameId: "future" };
    const missing = {
      ...row,
      id: "missing",
      gameId: "missing",
      context: undefined,
    };
    const review = { ...row, id: "review", gameId: "review" };
    store.results.push(
      ...[watch, missing, review].map((r) => ({
        ...store.results[0],
        id: r.gameId,
        gameId: r.gameId,
        ...(r === review ? { startsAt: "2026-11-04T00:00:00Z" } : {}),
      })),
    );
    const revised = {
      ...row,
      id: "later",
      version: 2,
      recordedAt: "2026-11-02T23:00:00Z",
      total: 100,
    };
    const rows = labComponentComparison(
      [revised, row, watch, future, missing, review],
      store,
    );
    expect(rows.every((r) => r.games === 2)).toBe(true);
    expect(rows.find((r) => r.key === "full")).toMatchObject({
      wins: 0,
      losses: 1,
    });
    expect(gradeLab(review, store).grade).toBe("Schedule review");
  });
  it("measures reconciled PBP at a corrected start, matching both team IDs and scores", () => {
    const { row, store } = fixture();
    if (!row.context || !row.foulExposure || !row.participants)
      throw new Error("fixture");
    store.results[0] = {
      ...store.results[0],
      startsAt: "2026-11-03T00:45:00Z",
      source:
        "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
      participants: row.participants,
      context: row.context.context,
    };
    store.halves.push({
      ...currentLabFixture().inputs.halves[0],
      id: "actual",
      gameId: row.gameId,
      startsAt: "2026-11-03T00:45:00Z",
      teams: [
        {
          ...currentLabFixture().inputs.halves[0].teams[0],
          espnId: row.foulExposure.awayEspnId,
          points: 35,
        },
        {
          ...currentLabFixture().inputs.halves[0].teams[1],
          espnId: row.foulExposure.homeEspnId,
          points: 34,
        },
      ],
    });
    expect(gradeLab(row, store)).toMatchObject({
      schedule: "verified_time_change",
      grade: "Loss",
    });
    expect(gradeLab(row, store).actualFTA).not.toBeNull();
    const actualHalf = store.halves.at(-1);
    if (!actualHalf) throw new Error("fixture");
    actualHalf.teams[0].points = 34;
    actualHalf.teams[1].points = 35;
    expect(gradeLab(row, store).actualFTA).toBeNull();
  });
});
