import { z } from "zod";
import { resultEventSchema } from "./predictionRecord";
import { csvCell } from "./predictions";
import { easternTipoff } from "./time";

export const labMethods = [
  {
    id: "enhanced-baseline-v1",
    name: "Combined Lab model",
    kind: "total",
    description:
      "The Actual algorithm with first-half defense and a bounded bonus-exposure adjustment, followed by the qualified-baseline selection rules.",
    formula:
      "60% × (both teams' 1H scored + both teams' 1H allowed) / 2 + 40% pace / efficiency + bonus adjustment. Qualify when 1.5 ≤ absolute edge < 8 and both adjusted components agree.",
    limits:
      "Bonus points use a tempo-controlled, shrunk historical free-throw fit, capped at ±2 points. This is an experimental association, not a proven causal effect or calibrated win probability. Missing factors block the forecast. Earlier Lab versions remain in history.",
  },
  {
    id: "baseline-control-v1",
    name: "Baseline control",
    kind: "total",
    description:
      "The unchanged model at the Lab's capture time, using the same saved book and line as the challengers.",
    formula: "60% historical first-half scoring + 40% pace / efficiency.",
    limits:
      "All priced research leans are tracked. This is a Lab control, not the official record or a qualified betting system.",
  },
  {
    id: "qualified-baseline-v1",
    name: "Qualified baseline",
    kind: "total",
    description:
      "Test whether skipping small and conflicting signals improves selection while retaining every projection.",
    formula:
      "Unchanged total; qualify only when 1.5 ≤ absolute edge < 8 and scoring and pace both agree with the lean.",
    limits:
      "The threshold is provisional. Watch-only forecasts stay visible and never enter the qualified win rate.",
  },
  {
    id: "first-half-defense-v1",
    name: "First-half defense",
    kind: "total",
    description:
      "Add each opponent's first-half points allowed to the scoring branch, with the same frozen season weights.",
    formula:
      "60% × (both teams' 1H scored + both teams' 1H allowed) / 2 + 40% pace / efficiency; same qualification rule.",
    limits:
      "Missing or mismatched frozen defensive inputs block the forecast. This has not earned promotion to the actual model.",
  },
  {
    id: "bonus-exposure-v1",
    name: "Bonus exposure",
    kind: "bonus",
    description:
      "Forecast combined first-half minutes after each opponent's seventh logged nontechnical foul.",
    formula:
      "Opponent foul-drawing × defensive foul rates, shrunk with four league pseudo-games; integrate a Poisson seventh-foul arrival model over 20 minutes.",
    limits:
      "Measurement experiment only: no total adjustment, bet, or win probability. Combined team-minutes can reach 40. Technical classifications are incomplete; this is a proxy. Early team samples are very small.",
  },
] as const;
export const labMethodIds = [
  "enhanced-baseline-v1",
  "baseline-control-v1",
  "qualified-baseline-v1",
  "first-half-defense-v1",
  "bonus-exposure-v1",
] as const;
export const labMethodIdSchema = z.enum(labMethodIds);
export type LabMethodId = z.infer<typeof labMethodIdSchema>;
export const labConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    methods: z.array(z.object({ id: labMethodIdSchema, enabled: z.boolean() })),
  })
  .superRefine((data, ctx) => {
    if (
      new Set(data.methods.map((method) => method.id)).size !==
      data.methods.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate Lab method configuration",
      });
  });
export type LabConfig = z.infer<typeof labConfigSchema>;

const halfTeamSchema = z
  .object({
    espnId: z.string(),
    points: z.number().int().min(0),
    fouls: z.number().int().min(0),
    bonusMinutes: z.number().min(0).max(20),
    fga: z.number().int().min(0),
    fta: z.number().int().min(0),
    freeThrowsMade: z.number().int().min(0).optional(),
    threeMade: z.number().int().min(0),
    threeAttempted: z.number().int().min(0),
    turnovers: z.number().int().min(0),
    offensiveRebounds: z.number().int().min(0),
  })
  .refine(
    (team) =>
      team.freeThrowsMade === undefined || team.freeThrowsMade <= team.fta,
    {
      message: "Free throws made cannot exceed attempts",
    },
  );
