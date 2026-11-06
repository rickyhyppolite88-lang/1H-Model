import { z } from "zod";
import type { SeasonLedger } from "./audit";
import { projectFirstHalf } from "./predictor";
import { tipoffState } from "./time";

export const matchupTypes = [
  "conference_regular",
  "nonconference_regular",
  "conference_tournament",
  "national_postseason",
  "other_tournament",
  "postseason_unknown",
  "unknown",
] as const;
export const gameContextSchema = z.object({
  neutralSite: z.boolean().nullable(),
  conferenceGame: z.boolean().nullable(),
  matchupType: z.enum(matchupTypes),
  eventLabel: z.string().nullable(),
  venueId: z.string().nullable(),
  venueKey: z.string().nullable(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
});
export type GameContext = z.infer<typeof gameContextSchema>;
export const gameContextIndexSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  games: z.array(
    z.object({
      gameId: z.string(),
      startsAt: z.iso.datetime(),
      awayEspnId: z.string(),
      homeEspnId: z.string(),
      contextRetrievedAt: z.iso.datetime(),
      context: gameContextSchema,
      source: z.url(),
      sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
const numericMap = z.record(z.string(), z.number().finite());
export const contextModelSchema = z.object({
  schemaVersion: z.literal(1),
  modelVersion: z.literal("lab-context-v1"),
  fittedAt: z.iso.datetime(),
  latestGameAt: z.iso.datetime(),
  historySha256: z.string().regex(/^[a-f0-9]{64}$/),
  baselineSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  baselineMethod: z.string().optional(),
  trainingGames: z.number().int().min(300),
  trainingSeasons: z.array(z.string()).min(1),
  rules: z
    .object({
      version: z.string(),
      maximumAdjustment: z.number().positive().max(4),
      minimumCrowdAttendance: z.number().min(3000),
      minimumVenueAttendances: z.number().min(3),
    })
    .passthrough(),
  converged: z.literal(true),
  iterations: z.number().int().positive(),
  coefficients: numericMap,
  profiles: z.record(z.string(), numericMap),
  leagueProfiles: z.record(z.string(), numericMap),
  locationCounts: z.record(
    z.string(),
    z.object({ home: z.number().int().min(0), away: z.number().int().min(0) }),
  ),
  contextCounts: numericMap,
  venues: z.record(
    z.string(),
    z.object({
      games: z.number().int().positive(),
      attendanceTotal: z.number().positive(),
    }),
  ),
  sourceErrors: z.array(z.object({ date: z.string(), reason: z.string() })),
});
export type ContextModel = z.infer<typeof contextModelSchema>;
export const contextForecastSchema = z.object({
  modelVersion: z.literal("lab-context-v1"),
  capturedAt: z.iso.datetime(),
  modelFittedAt: z.iso.datetime(),
  startsAt: z.iso.datetime(),
  baselineFeatureCapturedAt: z.iso.datetime(),
  modelPath: z.string().regex(/^data\/context-models\/[a-f0-9]{64}\.json$/),
  historySha256: z.string(),
  trainingGames: z.number().int().min(300),
  baselineTotal: z.number(),
  baselineSimple: z.number(),
  baselinePace: z.number(),
  total: z.number().min(0),
  simple: z.number(),
  pace: z.number(),
  adjustment: z.number().min(-4).max(4),
  unboundedAdjustment: z.number(),
  homeAwayAdjustment: z.number(),
  neutralAdjustment: z.number(),
  matchupAdjustment: z.number(),
  crowdAdjustment: z.number(),
  expectedAttendance: z.number().positive().nullable(),
  attendanceSamples: z.number().int().min(0),
  crowdEligible: z.boolean(),
  crowdReason: z.string(),
  homeLocationGames: z.number().int().min(0),
  awayLocationGames: z.number().int().min(0),
  context: gameContextSchema,
  warnings: z.array(z.string()),
});
export type ContextForecast = z.infer<typeof contextForecastSchema>;

export const matchupNames: Record<GameContext["matchupType"], string> = {
  conference_regular: "Conference game",
  nonconference_regular: "Nonconference game",
  conference_tournament: "Conference tournament",
  national_postseason: "National postseason",
  other_tournament: "Tournament / invitational",
  postseason_unknown: "Postseason classification unknown",
  unknown: "Game type unknown",
};

/** Match the original scoring inputs' season weights. Never use target attendance. */
export function contextForecast(
  game: SeasonLedger["games"][number],
  model: ContextModel,
  modelPath: string,
  season: string,
  at: string,
): ContextForecast | null {
  const features = game.featureSnapshot;
  const context = game.context;
  if (
    !features ||
    features.kind !== "captured_pregame" ||
    features.away.id !== game.away.modelId ||
    features.home.id !== game.home.modelId ||
    features.priorAsOf >= game.startsAt.slice(0, 10) ||
    !context ||
    !game.contextRetrievedAt ||
    Date.parse(game.contextRetrievedAt) > Date.parse(at) ||
    Date.parse(features.capturedAt) > Date.parse(at) ||
    (features.statsRetrievedAt &&
      Date.parse(features.statsRetrievedAt) > Date.parse(at)) ||
    Date.parse(model.fittedAt) > Date.parse(at) ||
    Date.parse(model.latestGameAt) >= Date.parse(game.startsAt) ||
    tipoffState({ ...game, actualFirstHalfTotal: null }, Date.parse(at)) !==
      "upcoming"
  )
    return null;
  const priorSeason = model.trainingSeasons.find(
    (value) => Number(value.slice(0, 4)) === Number(season.slice(0, 4)) - 1,
  );
  if (!priorSeason) return null;
  const warnings: string[] = [];
  const baseline = (side: "away" | "home") => {
    const team = features[side];
    const old =
      model.profiles[`${priorSeason}:${team.id}`] ??
      model.leagueProfiles[priorSeason];
    const recent = model.profiles[`${season}:${team.id}`];
    const weight = recent ? team.currentWeight : 0;
    if (!recent && team.currentWeight > 0)
      warnings.push(
        `${side}: current context history unavailable; prior context baseline used.`,
      );
    const value = (key: string) =>
      ((old?.[key] ?? 0) * 0.65 +
        (model.leagueProfiles[priorSeason]?.[key] ?? 0) * 0.35) *
        (1 - weight) +
      (recent?.[key] ?? 0) * weight;
    return { team, value };
  };
  const away = baseline("away");
  const home = baseline("home");
  const coefficient = (key: string) => model.coefficients[key] ?? 0;
  const centered = (key: string, value: number) =>
    value - (away.value(key) + home.value(key)) / 2;
  const signed = context.neutralSite === false ? 1 : 0;
  const homeAway =
    context.neutralSite === null
      ? 0
      : coefficient(`location:${home.team.id}`) *
          (signed - home.value("signedLocation")) +
        coefficient(`location:${away.team.id}`) *
          (-signed - away.value("signedLocation"));
  const neutral =
    context.neutralSite === null
      ? 0
      : coefficient("neutral") *
        centered("neutral", Number(context.neutralSite));
  if (context.neutralSite === null)
    warnings.push("Home/neutral venue status missing; no location adjustment.");
  const knownType = !["unknown", "postseason_unknown"].includes(
    context.matchupType,
  );
  const typeKeys = Object.keys(model.coefficients).filter((key) =>
    key.startsWith("type:"),
  );
  const matchup = knownType
    ? typeKeys.reduce(
        (sum, key) =>
          sum +
          coefficient(key) *
            centered(key, Number(key === `type:${context.matchupType}`)),
        0,
      )
    : 0;
  if (!knownType)
    warnings.push("Game classification missing; no matchup-type adjustment.");
  const venue = context.venueKey ? model.venues[context.venueKey] : undefined;
  const attendance =
    venue && venue.games >= model.rules.minimumVenueAttendances
      ? venue.attendanceTotal / venue.games
      : null;
  const eligible =
    attendance !== null && attendance >= model.rules.minimumCrowdAttendance;
  const crowdBand =
    attendance === null
      ? null
      : attendance < 8000
        ? "medium"
        : attendance < 15000
          ? "large"
          : "very_large";
  const crowdKeys = Object.keys(model.coefficients).filter((key) =>
    key.startsWith("crowd:"),
  );
  // Small/unknown crowds contribute exactly zero, including centering offsets.
  const crowd = eligible
    ? crowdKeys.reduce(
        (sum, key) =>
          sum +
          coefficient(key) *
            centered(key, Number(key === `crowd:${crowdBand}`)),
        0,
      )
    : 0;
  const crowdReason =
    attendance === null
      ? "Insufficient earlier venue attendance; no crowd adjustment."
      : !eligible
        ? "Low historical attendance; crowd adjustment disabled."
        : "Historical venue attendance proxy; crowd noise, sellout status and fan allegiance are unknown.";
  const counts = (side: "home" | "away") =>
    model.locationCounts[features[side].id]?.[side] ?? 0;
  for (const side of ["away", "home"] as const)
    if (!(`location:${features[side].id}` in model.coefficients))
      warnings.push(
        `${side}: insufficient location history; home/away team effect stays neutral.`,
      );
  if (model.sourceErrors.length)
    warnings.push(
      `${model.sourceErrors.length} historical source days unavailable.`,
    );
  const base = projectFirstHalf(features.away, features.home, "regular");
  const raw = homeAway + neutral + matchup + crowd;
  const adjustment = Math.max(
    -model.rules.maximumAdjustment,
    Math.min(model.rules.maximumAdjustment, raw),
  );
  return contextForecastSchema.parse({
    modelVersion: "lab-context-v1",
    capturedAt: at,
    modelFittedAt: model.fittedAt,
    modelPath,
    startsAt: game.startsAt,
    baselineFeatureCapturedAt: features.capturedAt,
    historySha256: model.historySha256,
    trainingGames: model.trainingGames,
    baselineTotal: base.projectedTotal,
    baselineSimple: base.simpleTotal,
    baselinePace: base.paceAdjustedTotal,
    total: base.projectedTotal + adjustment,
    simple: base.simpleTotal + adjustment,
    pace: base.paceAdjustedTotal + adjustment,
    adjustment,
    unboundedAdjustment: raw,
    homeAwayAdjustment: homeAway,
    neutralAdjustment: neutral,
    matchupAdjustment: matchup,
    crowdAdjustment: crowd,
    expectedAttendance: attendance,
    attendanceSamples: venue?.games ?? 0,
    crowdEligible: eligible,
    crowdReason,
    homeLocationGames: counts("home"),
    awayLocationGames: counts("away"),
    context,
    warnings,
  });
}
