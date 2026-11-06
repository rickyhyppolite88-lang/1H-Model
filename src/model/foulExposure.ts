import { z } from "zod";
import type { LabHalf } from "./lab";

const nonnegative = z.number().finite().min(0);
export const foulExposureSchema = z.object({
  awayEspnId: z.string(),
  homeEspnId: z.string(),
  expectedAwayFouls: nonnegative,
  expectedHomeFouls: nonnegative,
  awaySevenFoulProbability: z.number().min(0).max(1),
  homeSevenFoulProbability: z.number().min(0).max(1),
  awayFoulLow: nonnegative,
  awayFoulHigh: nonnegative,
  homeFoulLow: nonnegative,
  homeFoulHigh: nonnegative,
  expectedAwayFTA: nonnegative,
  expectedHomeFTA: nonnegative,
  awayFTALow: nonnegative,
  awayFTAHigh: nonnegative,
  homeFTALow: nonnegative,
  homeFTAHigh: nonnegative,
  baselineAwayFTA: nonnegative,
  baselineHomeFTA: nonnegative,
  awayFTPercent: z.number().min(0).max(1),
  homeFTPercent: z.number().min(0).max(1),
  pointsAdjustment: z.number().min(-2).max(2),
  unboundedPointsAdjustment: z.number().finite(),
  expectedHalfPossessions: nonnegative,
  leagueGames: z.number().int().min(30),
  awayHistoryGames: z.number().int().min(0),
  homeHistoryGames: z.number().int().min(0),
  ftaDispersion: z.number().finite().min(1),
  pseudoGames: z.literal(4),
});
export type FoulExposure = z.infer<typeof foulExposureSchema>;

/** Poisson proxy for logged nontechnical fouls; not calibrated referee odds. */
export function sevenFoulProbability(mean: number) {
  if (!Number.isFinite(mean) || mean < 0)
    throw new Error("Invalid foul expectation");
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 7; k++) {
    term *= mean / k;
    sum += term;
  }
  return Math.max(0, Math.min(1, 1 - Math.exp(-mean) * sum));
}

/** Central 80% model range. Gamma-Poisson dispersion allows clustered FT trips. */
export function countRange(mean: number, dispersion = 1): [number, number] {
  if (
    !Number.isFinite(mean) ||
    mean < 0 ||
    !Number.isFinite(dispersion) ||
    dispersion < 1
  )
    throw new Error("Invalid count distribution");
  if (mean === 0) return [0, 0];
  const over = dispersion > 1.000001;
  const p = 1 / dispersion;
  const shape = over ? mean / (dispersion - 1) : 0;
  let mass = over ? p ** shape : Math.exp(-mean);
  let cumulative = mass;
  let low: number | null = cumulative >= 0.1 ? 0 : null;
  if (cumulative >= 0.9) return [0, 0];
  for (let k = 1; k <= 1000; k++) {
    mass *= over ? ((k - 1 + shape) / k) * (1 - p) : mean / k;
    cumulative += mass;
    if (low === null && cumulative >= 0.1) low = k;
    if (cumulative >= 0.9) return [low ?? k, k];
  }
  throw new Error("Count range did not converge");
}

const possessions = (half: LabHalf) =>
  half.teams.reduce(
    (sum, t) => sum + t.fga - t.offensiveRebounds + t.turnovers + 0.475 * t.fta,
    0,
  ) / 2;

