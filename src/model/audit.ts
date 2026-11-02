import { z } from "zod";
import { predict } from "./predictor";
import { type SeasonDataset, teamSchema } from "./schema";
import { type BlendedTeam, blendTeam, defaultBlend } from "./seasons";

const quoteSchema = z.object({
  total: z.number().positive().max(150),
  overPrice: z.number().nullable(),
  underPrice: z.number().nullable(),
});
const frozenTeamSchema = teamSchema.pick({ id: true, name: true }).extend({
  firstHalfPoints: z.number(),
  pace: z.number(),
  offensiveEfficiency: z.number(),
  defensiveEfficiency: z.number(),
  currentWeight: z.number().min(0).max(1),
  currentGames: z.number().int().min(0),
  priorAvailable: z.boolean(),
  strengthOfSchedule: z.number().nullable(),
  notes: z.array(z.string()),
});
const featureSchema = z.object({
  kind: z.enum(["captured_pregame", "reconstructed_season_debut"]),
  capturedAt: z.iso.datetime(),
  priorAsOf: z.iso.date(),
  currentAsOf: z.iso.date().nullable(),
  modelVersion: z.literal("season-bridge-v1"),
  statsRetrievedAt: z.iso.datetime().nullable().optional(),
  away: frozenTeamSchema,
  home: frozenTeamSchema,
});
const gameTeamSchema = z.object({
  espnId: z.string(),
  modelId: z.string().nullable(),
  name: z.string(),
  conferenceId: z.string().nullable().default(null),
  conference: z.string().nullable().default(null),
  rank: z.number().int().min(1).max(25).nullable().default(null),
  rankKnown: z.boolean().default(false),
  firstHalfPoints: z.number().int().min(0).nullable(),
});
export const ledgerSchema = z.object({
  schemaVersion: z.literal(1),
  season: z.string(),
  seasonStart: z.iso.date().nullable(),
  through: z.iso.date(),
  capturedAt: z.iso.datetime(),
  market: z.literal("first_half_total"),
  games: z.array(
    z.object({
      id: z.string(),
      oddsGameId: z.string().nullable().optional(),
      startsAt: z.iso.datetime(),
      status: z.string(),
      firstHalfComplete: z.boolean(),
      away: gameTeamSchema,
      home: gameTeamSchema,
      seasonDebut: z.boolean(),
      scoresSource: z.url(),
      boxScoreUrl: z.url(),
      capturedAt: z.iso.datetime(),
      featureSnapshot: featureSchema.nullable().optional(),
      quotes: z.array(
        z.object({
          sportsbook: z.string(),
          opening: quoteSchema.nullable(),
          latest: quoteSchema.nullable(),
          openingCapturedAt: z.iso.datetime(),
          latestCapturedAt: z.iso.datetime(),
          closingVerified: z.literal(false),
          quoteTimestamp: z.null(),
          source: z.url(),
        }),
      ),
    }),
  ),
  unmatchedOdds: z.array(
    z.object({
      oddsGameId: z.string(),
      away: z.string(),
      home: z.string(),
      source: z.url(),
    }),
  ),
  notes: z.array(z.string()),
});
export type SeasonLedger = z.infer<typeof ledgerSchema>;
export type SeasonGame = SeasonLedger["games"][number];

/** Save observations before tipoff; reconstruct only a confirmed season debut after the fact. */
export function captureFeatures(
  ledger: SeasonLedger,
  prior: SeasonDataset,
  current: SeasonDataset,
  frozenAt = new Date().toISOString(),
): SeasonLedger {
  if (ledger.season !== current.season)
    throw new Error("Market ledger and current stats cover different seasons.");
  return {
    ...ledger,
    games: ledger.games.map((game) => {
      if (game.featureSnapshot || !game.away.modelId || !game.home.modelId)
        return game;
      const capturedBeforeTip =
        Date.parse(frozenAt) < Date.parse(game.startsAt) &&
        Date.parse(current.retrievedAt) < Date.parse(game.startsAt) &&
        Date.parse(ledger.capturedAt) < Date.parse(game.startsAt);
      const gameDate = game.startsAt.slice(0, 10);
      let snapshot = current;
      let kind: "captured_pregame" | "reconstructed_season_debut" =
        "captured_pregame";
      if (!capturedBeforeTip) {
        if (!game.seasonDebut) return game;
        kind = "reconstructed_season_debut";
        snapshot = {
          ...current,
          asOf: gameDate,
          teams: prior.teams.map((team) => ({
            ...team,
            gamesPlayed: 0,
            firstHalfPoints: null,
            pace: null,
            offensiveEfficiency: null,
            defensiveEfficiency: null,
            strengthOfSchedule: null,
          })),
        };
      }
      try {
        return {
          ...game,
          featureSnapshot: {
            kind,
            capturedAt: frozenAt,
            statsRetrievedAt:
              kind === "captured_pregame" ? current.retrievedAt : null,
            priorAsOf: prior.asOf,
            currentAsOf: kind === "captured_pregame" ? current.asOf : null,
            modelVersion: "season-bridge-v1" as const,
            away: blendTeam(
              game.away.modelId,
              prior,
              snapshot,
              defaultBlend,
              gameDate,
            ),
            home: blendTeam(
              game.home.modelId,
              prior,
              snapshot,
              defaultBlend,
              gameDate,
            ),
          },
        };
      } catch {
        return game;
      }
    }),
  };
}