export const labHalfSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  season: z.string(),
  startsAt: z.iso.datetime(),
  observedAt: z.iso.datetime(),
  source: z.url(),
  sourceSha256: z.string(),
  bothD1: z.boolean(),
  teams: z.array(halfTeamSchema).length(2),
});
export const labHalfStoreSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  halves: z.array(labHalfSchema),
  errors: z.array(z.object({ gameId: z.string(), reason: z.string() })),
});
export type LabHalf = z.infer<typeof labHalfSchema>;

export const labForecastSchema = z.object({
  id: z.string(),
  season: z.string(),
  methodId: labMethodIdSchema,
  gameId: z.string(),
  gameDate: z.iso.date(),
  startsAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  version: z.number().int().positive(),
  revision: z.string(),
  awayTeam: z.string(),
  homeTeam: z.string(),
  sportsbook: z.literal("betmgm"),
  line: z.number().positive().nullable(),
  overPrice: z.number().nullable(),
  underPrice: z.number().nullable(),
  total: z.number().min(0).nullable(),
  baselineTotal: z.number().min(0).nullable(),
  simpleTotal: z.number().nullable(),
  paceTotal: z.number().nullable(),
  side: z.enum(["OVER", "UNDER", "PUSH"]).nullable(),
  signalStrength: z.number().min(0).max(100).nullable(),
  status: z.enum([
    "control",
    "qualified",
    "watch_only",
    "data_gap",
    "measurement",
  ]),
  reason: z.string(),
  bonusMinutes: z.number().min(0).max(40).nullable(),
  bonusBaselineMinutes: z.number().min(0).max(40).nullable(),
  inputs: z.record(
    z.string(),
    z.union([z.string(), z.number().finite(), z.null()]),
  ),
});
export type LabForecast = z.infer<typeof labForecastSchema>;
export const labStoreSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  forecasts: z.array(labForecastSchema),
  results: z.array(resultEventSchema),
  halves: z.array(labHalfSchema),
});
export type LabStore = z.infer<typeof labStoreSchema>;

export const labIndexSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  methodStartedAt: z
    .partialRecord(labMethodIdSchema, z.iso.datetime())
    .optional(),
  config: labConfigSchema,
  rawCoverage: z.object({ games: z.number().int(), errors: z.number().int() }),
  games: z.array(
    z.object({
      gameId: z.string(),
      startsAt: z.iso.datetime(),
      status: z.string(),
      firstHalfComplete: z.boolean(),
    }),
  ),
  archives: z.array(
    z.object({
      date: z.iso.date(),
      jsonPath: z.string().regex(/^data\/lab\/\d{4}-\d{2}-\d{2}\.json$/),
      csvPath: z.string().regex(/^data\/lab\/\d{4}-\d{2}-\d{2}\.csv$/),
      games: z.number().int(),
    }),
  ),
});
export type LabIndex = z.infer<typeof labIndexSchema>;