/** Caller supplies only latest, earlier, observed halves with unresolved sources excluded. */
export function forecastFoulExposure(
  awayId: string,
  homeId: string,
  pace: number,
  history: LabHalf[],
): FoulExposure | null {
  const league = history.filter(
    (half) =>
      half.bothD1 &&
      half.teams.every((team) => team.freeThrowsMade !== undefined) &&
      possessions(half) > 0,
  );
  if (league.length < 30 || !Number.isFinite(pace) || pace <= 0) return null;
  const teams = league.flatMap((half) => half.teams);
  const totalPossessions = league.reduce(
    (sum, half) => sum + 2 * possessions(half),
    0,
  );
  const foulTotal = teams.reduce((sum, t) => sum + t.fouls, 0);
  const ftaTotal = teams.reduce((sum, t) => sum + t.fta, 0);
  if (foulTotal <= 0 || ftaTotal <= 0) return null;
  const leagueFoulRate = foulTotal / totalPossessions;
  const leagueFTARate = ftaTotal / totalPossessions;
  const leagueFTPercent =
    teams.reduce((sum, t) => sum + (t.freeThrowsMade ?? 0), 0) / ftaTotal;
  const leagueFTAPerFoul = ftaTotal / foulTotal;
  const pseudoPossessions = 4 * (totalPossessions / teams.length);
  const profile = (id: string) => {
    const games = history.filter(
      (half) =>
        possessions(half) > 0 && half.teams.some((t) => t.espnId === id),
    );
    let exposure = 0,
      fouls = 0,
      draws = 0,
      attempts = 0,
      allowed = 0,
      made = 0,
      knownAttempts = 0;
    for (const half of games) {
      const own = half.teams.find((t) => t.espnId === id);
      const other = half.teams.find((t) => t.espnId !== id);
      if (!own || !other) continue;
      exposure += possessions(half);
      fouls += own.fouls;
      draws += other.fouls;
      attempts += own.fta;
      allowed += other.fta;
      if (own.freeThrowsMade !== undefined) {
        made += own.freeThrowsMade;
        knownAttempts += own.fta;
      }
    }
    return {
      games: games.length,
      defenseFouls:
        (fouls + pseudoPossessions * leagueFoulRate) /
        (exposure + pseudoPossessions),
      drawFouls:
        (draws + pseudoPossessions * leagueFoulRate) /
        (exposure + pseudoPossessions),
      attackRatio:
        (attempts + pseudoPossessions * leagueFTARate) /
        (draws + pseudoPossessions * leagueFoulRate),
      defenseRatio:
        (allowed + pseudoPossessions * leagueFTARate) /
        (fouls + pseudoPossessions * leagueFoulRate),
      ftPercent: (made + 30 * leagueFTPercent) / (knownAttempts + 30),
    };
  };
  const away = profile(awayId),
    home = profile(homeId);
  const awayFouls =
    ((away.defenseFouls * home.drawFouls) / leagueFoulRate) * pace;
  const homeFouls =
    ((home.defenseFouls * away.drawFouls) / leagueFoulRate) * pace;
  const awayFTA = (homeFouls * (away.attackRatio + home.defenseRatio)) / 2;
  const homeFTA = (awayFouls * (home.attackRatio + away.defenseRatio)) / 2;
  const baseAway =
    (away.drawFouls * pace * (away.attackRatio + leagueFTAPerFoul)) / 2;
  const baseHome =
    (home.drawFouls * pace * (home.attackRatio + leagueFTAPerFoul)) / 2;
  const delta =
    (awayFTA - baseAway) * away.ftPercent +
    (homeFTA - baseHome) * home.ftPercent;
  const mean = ftaTotal / teams.length;
  const variance =
    teams.reduce((sum, t) => sum + (t.fta - mean) ** 2, 0) / (teams.length - 1);
  const dispersion = Math.max(1, variance / mean);
  const [awayFTALow, awayFTAHigh] = countRange(awayFTA, dispersion);
  const [homeFTALow, homeFTAHigh] = countRange(homeFTA, dispersion);
  const [awayFoulLow, awayFoulHigh] = countRange(awayFouls);
  const [homeFoulLow, homeFoulHigh] = countRange(homeFouls);
  return foulExposureSchema.parse({
    awayEspnId: awayId,
    homeEspnId: homeId,
    expectedAwayFouls: awayFouls,
    expectedHomeFouls: homeFouls,
    awaySevenFoulProbability: sevenFoulProbability(awayFouls),
    homeSevenFoulProbability: sevenFoulProbability(homeFouls),
    awayFoulLow,
    awayFoulHigh,
    homeFoulLow,
    homeFoulHigh,
    expectedAwayFTA: awayFTA,
    expectedHomeFTA: homeFTA,
    awayFTALow,
    awayFTAHigh,
    homeFTALow,
    homeFTAHigh,
    baselineAwayFTA: baseAway,
    baselineHomeFTA: baseHome,
    awayFTPercent: away.ftPercent,
    homeFTPercent: home.ftPercent,
    pointsAdjustment: Math.max(-2, Math.min(2, delta)),
    unboundedPointsAdjustment: delta,
    expectedHalfPossessions: pace,
    leagueGames: league.length,
    awayHistoryGames: away.games,
    homeHistoryGames: home.games,
    ftaDispersion: dispersion,
    pseudoGames: 4,
  });
}
