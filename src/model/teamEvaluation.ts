import { z } from "zod";
import { type SeasonLedger, validFeatures } from "./audit";
import { csvCell } from "./predictions";
import { projectFirstHalf } from "./predictor";
import type { SeasonDataset, TeamStats } from "./schema";
import { assertSnapshots, blendTeam, defaultBlend } from "./seasons";

const metricKeys = [
  "firstHalfPoints",
  "firstHalfAllowed",
  "pace",
  "offensiveEfficiency",
  "defensiveEfficiency",
] as const;
const nullableNumber = z.number().finite().nullable();
const cohortSchema = z.object({
  sample: z.number().int().min(0),
  modelMae: nullableNumber,
  priorMae: nullableNumber,
  bias: nullableNumber,
  defenseMae: nullableNumber,
  priorDefenseMae: nullableNumber,
});
export const teamEvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  reportType: z.literal("team_evaluation"),
  generatedAt: z.iso.datetime(),
  priorSeason: z.string(),
  currentSeason: z.string(),
  priorAsOf: z.iso.date(),
  currentAsOf: z.iso.date(),
  source: z.object({
    prior: z.record(z.string(), z.url()),
    current: z.record(z.string(), z.url()),
  }),
  summary: z.object({
    prospective: cohortSchema,
    reconstructed: cohortSchema,
    ungradedCompleted: z.number().int().min(0),
  }),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      conference: z.string().nullable(),
      rank: nullableNumber,
      priorGames: z.number().int().min(0),
      currentGames: z.number().int().min(0),
      currentWeight: z.number().min(0).max(1),
      metrics: z.array(
        z.object({
          key: z.enum(metricKeys),
          prior: nullableNumber,
          current: nullableNumber,
          change: nullableNumber,
          blended: nullableNumber,
        }),
      ),
      prospective: cohortSchema,
      reconstructed: cohortSchema,
    }),
  ),
  games: z.array(
    z.object({
      gameId: z.string(),
      startsAt: z.iso.datetime(),
      awayId: z.string().nullable(),
      homeId: z.string().nullable(),
      awayTeam: z.string(),
      homeTeam: z.string(),
      kind: z
        .enum(["captured_pregame", "reconstructed_season_debut"])
        .nullable(),
      priorTotal: nullableNumber,
      modelTotal: nullableNumber,
      shift: nullableNumber,
      actualTotal: nullableNumber,
      error: nullableNumber,
      awayProjected: nullableNumber,
      homeProjected: nullableNumber,
      awayPrior: nullableNumber,
      homePrior: nullableNumber,
      awayActual: nullableNumber,
      homeActual: nullableNumber,
    }),
  ),
});
export type TeamEvaluation = z.infer<typeof teamEvaluationSchema>;
type ReviewGame = TeamEvaluation["games"][number];
type Grade = {
  model: number;
  prior: number;
  actual: number;
  defense: number | null;
  priorDefense: number | null;
  allowed: number | null;
};
const mean = (numbers: number[]) =>
  numbers.length
    ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length
    : null;

function summarize(rows: Grade[]) {
  return {
    sample: rows.length,
    modelMae: mean(rows.map((row) => Math.abs(row.model - row.actual))),
    priorMae: mean(rows.map((row) => Math.abs(row.prior - row.actual))),
    bias: mean(rows.map((row) => row.model - row.actual)),
    defenseMae: mean(
      rows.flatMap((row) =>
        row.defense !== null && row.allowed !== null
          ? [Math.abs(row.defense - row.allowed)]
          : [],
      ),
    ),
    priorDefenseMae: mean(
      rows.flatMap((row) =>
        row.priorDefense !== null && row.allowed !== null
          ? [Math.abs(row.priorDefense - row.allowed)]
          : [],
      ),
    ),
  };
}

function grade(game: ReviewGame, id?: string): Grade | null {
  if (
    game.actualTotal === null ||
    game.modelTotal === null ||
    game.priorTotal === null
  )
    return null;
  if (!id)
    return {
      model: game.modelTotal,
      prior: game.priorTotal,
      actual: game.actualTotal,
      defense: null,
      priorDefense: null,
      allowed: null,
    };
  const away = game.awayId === id;
  const model = away ? game.awayProjected : game.homeProjected;
  const prior = away ? game.awayPrior : game.homePrior;
  const actual = away ? game.awayActual : game.homeActual;
  if (model === null || prior === null || actual === null) return null;
  return {
    model,
    prior,
    actual,
    defense: away ? game.homeProjected : game.awayProjected,
    priorDefense: away ? game.homePrior : game.awayPrior,
    allowed: away ? game.homeActual : game.awayActual,
  };
}

function cohort(games: ReviewGame[], kind: ReviewGame["kind"], id?: string) {
  return summarize(
    games
      .filter(
        (g) => g.kind === kind && (!id || g.awayId === id || g.homeId === id),
      )
      .map((g) => grade(g, id))
      .filter((g): g is Grade => g !== null),
  );
}

