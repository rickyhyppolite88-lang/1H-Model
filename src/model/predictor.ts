import type { BlendedTeam } from "./seasons";

export type Side = "OVER" | "UNDER";
export type Phase = "regular" | "tournament";
export interface RuleInput {
  projectedTotal: number;
  line: number;
  paceA: number;
  paceB: number;
  oeA: number;
  oeB: number;
  sosA: number | null;
  sosB: number | null;
  injuries: number;
}
export interface RuleResult {
  pick: Side | "NO BET";
  modelLean: Side | "PUSH";
  tier: string;
  edge: number;
  confidenceLabel: string | null;
  confidenceBoost: number;
  reasons: string[];
}

export function applyRules(input: RuleInput): RuleResult {
  const { projectedTotal, line, paceA, paceB, oeA, oeB, sosA, sosB, injuries } =
    input;
  for (const value of [
    projectedTotal,
    line,
    paceA,
    paceB,
    oeA,
    oeB,
    injuries,
  ]) {
    if (!Number.isFinite(value))
      throw new Error("Model inputs must be finite numbers.");
  }
  if (
    line <= 0 ||
    projectedTotal < 0 ||
    paceA <= 0 ||
    paceB <= 0 ||
    oeA <= 0 ||
    oeB <= 0 ||
    injuries < 0 ||
    !Number.isInteger(injuries)
  ) {
    throw new Error(
      "Totals, pace and efficiencies must be positive; injuries must be a nonnegative integer.",
    );
  }
  for (const sos of [sosA, sosB]) {
    if (sos !== null && !Number.isFinite(sos))
      throw new Error("Schedule strength must be finite or unknown.");
  }
  const signed = projectedTotal - line;
  const edge = Math.abs(signed);
  const modelLean =
    Math.abs(signed) < 1e-9 ? "PUSH" : signed > 0 ? "OVER" : "UNDER";
  const paceDiff = Math.abs(paceA - paceB);
  const result: RuleResult = {
    pick: "NO BET",
    modelLean,
    tier: "FILTERED",
    edge,
    confidenceLabel: null,
    confidenceBoost: 0,
    reasons: [],
  };
  if (Math.min(oeA, oeB) < 0.96) {
    result.reasons.push(
      "An offensive efficiency is below 0.96; this blocks every tier.",
    );
    return result;
  }
  const paceOver =
    paceDiff >= 5 &&
    Math.min(oeA, oeB) >= 1.05 &&
    sosA !== null &&
    sosB !== null &&
    sosA > 0 &&
    sosB > 0;
  if (paceOver) {
    if (injuries >= 3) {
      result.reasons.push(
        "PACE OVER matched, but 3+ combined reported injuries block an OVER.",
      );
      return result;
    }
    return {
      ...result,
      pick: "OVER",
      tier: "PACE OVER",
      confidenceLabel: "75%",
      reasons: [
        "Pace gap ≥ 5, both offenses ≥ 1.05, and both current-season schedule ratings > 0.",
        "PACE OVER takes precedence over the model lean and the edge filters.",
      ],
    };
  }
  if (edge >= 8) {
    result.reasons.push("The 8+ point edge trap blocks this matchup.");
    return result;
  }
  if (edge < 1.5 || modelLean === "PUSH") {
    result.reasons.push("The model edge is below 1.5 points.");
    return result;
  }
  if (modelLean === "OVER" && (edge < 2 || injuries >= 3)) {
    result.reasons.push(
      injuries >= 3
        ? "3+ combined reported injuries block an OVER."
        : "An OVER needs at least a 2-point model edge.",
    );
    return result;
  }
  if (modelLean === "UNDER" && line < 68 && edge >= 2 && edge <= 3) {
    return {
      ...result,
      pick: "UNDER",
      tier: "LOCK",
      confidenceLabel: "95%",
      reasons: [
        "Line < 68 and an UNDER edge from 2 through 3 match the saved LOCK rule.",
      ],
    };
  }
  result.pick = modelLean;
  result.tier = "STANDARD";
  if (modelLean === "UNDER") {
    if (edge < 2) result.confidenceLabel = "70%";
    if (edge >= 2 && edge <= 3) {
      result.tier = "PRIME UNDER";
      result.confidenceBoost += 15;
      result.reasons.push(
        "The 2–3 point UNDER edge adds 15 to the historical rule label.",
      );
    }
    if (line < 68) result.confidenceBoost += 5;
    if (paceDiff >= 2 && paceDiff <= 4) result.confidenceBoost += 5;
  } else if (edge >= 2 && edge <= 5) result.confidenceLabel = "80–85%";
  if (result.confidenceLabel === "70%" && result.confidenceBoost > 0) {
    result.confidenceLabel = `${70 + result.confidenceBoost}%`;
  }
  if (!result.confidenceLabel)
    result.reasons.push(
      "The saved notes do not specify a base confidence for this range; no probability is invented.",
    );
  result.reasons.push(
    `The weighted model leans ${modelLean} by ${edge.toFixed(2)} points.`,
  );
  return result;
}

export function predict(
  a: BlendedTeam,
  b: BlendedTeam,
  line: number,
  phase: Phase,
  injuries: number,
) {
  if (a.id === b.id) throw new Error("Choose two different teams.");
  const simpleTotal = a.firstHalfPoints + b.firstHalfPoints;
  const expectedPace = (a.pace + b.pace) / 2;
  const offenseA = (a.offensiveEfficiency + b.defensiveEfficiency) / 2;
  const offenseB = (b.offensiveEfficiency + a.defensiveEfficiency) / 2;
  // Reconstructed pace component; the original implementation was not recovered.
  const paceAdjustedTotal = (expectedPace * (offenseA + offenseB)) / 2;
  const suppression = phase === "tournament" ? 4 : 0;
  const projectedTotal =
    simpleTotal * 0.6 + paceAdjustedTotal * 0.4 - suppression;
  return {
    simpleTotal,
    expectedPace,
    paceAdjustedTotal,
    suppression,
    projectedTotal,
    ...applyRules({
      projectedTotal,
      line,
      paceA: a.pace,
      paceB: b.pace,
      oeA: a.offensiveEfficiency,
      oeB: b.offensiveEfficiency,
      sosA: a.strengthOfSchedule,
      sosB: b.strengthOfSchedule,
      injuries,
    }),
  };
}
