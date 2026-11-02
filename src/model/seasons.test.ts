import { describe, expect, it } from "vitest";
import { datasetSchema, type SeasonDataset, type TeamStats } from "./schema";
import { assertSnapshots, blendTeam } from "./seasons";

const oldTeam: TeamStats = {
  id: "a",
  name: "Team A",
  gamesPlayed: 30,
  firstHalfPoints: 30,
  pace: 60,
  offensiveEfficiency: 1,
  defensiveEfficiency: 1,
  strengthOfSchedule: 8,
};
const prior: SeasonDataset = {
  schemaVersion: 1,
  season: "2025-26",
  asOf: "2026-04-07",
  retrievedAt: "2026-11-02T12:00:00Z",
  source: { name: "Test", urls: {} },
  teams: [
    oldTeam,
    { ...oldTeam, id: "b", name: "Team B", firstHalfPoints: 40, pace: 80 },
  ],
};
const makeCurrent = (games: number): SeasonDataset => ({
  ...prior,
  season: "2026-27",
  asOf: "2026-11-02",
  teams: [
    {
      ...oldTeam,
      gamesPlayed: games,
      firstHalfPoints: 40,
      pace: 80,
      strengthOfSchedule: 0,
    },
  ],
});
const settings = { priorEquivalentGames: 8, leagueRegression: 0 };

describe("season transition", () => {
  it.each([
    [0, 0],
    [8, 0.5],
    [24, 0.75],
  ])("%s new games carry %s current weight", (games, weight) => {
    const team = blendTeam(
      "a",
      prior,
      makeCurrent(games),
      settings,
      "2026-11-02",
    );
    expect(team.currentWeight).toBe(weight);
    expect(team.firstHalfPoints).toBe(30 * (1 - weight) + 40 * weight);
  });
  it("regresses prior team stats toward the prior league average", () => {
    const team = blendTeam(
      "a",
      prior,
      makeCurrent(0),
      { ...settings, leagueRegression: 0.5 },
      "2026-11-02",
    );
    expect(team.firstHalfPoints).toBe(32.5);
    expect(team.pace).toBe(65);
  });
  it("uses league prior for a team without prior-season stats", () => {
    const current = makeCurrent(0);
    current.teams[0] = { ...current.teams[0], id: "new" };
    expect(
      blendTeam("new", prior, current, settings, "2026-11-02"),
    ).toMatchObject({
      firstHalfPoints: 35,
      pace: 70,
      priorAvailable: false,
      currentWeight: 0,
    });
  });
  it("does not carry last year's schedule into the current PACE rule", () => {
    expect(
      blendTeam("a", prior, makeCurrent(0), settings, "2026-11-02")
        .strengthOfSchedule,
    ).toBeNull();
    expect(
      blendTeam("a", prior, makeCurrent(8), settings, "2026-11-02")
        .strengthOfSchedule,
    ).toBe(0);
  });
  it("treats missing current observations as missing, not zero", () => {
    const current = makeCurrent(5);
    current.teams[0].pace = null;
    const team = blendTeam("a", prior, current, settings, "2026-11-02");
    expect(team.currentWeight).toBe(0);
    expect(team.firstHalfPoints).toBe(30);
    expect(team.notes.join(" ")).toContain("incomplete");
  });
  it("blocks a snapshot newer than a matchup", () => {
    expect(() => assertSnapshots(prior, makeCurrent(5), "2026-11-01")).toThrow(
      "newer",
    );
  });
  it("blocks nonconsecutive seasons and prediction dates outside the season", () => {
    expect(() =>
      assertSnapshots(
        prior,
        { ...makeCurrent(0), season: "2027-28" },
        "2027-11-02",
      ),
    ).toThrow("consecutive");
    expect(() => assertSnapshots(prior, makeCurrent(0), "2027-11-02")).toThrow(
      "belong",
    );
  });
  it("validates snapshot dates and duplicate team IDs", () => {
    expect(
      datasetSchema.safeParse({ ...prior, asOf: "2026-11-02" }).success,
    ).toBe(false);
    expect(
      datasetSchema.safeParse({ ...prior, teams: [oldTeam, oldTeam] }).success,
    ).toBe(false);
  });
  it("rejects an invalid prior weight", () => {
    expect(() =>
      blendTeam(
        "a",
        prior,
        makeCurrent(0),
        { ...settings, priorEquivalentGames: 0 },
        "2026-11-02",
      ),
    ).toThrow();
  });
});
