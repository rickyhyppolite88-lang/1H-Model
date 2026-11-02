import { describe, expect, it } from "vitest";
import { applyRules, predict, type RuleInput } from "./predictor";
import type { BlendedTeam } from "./seasons";

const base: RuleInput = {
  projectedTotal: 64,
  line: 66.5,
  paceA: 70,
  paceB: 70,
  oeA: 1.1,
  oeB: 1.1,
  sosA: 2,
  sosB: 1,
  injuries: 0,
};
const run = (changes: Partial<RuleInput> = {}) =>
  applyRules({ ...base, ...changes });
const paceOverride = { paceA: 75, paceB: 70 };

describe("saved v6.1 rule precedence", () => {
  it("matches LOCK only for line below 68 and an UNDER edge 2–3", () => {
    expect(run()).toMatchObject({
      pick: "UNDER",
      tier: "LOCK",
      confidenceLabel: "95%",
    });
    expect(run({ line: 68, projectedTotal: 65.5 }).tier).toBe("PRIME UNDER");
  });
  it.each([2, 3])("includes the %s-point UNDER boundary", (edge) => {
    expect(run({ projectedTotal: 66.5 - edge }).tier).toBe("LOCK");
  });
  it("lets PACE OVER override the lean and the 8+ trap", () => {
    expect(run({ ...paceOverride, projectedTotal: 50 })).toMatchObject({
      pick: "OVER",
      modelLean: "UNDER",
      tier: "PACE OVER",
      confidenceLabel: "75%",
    });
  });
  it("OE below 0.96 overrides PACE OVER and LOCK", () => {
    expect(run({ ...paceOverride, oeA: 0.959 }).pick).toBe("NO BET");
    expect(run({ oeB: 0.959 }).pick).toBe("NO BET");
  });
  it("allows OE exactly 0.96 for an UNDER", () => {
    expect(run({ oeA: 0.96 }).pick).toBe("UNDER");
  });
  it("requires both positive current-season SOS values for PACE OVER", () => {
    expect(run({ ...paceOverride, sosA: null }).tier).not.toBe("PACE OVER");
    expect(run({ ...paceOverride, sosB: 0 }).tier).not.toBe("PACE OVER");
    expect(run({ ...paceOverride, oeA: 1.049 }).tier).not.toBe("PACE OVER");
  });
  it("three combined injuries block OVER even on PACE OVER", () => {
    expect(run({ ...paceOverride, injuries: 3 }).pick).toBe("NO BET");
    expect(run({ projectedTotal: 69, injuries: 3 }).pick).toBe("NO BET");
    expect(run({ injuries: 3 }).pick).toBe("UNDER");
  });
  it.each([8, 9])("blocks an ordinary %s-point edge", (edge) => {
    expect(run({ projectedTotal: 66.5 + edge }).pick).toBe("NO BET");
  });
  it.each([0, 1, 1.49])("blocks a %s-point edge", (edge) => {
    expect(run({ projectedTotal: 66.5 - edge }).pick).toBe("NO BET");
  });
  it("allows a 1.5-point UNDER but never a sub-2 OVER", () => {
    expect(run({ line: 70, projectedTotal: 68.5 })).toMatchObject({
      pick: "UNDER",
      confidenceLabel: "70%",
    });
    expect(run({ projectedTotal: 68 })).toMatchObject({ pick: "NO BET" });
  });
  it("does not invent a base confidence for PRIME UNDER", () => {
    expect(run({ line: 70, projectedTotal: 67.5 })).toMatchObject({
      tier: "PRIME UNDER",
      confidenceLabel: null,
      confidenceBoost: 15,
    });
  });
  it("retains the documented OVER confidence range without a removed DE filter", () => {
    expect(run({ projectedTotal: 69 })).toMatchObject({
      pick: "OVER",
      confidenceLabel: "80–85%",
    });
  });
  it("rejects invalid numerical inputs", () => {
    expect(() => run({ line: Number.NaN })).toThrow();
    expect(() => run({ injuries: 1.5 })).toThrow();
    expect(() => run({ sosA: Number.POSITIVE_INFINITY })).toThrow();
  });
});

const team = (id: string): BlendedTeam => ({
  id,
  name: id,
  firstHalfPoints: 35,
  pace: 70,
  offensiveEfficiency: 1.1,
  defensiveEfficiency: 1,
  currentGames: 0,
  currentWeight: 0,
  priorAvailable: true,
  strengthOfSchedule: null,
  notes: [],
});

describe("projection reconstruction", () => {
  it("applies the saved suppression only in tournament context", () => {
    const regular = predict(team("a"), team("b"), 70, "regular", 0);
    const tournament = predict(team("a"), team("b"), 70, "tournament", 0);
    expect(regular.simpleTotal).toBe(70);
    expect(regular.paceAdjustedTotal).toBeCloseTo(73.5);
    expect(regular.projectedTotal).toBeCloseTo(71.4);
    expect(regular.projectedTotal - tournament.projectedTotal).toBeCloseTo(4);
  });
  it("rejects a team playing itself", () => {
    expect(() => predict(team("a"), team("a"), 70, "regular", 0)).toThrow();
  });
});
