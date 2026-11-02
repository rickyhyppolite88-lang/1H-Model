import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completeMetrics, datasetSchema } from "./schema";
import { assertSnapshots, blendTeam, defaultBlend } from "./seasons";

describe("bundled public snapshots", () => {
  const prior = datasetSchema.parse(
    JSON.parse(readFileSync("public/data/prior-season.json", "utf8")),
  );
  const current = datasetSchema.parse(
    JSON.parse(readFileSync("public/data/current-season.json", "utf8")),
  );
  it("has full, consecutive, dated team baselines", () => {
    expect(prior.teams.length).toBeGreaterThanOrEqual(300);
    expect(current.teams.length).toBeGreaterThanOrEqual(300);
    expect(
      prior.teams.every(
        (team) => team.gamesPlayed > 0 && completeMetrics(team),
      ),
    ).toBe(true);
    expect(() => assertSnapshots(prior, current, current.asOf)).not.toThrow();
  });
  it("produces finite blended statistics for every current team", () => {
    for (const team of current.teams) {
      const blended = blendTeam(
        team.id,
        prior,
        current,
        defaultBlend,
        current.asOf,
      );
      expect(blended.firstHalfPoints).toBeGreaterThan(0);
      expect(blended.offensiveEfficiency).toBeLessThan(2);
      expect(blended.currentWeight).toBeLessThanOrEqual(1);
    }
  });
  it("never treats zero-game preseason data as observations", () => {
    for (const team of current.teams.filter((team) => team.gamesPlayed === 0)) {
      expect(team.firstHalfPoints).toBeNull();
      expect(team.strengthOfSchedule).toBeNull();
    }
  });
});
