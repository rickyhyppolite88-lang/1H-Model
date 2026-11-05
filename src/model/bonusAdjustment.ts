import { type LabHalf, latestHalves } from "./lab";

export const bonusFitRules = {
  minimumGames: 30,
  priorGames: 50,
  maximumSlope: 1,
  maximumAdjustment: 2,
} as const;

/** Experimental association, fitted only to earlier, observed, reconciled halves.
 * Control for estimated possessions; shrink both slopes toward zero. This does
 * not identify the causal effect of the bonus, or optimize historical bet wins.
 */
export function fitBonusPoints(
  halves: LabHalf[],
  season: string,
  gameId: string,
  startsAt: string,
  at: string,
) {
  const history = latestHalves(halves, at).filter(
    (half) =>
      half.bothD1 &&
      half.season === season &&
      half.gameId !== gameId &&
      Date.parse(half.startsAt) < Date.parse(startsAt) &&
      half.teams.every((team) => team.freeThrowsMade !== undefined),
  );
  if (history.length < bonusFitRules.minimumGames) return null;
  const rows = history.map((half) => ({
    bonus: half.teams.reduce((sum, team) => sum + team.bonusMinutes, 0),
    possessions:
      half.teams.reduce(
        (sum, team) =>
          sum +
          team.fga -
          team.offensiveRebounds +
          team.turnovers +
          0.475 * team.fta,
        0,
      ) / 2,
    points: half.teams.reduce(
      (sum, team) => sum + (team.freeThrowsMade ?? 0),
      0,
    ),
  }));
  const mean = (key: keyof (typeof rows)[number]) =>
    rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const x = mean("bonus");
  const p = mean("possessions");
  const y = mean("points");
  let xx = 0;
  let pp = 0;
  let xp = 0;
  let xy = 0;
  let py = 0;
  for (const row of rows) {
    xx += (row.bonus - x) ** 2;
    pp += (row.possessions - p) ** 2;
    xp += (row.bonus - x) * (row.possessions - p);
    xy += (row.bonus - x) * (row.points - y);
    py += (row.possessions - p) * (row.points - y);
  }
  // No bonus variation means the effect cannot be estimated, rather than zero.
  if (xx < 1e-8) return null;
  const shrink = 1 + bonusFitRules.priorGames / rows.length;
  const tempoDenominator = pp * shrink;
  const denominator =
    xx * shrink - (tempoDenominator > 1e-8 ? xp ** 2 / tempoDenominator : 0);
  const rawSlope =
    (xy - (tempoDenominator > 1e-8 ? (xp * py) / tempoDenominator : 0)) /
    denominator;
  return {
    games: rows.length,
    rawSlope,
    slope: Math.max(0, Math.min(bonusFitRules.maximumSlope, rawSlope)),
  };
}

export function bonusPointsDelta(
  minutes: number,
  neutralMinutes: number,
  slope: number,
) {
  const cap = bonusFitRules.maximumAdjustment;
  return Math.max(-cap, Math.min(cap, (minutes - neutralMinutes) * slope));
}
