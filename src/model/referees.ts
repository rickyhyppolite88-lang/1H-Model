import { z } from "zod";

const officialSchema = z.object({ id: z.string(), name: z.string() });
const sourceSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  season: z.string(),
  startsAt: z.iso.datetime(),
  awayEspnId: z.string(),
  homeEspnId: z.string(),
  officials: z.array(officialSchema).length(3),
  observedAt: z.iso.datetime(),
  source: z.url(),
  sourceSha256: z.string(),
});
export const refereeStoreSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  assignments: z.array(sourceSchema),
  measurements: z.array(
    sourceSchema.extend({
      assignmentId: z.string(),
      bothD1: z.boolean(),
      metrics: z.record(z.string(), z.number().finite().nullable()),
    }),
  ),
  checks: z.array(
    z.object({
      gameId: z.string(),
      checkedAt: z.iso.datetime(),
      assignmentId: z.string().nullable().optional(),
    }),
  ),
  errors: z.array(
    z.object({
      gameId: z.string(),
      observedAt: z.iso.datetime(),
      reason: z.string(),
    }),
  ),
});
export type RefereeStore = z.infer<typeof refereeStoreSchema>;
const forecastTestSchema = z.object({
  games: z.number().int(),
  v3Brier: z.number().nullable(),
  v4Brier: z.number().nullable(),
  marketBrier: z.number().nullable(),
  qualifiedWins: z.number().int(),
  qualifiedLosses: z.number().int(),
});
export const refereeProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  games: z.number().int(),
  pricedGames: z.number().int(),
  pointsAssociation: z.number(),
  metrics: z.record(
    z.string(),
    z.object({ mean: z.number(), samples: z.number().int() }),
  ),
  forecastTest: forecastTestSchema.optional(),
});
export type RefereeProfile = z.infer<typeof refereeProfileSchema>;
export const refereeReportSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  modelFittedAt: z.iso.datetime().optional(),
  forecastTest: forecastTestSchema.optional(),
  measurements: z.number().int(),
  sourceErrors: z.number().int(),
  officials: z.array(refereeProfileSchema),
});

export const refereeMetricLabels: Record<string, string> = {
  fouls: "Logged nontechnical fouls",
  foulsFirst10: "Logged fouls · first 10 minutes",
  foulsLast10: "Logged fouls · last 10 minutes",
  fta: "Free-throw attempts",
  ftMade: "Free throws made",
  points: "Combined 1H points",
  halfPossessions: "Estimated possessions per team",
  bonus7MinutesProxy:
    "Combined minutes after 7th logged nontechnical foul (proxy)",
  bonus10MinutesProxy:
    "Combined minutes after 10th logged nontechnical foul (proxy)",
  firstFoulElapsedMinutes: "Minutes elapsed to first logged foul",
  firstFTElapsedMinutes: "Minutes elapsed to first FT",
  homeAwayFoulDifference: "Home minus away fouls",
  homeAwayFTADifference: "Home minus away FTA",
  shootingFoulsTagged: "Explicitly tagged shooting fouls",
  offensiveFoulsTagged: "Explicitly tagged offensive fouls",
  technicalTagged: "Explicitly tagged technical fouls",
  reviewEventsLogged: "Logged review events",
  timeoutEventsLogged: "Logged timeout events",
  ftSequenceProxy: "Clock-grouped FT sequences (proxy)",
  earlyTwoFoulPlayers:
    "Players with 2 fouls in first 10 minutes (complete IDs only)",
  foulPlayerIdentityCoverage: "Foul events with a player ID · proportion",
  fga: "Field-goal attempts",
  threeAttempted: "Three-point attempts",
  turnovers: "Turnovers",
  offensiveRebounds: "Offensive rebounds",
};

export function latestRefereeMeasurements(store: RefereeStore, at: string) {
  const selected = new Map<string, RefereeStore["measurements"][number]>();
  for (const row of store.measurements)
    if (
      Date.parse(row.observedAt) <= Date.parse(at) &&
      Date.parse(row.startsAt) < Date.parse(at)
    ) {
      const old = selected.get(row.gameId);
      if (!old || row.observedAt > old.observedAt)
        selected.set(row.gameId, row);
    }
  return [...selected.values()];
}

export function summarizeReferees(
  store: RefereeStore,
  at: string,
  residuals: Map<string, number>,
) {
  const measurements = latestRefereeMeasurements(store, at);
  const values = [...residuals.values()];
  const league = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
  const officials = new Map<
    string,
    {
      name: string;
      games: number;
      residuals: number[];
      metrics: Map<string, number[]>;
    }
  >();
  for (const half of measurements) {
    for (const official of half.officials) {
      const row: {
        name: string;
        games: number;
        residuals: number[];
        metrics: Map<string, number[]>;
      } = officials.get(official.id) ?? {
        name: official.name,
        games: 0,
        residuals: [],
        metrics: new Map(),
      };
      row.games++;
      const residual = residuals.get(half.gameId);
      if (residual !== undefined && half.bothD1)
        row.residuals.push(residual - league);
      for (const [key, value] of Object.entries(half.metrics))
        if (value !== null)
          row.metrics.set(key, [...(row.metrics.get(key) ?? []), value]);
      officials.set(official.id, row);
    }
  }
  return [...officials]
    .map(([id, row]) =>
      refereeProfileSchema.parse({
        id,
        name: row.name,
        games: row.games,
        pricedGames: row.residuals.length,
        pointsAssociation:
          row.residuals.reduce((a, b) => a + b, 0) /
          (row.residuals.length + 20),
        metrics: Object.fromEntries(
          [...row.metrics].map(([key, v]) => [
            key,
            {
              mean: v.reduce((a, b) => a + b, 0) / v.length,
              samples: v.length,
            },
          ]),
        ),
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pregameCrew(
  store: RefereeStore,
  game: {
    id: string;
    startsAt: string;
    away: { espnId: string };
    home: { espnId: string };
  },
  at: string,
) {
  const check = store.checks.find((row) => row.gameId === game.id);
  if (!check?.assignmentId || Date.parse(check.checkedAt) > Date.parse(at))
    return null;
  return (
    store.assignments.find(
      (row) =>
        row.id === check.assignmentId &&
        row.gameId === game.id &&
        row.startsAt === game.startsAt &&
        row.awayEspnId === game.away.espnId &&
        row.homeEspnId === game.home.espnId &&
        Date.parse(row.observedAt) <= Date.parse(at) &&
        Date.parse(row.observedAt) < Date.parse(game.startsAt),
    ) ?? null
  );
}
