import { describe, expect, it } from "vitest";
import {
  canonicalLabForecasts,
  type LabHalf,
  type LabStore,
  labForecastSchema,
} from "./lab";
import { captureLab } from "./labCapture";
import {
  captureFeatureForecast,
  featureAdjustment,
  fitFeatureModel,
} from "./labFeatures";
import { researchFixture } from "./labResearch.test-fixture";
import { labUnitPlay, updateUnitLedger } from "./units";

function fixture() {
  const f = researchFixture();
  if (!f.game.featureSnapshot) throw new Error("No features");
  f.game.featureSnapshot.away.currentWeight = 0.5;
  f.game.featureSnapshot.home.currentWeight = 0.5;
  const half = (
    i: number,
    a: string,
    b: string,
    pa: number,
    pb: number,
    ma = 3,
    mb = 3,
  ): LabHalf => ({
    ...f.halves[0],
    id: `h${i}`,
    gameId: `g${i}`,
    teams: [
      { ...f.halves[0].teams[0], espnId: a, points: pa, threeMade: ma },
      { ...f.halves[0].teams[1], espnId: b, points: pb, threeMade: mb },
    ],
  });
  const halves: LabHalf[] = [];
  for (let i = 0; i < 12; i++) {
    halves.push(half(i * 4, "1", "weak", 45, 35, 5, 3));
    halves.push(half(i * 4 + 1, "2", "strong", 25, 35, 3, 3));
    halves.push(half(i * 4 + 2, "anchor", "weak", 45, 35));
    halves.push(half(i * 4 + 3, "anchor", "strong", 25, 35));
  }
  const model = fitFeatureModel(halves, f.feed.season, f.at, "test");
  const row = (
    method: "opponent-paper-v5" | "shooting-paper-v6" = "opponent-paper-v5",
  ) =>
    captureFeatureForecast(
      method,
      f.row,
      f.game,
      f.feed,
      model,
      "data/lab-feature-models/test.json",
      f.at,
    );
  return { ...f, halves, model, forecast: row };
}