export function mergeLabStores(
  stores: LabStore[],
  startedAt: string,
  updatedAt: string,
): LabStore {
  function unique<T extends { id: string }>(items: T[]) {
    const map = new Map<string, T>();
    for (const item of items) {
      const previous = map.get(item.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        throw new Error(`Conflicting immutable Lab item: ${item.id}`);
      map.set(item.id, item);
    }
    return [...map.values()];
  }
  return {
    schemaVersion: 1,
    startedAt,
    updatedAt,
    forecasts: unique(stores.flatMap((store) => store.forecasts)).sort(
      (a, b) =>
        a.recordedAt.localeCompare(b.recordedAt) || a.version - b.version,
    ),
    results: unique(stores.flatMap((store) => store.results)).sort((a, b) =>
      a.observedAt.localeCompare(b.observedAt),
    ),
    halves: unique(stores.flatMap((store) => store.halves)).sort((a, b) =>
      a.observedAt.localeCompare(b.observedAt),
    ),
  };
}

/** The first priced, usable observation fixes the decision, including watch-only. */
export function canonicalLabForecasts(forecasts: LabForecast[]) {
  const groups = new Map<string, LabForecast[]>();
  for (const row of forecasts) {
    const key = `${row.season}:${row.methodId}:${row.gameId}:${row.sportsbook}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((rows) => {
    rows.sort(
      (a, b) =>
        a.recordedAt.localeCompare(b.recordedAt) || a.version - b.version,
    );
    return (
      rows.find((row) =>
        row.methodId === "bonus-exposure-v1"
          ? row.bonusMinutes !== null
          : row.total !== null && row.line !== null,
      ) ?? rows[0]
    );
  });
}

export function latestHalves(halves: LabHalf[], at = "9999-12-31T23:59:59Z") {
  const latest = new Map<string, LabHalf>();
  for (const half of [...halves].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt),
  ))
    if (Date.parse(half.observedAt) <= Date.parse(at))
      latest.set(`${half.season}:${half.gameId}`, half);
  return [...latest.values()];
}

export function gradeLab(
  row: LabForecast,
  store: Pick<LabStore, "results" | "halves">,
) {
  const result = [...store.results]
    .filter(
      (event) => event.season === row.season && event.gameId === row.gameId,
    )
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const actual = result ? result.awayPoints + result.homePoints : null;
  const scheduleChanged =
    result?.startsAt !== undefined && result.startsAt !== row.startsAt;
  const outcome = (side: LabForecast["side"]) =>
    actual === null ||
    row.line === null ||
    !side ||
    side === "PUSH" ||
    scheduleChanged
      ? null
      : actual === row.line
        ? ("Push" as const)
        : actual > row.line === (side === "OVER")
          ? ("Win" as const)
          : ("Loss" as const);
  const hypothetical = outcome(row.side);
  const baselineSide =
    row.baselineTotal === null || row.line === null
      ? null
      : row.baselineTotal === row.line
        ? "PUSH"
        : row.baselineTotal > row.line
          ? "OVER"
          : "UNDER";
  const half = latestHalves(store.halves).find(
    (event) =>
      event.season === row.season &&
      event.gameId === row.gameId &&
      event.startsAt === row.startsAt,
  );
  const actualBonus =
    half &&
    actual !== null &&
    half.teams.reduce((sum, team) => sum + team.points, 0) === actual &&
    !scheduleChanged
      ? half.teams.reduce((sum, team) => sum + team.bonusMinutes, 0)
      : null;
  const grade = scheduleChanged
    ? "Schedule review"
    : row.status === "data_gap"
      ? "Data gap"
      : row.status === "watch_only"
        ? "Watch only"
        : row.status === "measurement"
          ? actualBonus === null
            ? "Pending measurement"
            : "Measured"
          : (hypothetical ??
            (row.line === null
              ? "No line"
              : row.side === "PUSH"
                ? "No lean"
                : "Pending"));
  return {
    grade,
    actual,
    actualBonus,
    hypothetical,
    baselineGrade: outcome(baselineSide),
    error:
      actual !== null && row.total !== null && !scheduleChanged
        ? row.total - actual
        : null,
    baselineError:
      actual !== null && row.baselineTotal !== null && !scheduleChanged
        ? row.baselineTotal - actual
        : null,
    bonusError:
      actualBonus !== null && row.bonusMinutes !== null
        ? row.bonusMinutes - actualBonus
        : null,
    bonusBaselineError:
      actualBonus !== null && row.bonusBaselineMinutes !== null
        ? row.bonusBaselineMinutes - actualBonus
        : null,
  };
}

export function labSummary(
  rows: LabForecast[],
  store: Pick<LabStore, "results" | "halves">,
) {
  const graded = canonicalLabForecasts(rows).map((row) => ({
    row,
    ...gradeLab(row, store),
  }));
  const qualified = graded.filter((entry) =>
    ["control", "qualified"].includes(entry.row.status),
  );
  const settled = qualified.filter((entry) =>
    ["Win", "Loss", "Push"].includes(entry.grade),
  );
  const wins = settled.filter((entry) => entry.grade === "Win").length;
  const losses = settled.filter((entry) => entry.grade === "Loss").length;
  const meanAbs = (values: (number | null)[]) => {
    const valid = values.filter((value): value is number => value !== null);
    return valid.length
      ? valid.reduce((sum, value) => sum + Math.abs(value), 0) / valid.length
      : null;
  };
  return {
    games: graded.length,
    qualified: qualified.length,
    wins,
    losses,
    pushes: settled.length - wins - losses,
    pending: qualified.length - settled.length,
    winRate: wins + losses ? wins / (wins + losses) : null,
    watchOnly: graded.filter((entry) => entry.row.status === "watch_only")
      .length,
    gaps: graded.filter((entry) => entry.row.status === "data_gap").length,
    mae: meanAbs(graded.map((entry) => entry.error)),
    matchedMae: meanAbs(settled.map((entry) => entry.error)),
    matchedBaselineMae: meanAbs(settled.map((entry) => entry.baselineError)),
    baselineWins: settled.filter((entry) => entry.baselineGrade === "Win")
      .length,
    baselineLosses: settled.filter((entry) => entry.baselineGrade === "Loss")
      .length,
    bonusMae: meanAbs(graded.map((entry) => entry.bonusError)),
    bonusBaselineMae: meanAbs(graded.map((entry) => entry.bonusBaselineError)),
    measured: graded.filter((entry) => entry.bonusError !== null).length,
  };
}

export function labToCsv(store: LabStore) {
  const ids = new Set(
    canonicalLabForecasts(store.forecasts).map((row) => row.id),
  );
  const header = [
    "id",
    "method",
    "date_et",
    "tipoff_utc",
    "tipoff_time_et",
    "tipoff_zone",
    "recorded_at_utc",
    "recorded_time_et",
    "away",
    "home",
    "sportsbook",
    "saved_line",
    "lab_total",
    "baseline_total",
    "lean",
    "qualification",
    "reason",
    "signal_strength_NOT_probability",
    "actual_1h",
    "grade",
    "watch_only_hypothetical",
    "bonus_minutes_forecast",
    "bonus_minutes_actual",
    "original_decision",
    "defense_adjusted_total",
    "defense_points_adjustment",
    "bonus_points_adjustment",
    "bonus_points_per_minute",
    "bonus_fit_games",
    "frozen_inputs_json",
  ];
  return `${[
    header,
    ...store.forecasts.map((row) => {
      const result = gradeLab(row, store);
      const tip = easternTipoff(row.startsAt);
      const captured = easternTipoff(row.recordedAt);
      return [
        row.id,
        row.methodId,
        row.gameDate,
        row.startsAt,
        tip.time,
        tip.zone,
        row.recordedAt,
        `${captured.date} ${captured.time} ${captured.zone}`,
        row.awayTeam,
        row.homeTeam,
        row.sportsbook,
        row.line,
        row.total,
        row.baselineTotal,
        row.side,
        row.status,
        row.reason,
        row.signalStrength,
        result.actual,
        result.grade,
        row.status === "watch_only" ? result.hypothetical : null,
        row.bonusMinutes,
        result.actualBonus,
        ids.has(row.id) ? "Yes" : "No",
        row.inputs.defenseAdjustedTotal,
        row.inputs.defenseAdjustment,
        row.inputs.bonusPointsAdjustment,
        row.inputs.bonusPointsPerMinute,
        row.inputs.bonusFitGames,
        JSON.stringify(row.inputs),
      ];
    }),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}
