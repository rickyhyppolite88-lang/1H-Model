import { describe, expect, it } from "vitest";
import { ledgerSchema, type SeasonGame } from "./audit";
import { projectFirstHalf } from "./predictor";
import { datasetSchema, type SeasonDataset } from "./schema";
import { blendTeam, defaultBlend } from "./seasons";
import { generateTeamEvaluation, teamEvaluationToCsv } from "./teamEvaluation";

const makeTeam = (id: string, score: number) => ({
  id,
  name: `Team ${id}`,
  gamesPlayed: 30,
  firstHalfPoints: score,
  firstHalfAllowed: 33,
  pace: 70,
  offensiveEfficiency: 1.1,
  defensiveEfficiency: 1.05,
  strengthOfSchedule: 1,
});
const prior = datasetSchema.parse({
  schemaVersion: 1,
  season: "2025-26",
  asOf: "2026-04-07",
  retrievedAt: "2026-11-02T10:00:00Z",
  source: { name: "fixture", urls: {} },
  teams: [makeTeam("a", 30), makeTeam("b", 35)],
});
const current: SeasonDataset = {
  ...prior,
  season: "2026-27",
  asOf: "2026-11-02",
  teams: [
    { ...makeTeam("a", 40), gamesPlayed: 8, firstHalfAllowed: 28 },
    { ...makeTeam("b", 42), gamesPlayed: 8 },
  ],
};
const zero = {
  ...current,
  teams: current.teams.map((t) => ({ ...t, gamesPlayed: 0 })),
};
const makeGame = (
  id: string,
  kind: "captured_pregame" | "reconstructed_season_debut",
): SeasonGame => ({
  id,
  startsAt: "2026-11-02T18:00:00Z",
  status: "Final",
  firstHalfComplete: true,
  seasonDebut: true,
  away: {
    espnId: "1",
    modelId: "a",
    name: "Team a",
    conferenceId: "23",
    conference: "SEC",
    rank: 25,
    rankKnown: true,
    firstHalfPoints: 34,
  },
  home: {
    espnId: "2",
    modelId: "b",
    name: "Team b",
    conferenceId: "2",
    conference: "ACC",
    rank: null,
    rankKnown: true,
    firstHalfPoints: 31,
  },
  quotes: [],
  scoresSource: "https://example.com/score",
  boxScoreUrl: "https://example.com/box",
  capturedAt: "2026-11-02T20:00:00Z",
  featureSnapshot: {
    kind,
    capturedAt: "2026-11-02T11:00:00Z",
    priorAsOf: prior.asOf,
    currentAsOf: kind === "captured_pregame" ? current.asOf : null,
    modelVersion: "season-bridge-v1",
    away: blendTeam(
      "a",
      prior,
      kind === "captured_pregame" ? current : zero,
      defaultBlend,
      current.asOf,
    ),
    home: blendTeam(
      "b",
      prior,
      kind === "captured_pregame" ? current : zero,
      defaultBlend,
      current.asOf,
    ),
  },
});
const ledger = ledgerSchema.parse({
  schemaVersion: 1,
  season: current.season,
  seasonStart: "2026-11-02",
  through: "2026-11-02",
  capturedAt: "2026-11-02T20:00:00Z",
  market: "first_half_total",
  games: [
    makeGame("pregame", "captured_pregame"),
    makeGame("reconstructed", "reconstructed_season_debut"),
  ],
  unmatchedOdds: [],
  notes: [],
});
const at = "2026-11-02T20:00:00Z";

describe("team season evaluation", () => {
  it("shows offense and defense changes in their original units and preserves the existing blend", () => {
    const report = generateTeamEvaluation(prior, current, ledger, at);
    const team = report.teams[0];
    expect(team.currentWeight).toBe(0.5);
    expect(team.metrics.find((m) => m.key === "firstHalfPoints")).toMatchObject(
      { prior: 30, current: 40, change: 10 },
    );
    expect(team.metrics.find((m) => m.key === "firstHalfAllowed")).toEqual({
      key: "firstHalfAllowed",
      prior: 33,
      current: 28,
      change: -5,
      blended: null,
    });
    expect(
      team.metrics.find((m) => m.key === "offensiveEfficiency")?.blended,
    ).toBe(
      blendTeam("a", prior, current, defaultBlend, current.asOf)
        .offensiveEfficiency,
    );
  });
  it("grades offense and defense without a sportsbook quote and keeps reconstructed cohorts separate", () => {
    const report = generateTeamEvaluation(prior, current, ledger, at);
    const game = report.games[0];
    const team = report.teams[0];
    expect(report.summary.prospective.sample).toBe(1);
    expect(report.summary.reconstructed.sample).toBe(1);
    expect(team.prospective.modelMae).toBeCloseTo(
      Math.abs((game.awayProjected ?? 0) - 34),
    );
    expect(team.prospective.defenseMae).toBeCloseTo(
      Math.abs((game.homeProjected ?? 0) - 31),
    );
    expect(game.modelTotal).toBeCloseTo(
      (game.awayProjected ?? 0) + (game.homeProjected ?? 0),
      12,
    );
    expect(game.shift).not.toBe(0);
    expect(report.games[1].shift).toBeCloseTo(0, 12);
  });
  it("uses frozen matchup features when the latest team statistics change", () => {
    const changed = structuredClone(current);
    changed.teams[0].firstHalfPoints = 60;
    const before = generateTeamEvaluation(prior, current, ledger, at);
    const after = generateTeamEvaluation(prior, changed, ledger, at);
    expect(after.games).toEqual(before.games);
    expect(after.teams[0].metrics[0].current).toBe(60);
  });
  it("does not score post-tipoff features or incomplete first halves as predictions", () => {
    const invalid = structuredClone(ledger);
    const first = invalid.games[0];
    if (!first.featureSnapshot) throw new Error("Missing fixture");
    first.featureSnapshot.capturedAt = "2026-11-02T19:00:00Z";
    invalid.games[1].firstHalfComplete = false;
    const report = generateTeamEvaluation(prior, current, invalid, at);
    expect(report.games[0].modelTotal).toBeNull();
    expect(report.games[1].actualTotal).toBeNull();
    expect(report.summary.prospective).toMatchObject({
      sample: 0,
      modelMae: null,
      defenseMae: null,
    });
    expect(report.summary.ungradedCompleted).toBe(1);
  });
  it("preserves team-split additivity in both model contexts", () => {
    const a = blendTeam("a", prior, current, defaultBlend, current.asOf);
    const b = blendTeam("b", prior, current, defaultBlend, current.asOf);
    for (const phase of ["regular", "tournament"] as const) {
      const p = projectFirstHalf(a, b, phase);
      expect(p.teamAFirstHalf + p.teamBFirstHalf).toBeCloseTo(
        p.projectedTotal,
        12,
      );
    }
  });
  it("leaves unobserved season metrics and grades unavailable and exports every team", () => {
    const report = generateTeamEvaluation(
      prior,
      zero,
      { ...ledger, games: [] },
      at,
    );
    expect(
      report.teams[0].metrics.every(
        (m) => m.current === null && m.change === null,
      ),
    ).toBe(true);
    expect(report.teams[0].prospective.modelMae).toBeNull();
    report.teams[0].name = "=SUM(1,2)";
    const csv = teamEvaluationToCsv(report);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"\'=SUM(1,2)"');
  });
});