describe("isolated first-half trials", () => {
  it("adjusts scoring for past opponent defenses, against an equally shrunk control", () => {
    const f = fixture();
    expect(f.model.teams["1"].scheduleDeltaRate).toBeLessThan(0);
    expect(f.model.teams["2"].scheduleDeltaRate).toBeGreaterThan(0);
  });
  it("regresses hot conversion while retaining attempts and keeping the other trial isolated", () => {
    const f = fixture(),
      team = f.model.teams["1"];
    expect(team.rawThreeRate).toBe(0.5);
    expect(team.regressedThreeRate).toBeLessThan(0.5);
    expect(team.shootingDeltaRate).toBeLessThan(0);
    expect(f.forecast("shooting-paper-v6").feature?.away.deltaRate).toBe(
      team.shootingDeltaRate,
    );
    expect(f.forecast().feature?.away.deltaRate).toBe(team.scheduleDeltaRate);
  });
  it("ignores future observations, later corrections, same-day outcomes and non-D1 halves", () => {
    const f = fixture();
    const altered = [
      ...f.halves,
      {
        ...f.halves[0],
        id: "later-correction",
        observedAt: "2026-11-03T12:00:00Z",
        teams: f.halves[0].teams.map((t) => ({ ...t, points: 99 })),
      },
      {
        ...f.halves[1],
        id: "same-day",
        gameId: "same-day",
        startsAt: "2026-11-02T10:00:00Z",
        observedAt: "2026-11-02T12:00:00Z",
      },
      { ...f.halves[2], id: "non-D1", gameId: "non-D1", bothD1: false },
    ];
    expect(fitFeatureModel(altered, f.feed.season, f.at, "test")).toEqual(
      f.model,
    );
  });
  it("filters other seasons, invalid shot counts and collector exclusions", () => {
    const f = fixture();
    expect(
      fitFeatureModel(f.halves, f.feed.season, f.at, "test", ["g0"])
        .trainingGames,
    ).toBe(47);
    const h = {
      ...f.halves[0],
      id: "other-season",
      gameId: "other-season",
      season: "2025-26",
    };
    const bad = {
      ...f.halves[0],
      id: "bad",
      gameId: "bad",
      teams: f.halves[0].teams.map((t) => ({ ...t, threeMade: 99 })),
    };
    expect(
      fitFeatureModel([...f.halves, h, bad], f.feed.season, f.at, "test")
        .trainingGames,
    ).toBe(48);
  });
  it("weights only the current-season scoring branch and caps adjustments", () => {
    const f = fixture(),
      g = structuredClone(f.game);
    if (!g.featureSnapshot) throw new Error("No features");
    g.featureSnapshot.away.currentWeight = 0;
    g.featureSnapshot.home.currentWeight = 0;
    expect(
      featureAdjustment("opponent-paper-v5", f.model, g, "test")?.adjustment,
    ).toBe(0);
    f.model.teams["1"].scheduleDeltaRate = 100;
    expect(
      featureAdjustment("opponent-paper-v5", f.model, f.game, "test")
        ?.adjustment,
    ).toBe(3);
    const row = f.forecast();
    expect(row.total).toBeCloseTo(
      (row.simpleTotal ?? 0) * 0.6 + (row.paceTotal ?? 0) * 0.4,
    );
  });
  it("keeps zero-attempt teams usable with a neutral shooting adjustment", () => {
    const f = fixture();
    const halves = f.halves.map((h) => ({
      ...h,
      teams: h.teams.map((t) =>
        t.espnId === "1" ? { ...t, threeMade: 0, threeAttempted: 0 } : t,
      ),
    }));
    const m = fitFeatureModel(halves, f.feed.season, f.at, "test");
    expect(m.teams["1"].rawThreeRate).toBeNull();
    expect(m.teams["1"].shootingDeltaRate).toBe(0);
  });
  it("produces prospective 1u paper entries, immutable versions and recorded-only units", () => {
    const f = fixture();
    const row = labForecastSchema.parse(f.forecast());
    expect(row.status).toBe("paper_test");
    expect(row.research).toBeUndefined();
    expect(row.feature?.paperUnits).toBe(1);
    const store: LabStore = {
      schemaVersion: 1,
      startedAt: f.at,
      updatedAt: f.at,
      forecasts: [row],
      results: [],
      halves: [],
    };
    expect(labUnitPlay(row, store, null).units).toBeNull();
    const actual = {
      schemaVersion: 1 as const,
      updatedAt: f.at,
      records: [],
      results: [],
    };
    const ledger = updateUnitLedger(null, actual, store, f.at);
    expect(labUnitPlay(row, store, ledger).units).toBe(1);
    if (!row.feature) throw new Error("Missing component inputs");
    const gap = {
      ...row,
      id: "gap",
      version: 2,
      recordedAt: "2026-11-02T23:55:00Z",
      status: "data_gap" as const,
      feature: { ...row.feature, paperUnits: 0 as const },
    };
    expect(canonicalLabForecasts([row, gap])).toEqual([row]);
  });
  it("does not manufacture a forecast for missing team history or insufficient league data", () => {
    const f = fixture();
    delete f.model.teams["1"];
    expect(f.forecast().status).toBe("data_gap");
    expect(
      featureAdjustment(
        "shooting-paper-v6",
        fitFeatureModel(f.halves.slice(0, 4), f.feed.season, f.at, "test"),
        f.game,
        "test",
      ),
    ).toBeNull();
  });
  it("blocks stale, future and missing-price quotes, future models, and post-tip entries", () => {
    const f = fixture();
    if (!f.game.quotes[0].latest) throw new Error("No quote");
    f.game.quotes[0].latestCapturedAt = "2026-11-02T22:00:00Z";
    expect(f.forecast().status).toBe("data_gap");
    f.game.quotes[0].latestCapturedAt = "2026-11-03T00:00:00Z";
    expect(f.forecast().status).toBe("data_gap");
    f.game.quotes[0].latestCapturedAt = f.at;
    f.game.quotes[0].latest.underPrice = null;
    expect(f.forecast().status).toBe("data_gap");
    f.game.quotes[0].latest.underPrice = -110;
    f.model.fittedAt = "2026-11-03T00:00:00Z";
    expect(f.forecast().status).toBe("data_gap");
    f.model.fittedAt = f.at;
    f.row.startsAt = f.at;
    expect(f.forecast().status).toBe("data_gap");
  });
  it("leaves an 8+ point gap as review-only instead of a forced play", () => {
    const f = fixture();
    f.row.projectedFirstHalfTotal = 99;
    expect(f.forecast().status).toBe("watch_only");
    expect(f.forecast().feature?.paperUnits).toBe(0);
  });
  it("captures through the shared pipeline without modifying original methods or the input feed", () => {
    const f = fixture(),
      before = JSON.stringify(f.feed);
    const store: LabStore = {
      schemaVersion: 1,
      startedAt: f.at,
      updatedAt: f.at,
      forecasts: [],
      results: [],
      halves: [],
    };
    const config = {
      schemaVersion: 1 as const,
      methods: [
        { id: "opponent-paper-v5" as const, enabled: true },
        { id: "shooting-paper-v6" as const, enabled: true },
      ],
    };
    const inputs: Parameters<typeof captureLab>[4] = {
      prior: {
        schemaVersion: 1,
        season: "2025-26",
        asOf: "2026-04-07",
        retrievedAt: "2026-04-07T00:00:00Z",
        source: { name: "test", urls: {} },
        teams: [],
      },
      priorPath: "test",
      snapshots: [],
      halves: f.halves,
      featureModel: f.model,
      featureModelPath: "data/lab-feature-models/test.json",
    };
    // This path does not use prior/snapshot inputs; the fixture's archived features are authoritative.
    const out = captureLab(store, config, f.feed, f.ledger, inputs, f.at);
    expect(out.forecasts).toHaveLength(2);
    expect(out.forecasts.every((r) => r.status === "paper_test")).toBe(true);
    expect(JSON.stringify(f.feed)).toBe(before);
    expect(
      captureLab(out, config, f.feed, f.ledger, inputs, f.at).forecasts,
    ).toHaveLength(2);
  });
});