/** Same formula, evaluated with frozen features and a prior-only baseline on identical games. */
export function generateTeamEvaluation(
  prior: SeasonDataset,
  current: SeasonDataset,
  ledger: SeasonLedger,
  generatedAt: string,
): TeamEvaluation {
  assertSnapshots(prior, current, current.asOf);
  if (ledger.season !== current.season)
    throw new Error("Evaluation seasons must match.");
  const zeroCurrent: SeasonDataset = {
    ...current,
    teams: current.teams.map((team) => ({
      ...team,
      gamesPlayed: 0,
      firstHalfPoints: null,
      pace: null,
      offensiveEfficiency: null,
      defensiveEfficiency: null,
      strengthOfSchedule: null,
    })),
  };
  const baseline = new Map(
    current.teams.map((team) => [
      team.id,
      blendTeam(team.id, prior, zeroCurrent, defaultBlend, current.asOf),
    ]),
  );
  const games = ledger.games.map((game): ReviewGame => {
    const features = validFeatures(game) ? game.featureSnapshot : null;
    const model = features
      ? projectFirstHalf(features.away, features.home, "regular")
      : null;
    const a = game.away.modelId ? baseline.get(game.away.modelId) : null;
    const b = game.home.modelId ? baseline.get(game.home.modelId) : null;
    // Only comparable, eligible games receive a baseline comparison.
    const old = features && a && b ? projectFirstHalf(a, b, "regular") : null;
    const awayActual = game.firstHalfComplete
      ? game.away.firstHalfPoints
      : null;
    const homeActual = game.firstHalfComplete
      ? game.home.firstHalfPoints
      : null;
    const actualTotal =
      awayActual !== null && homeActual !== null
        ? awayActual + homeActual
        : null;
    return {
      gameId: game.id,
      startsAt: game.startsAt,
      awayId: game.away.modelId,
      homeId: game.home.modelId,
      awayTeam: game.away.name,
      homeTeam: game.home.name,
      kind: features?.kind ?? null,
      priorTotal: old?.projectedTotal ?? null,
      modelTotal: model?.projectedTotal ?? null,
      shift: model && old ? model.projectedTotal - old.projectedTotal : null,
      actualTotal,
      error:
        model && actualTotal !== null
          ? model.projectedTotal - actualTotal
          : null,
      awayProjected: model?.teamAFirstHalf ?? null,
      homeProjected: model?.teamBFirstHalf ?? null,
      awayPrior: old?.teamAFirstHalf ?? null,
      homePrior: old?.teamBFirstHalf ?? null,
      awayActual,
      homeActual,
    };
  });
  const classification = new Map<
    string,
    SeasonLedger["games"][number]["away"]
  >();
  for (const game of [...ledger.games].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt),
  )) {
    for (const team of [game.away, game.home])
      if (team.modelId) classification.set(team.modelId, team);
  }
  const observed = (
    team: TeamStats | undefined,
    key: (typeof metricKeys)[number],
  ) => (team && team.gamesPlayed > 0 ? (team[key] ?? null) : null);
  const teams = current.teams.map((team) => {
    const old = prior.teams.find((row) => row.id === team.id);
    const blended = blendTeam(
      team.id,
      prior,
      current,
      defaultBlend,
      current.asOf,
    );
    return {
      id: team.id,
      name: team.name,
      conference: classification.get(team.id)?.conference ?? null,
      rank: classification.get(team.id)?.rank ?? null,
      priorGames: old?.gamesPlayed ?? 0,
      currentGames: team.gamesPlayed,
      currentWeight: blended.currentWeight,
      metrics: metricKeys.map((key) => {
        const p = observed(old, key);
        const c = observed(team, key);
        return {
          key,
          prior: p,
          current: c,
          change: p !== null && c !== null ? c - p : null,
          blended: key === "firstHalfAllowed" ? null : blended[key],
        };
      }),
      prospective: cohort(games, "captured_pregame", team.id),
      reconstructed: cohort(games, "reconstructed_season_debut", team.id),
    };
  });
  return teamEvaluationSchema.parse({
    schemaVersion: 1,
    reportType: "team_evaluation",
    generatedAt,
    priorSeason: prior.season,
    currentSeason: current.season,
    priorAsOf: prior.asOf,
    currentAsOf: current.asOf,
    source: { prior: prior.source.urls, current: current.source.urls },
    teams,
    games,
    summary: {
      prospective: cohort(games, "captured_pregame"),
      reconstructed: cohort(games, "reconstructed_season_debut"),
      ungradedCompleted: games.filter(
        (game) =>
          game.actualTotal !== null &&
          (game.modelTotal === null || game.priorTotal === null),
      ).length,
    },
  });
}

export function teamEvaluationToCsv(report: TeamEvaluation) {
  const headers = [
    "team_id",
    "team",
    "conference",
    "rank",
    "prior_games",
    "current_games",
    "current_weight",
    ...metricKeys.flatMap((key) => [
      `prior_${key}`,
      `current_${key}`,
      `change_${key}`,
      `model_${key}`,
    ]),
    "pregame_sample",
    "pregame_offense_mae",
    "pregame_defense_mae",
    "reconstructed_sample",
    "reconstructed_offense_mae",
    "reconstructed_defense_mae",
  ];
  return `${[
    headers,
    ...report.teams.map((team) => [
      team.id,
      team.name,
      team.conference,
      team.rank,
      team.priorGames,
      team.currentGames,
      team.currentWeight,
      ...team.metrics.flatMap((m) => [m.prior, m.current, m.change, m.blended]),
      team.prospective.sample,
      team.prospective.modelMae,
      team.prospective.defenseMae,
      team.reconstructed.sample,
      team.reconstructed.modelMae,
      team.reconstructed.defenseMae,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}
