import { z } from "zod";

export const featureRules = {
  minimumLeagueGames: 30,
  minimumTeamGames: 1,
  opponentPriorHalves: 4,
  shootingPriorAttempts: 50,
  scoringWeight: 0.6,
  pointCap: 3,
  iterations: 40,
} as const;

export const featureModelSchema = z.object({
  schemaVersion: z.literal(1),
  policy: z.literal("isolated-half-features-v1"),
  season: z.string(),
  date: z.iso.date(),
  fittedAt: z.iso.datetime(),
  sourceHash: z.string(),
  trainingGames: z.number().int().nonnegative(),
  latestObservedAt: z.iso.datetime().nullable(),
  leagueRate: z.number().finite().nonnegative(),
  leaguePossessions: z.number().finite().nonnegative(),
  leagueThreeRate: z.number().min(0).max(1),
  rules: z.object({
    minimumLeagueGames: z.literal(30),
    minimumTeamGames: z.literal(1),
    opponentPriorHalves: z.literal(4),
    shootingPriorAttempts: z.literal(50),
    scoringWeight: z.literal(0.6),
    pointCap: z.literal(3),
    iterations: z.literal(40),
  }),
  teams: z.record(
    z.string(),
    z.object({
      games: z.number().int().positive(),
      possessions: z.number().positive(),
      rawOffenseRate: z.number().finite(),
      adjustedOffenseRate: z.number().finite(),
      defenseOffset: z.number().finite(),
      scheduleDeltaRate: z.number().finite(),
      threeMade: z.number().int().nonnegative(),
      threeAttempted: z.number().int().nonnegative(),
      rawThreeRate: z.number().min(0).max(1).nullable(),
      regressedThreeRate: z.number().min(0).max(1),
      shootingDeltaRate: z.number().finite(),
    }),
  ),
});
export type FeatureModel = z.infer<typeof featureModelSchema>;

const featureTeamSchema = z.object({
  espnId: z.string(),
  games: z.number().int().positive(),
  currentWeight: z.number().min(0).max(1),
  deltaRate: z.number().finite(),
  weightedPoints: z.number().finite(),
});
export const featureForecastSchema = z.object({
  policy: z.literal("isolated-half-features-v1"),
  selectionPolicy: z.literal("component-paper-v1"),
  modelPath: z.string(),
  fittedAt: z.iso.datetime(),
  trainingGames: z.number().int().min(30),
  expectedPossessions: z.number().positive(),
  unboundedAdjustment: z.number().finite(),
  adjustment: z.number().min(-3).max(3),
  paperUnits: z.union([z.literal(0), z.literal(1)]),
  away: featureTeamSchema,
  home: featureTeamSchema,
});

const replayMetricSchema = z.object({
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pushes: z.number().int().nonnegative(),
  net: z.number().finite(),
  mae: z.number().nonnegative().nullable(),
  baselineWins: z.number().int().nonnegative(),
  baselineLosses: z.number().int().nonnegative(),
  baselinePushes: z.number().int().nonnegative(),
  baselineNoLean: z.number().int().nonnegative(),
  baselineNet: z.number().finite(),
  baselineMae: z.number().nonnegative().nullable(),
  changedSides: z.number().int().nonnegative(),
});
export const featureReplaySchema = z.object({
  schemaVersion: z.literal(1),
  policy: z.literal("isolated-half-features-v1"),
  updatedAt: z.iso.datetime(),
  from: z.iso.date().nullable(),
  through: z.iso.date().nullable(),
  candidates: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  methods: z.record(z.string(), replayMetricSchema),
});