export interface AuditRow {
  game: SeasonGame;
  actual: number;
  line: number;
  projection: number;
  error: number;
  marketError: number;
  legacyPick: "OVER" | "UNDER" | "NO BET";
  legacyGrade: "Win" | "Loss" | "Push" | "Not selected";
  featureKind: string;
}

export function validFeatures(game: SeasonGame): boolean {
  const features = game.featureSnapshot;
  if (
    !features ||
    features.away.id !== game.away.modelId ||
    features.home.id !== game.home.modelId
  )
    return false;
  if (features.priorAsOf >= game.startsAt.slice(0, 10)) return false;
  if (features.kind === "reconstructed_season_debut") {
    return (
      game.seasonDebut &&
      features.away.currentGames === 0 &&
      features.home.currentGames === 0
    );
  }
  return (
    Date.parse(features.capturedAt) < Date.parse(game.startsAt) &&
    (!features.statsRetrievedAt ||
      Date.parse(features.statsRetrievedAt) < Date.parse(game.startsAt)) &&
    features.currentAsOf !== null &&
    features.currentAsOf <= game.startsAt.slice(0, 10)
  );
}

export function evaluateSeason(ledger: SeasonLedger, sportsbook = "betmgm") {
  const rows: AuditRow[] = [];
  const excluded: { id: string; reason: string }[] = [];
  const completed = ledger.games.filter((game) => game.firstHalfComplete);
  for (const game of completed) {
    const opening = game.quotes.find(
      (q) => q.sportsbook === sportsbook,
    )?.opening;
    let reason = "";
    if (!opening) reason = "No opener from the selected sportsbook";
    else if (!validFeatures(game))
      reason =
        "No valid pregame features or confirmed season-debut reconstruction";
    else if (
      game.away.firstHalfPoints === null ||
      game.home.firstHalfPoints === null
    )
      reason = "Missing first-half result";
    if (reason) {
      excluded.push({ id: game.id, reason });
      continue;
    }
    const features = game.featureSnapshot;
    if (!features || !opening) continue;
    const actual =
      (game.away.firstHalfPoints ?? 0) + (game.home.firstHalfPoints ?? 0);
    const result = predict(
      features.away as BlendedTeam,
      features.home as BlendedTeam,
      opening.total,
      "regular",
      0,
    );
    const legacy = result.legacyRules;
    const legacyGrade =
      legacy.pick === "NO BET"
        ? "Not selected"
        : actual === opening.total
          ? "Push"
          : actual > opening.total === (legacy.pick === "OVER")
            ? "Win"
            : "Loss";
    rows.push({
      game,
      actual,
      line: opening.total,
      projection: result.projectedTotal,
      error: result.projectedTotal - actual,
      marketError: opening.total - actual,
      legacyPick: legacy.pick,
      legacyGrade,
      featureKind: features.kind,
    });
  }
  const n = rows.length;
  const mean = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  return {
    sportsbook,
    sample: n,
    completedHalves: completed.length,
    rows,
    excluded,
    modelMae: mean(rows.map((row) => Math.abs(row.error))),
    marketMae: mean(rows.map((row) => Math.abs(row.marketError))),
    modelBias: mean(rows.map((row) => row.error)),
    legacyWins: rows.filter((row) => row.legacyGrade === "Win").length,
    legacyLosses: rows.filter((row) => row.legacyGrade === "Loss").length,
    legacyPushes: rows.filter((row) => row.legacyGrade === "Push").length,
    prospective: rows.filter((row) => row.featureKind === "captured_pregame")
      .length,
    // A minimum sample is a collection threshold, not evidence that any fit is validated.
    calibrationStatus:
      n < 30 ? "INSUFFICIENT_SAMPLE" : "READY_FOR_WALK_FORWARD_REVIEW",
    minimumReviewSample: 30,
    notes: [
      "Fixed sportsbook and opening-line benchmark; missing quotes are excluded without substituting another book.",
      "Legacy injury filter replay assumes zero injuries because historical injury snapshots are unavailable.",
      "Reconstructions are not forecasts made before those games. No fitted coefficient is promoted automatically.",
    ],
  };
}
