import { z } from "zod";
import { type SeasonLedger, validFeatures } from "./audit";
import { compareTotal, projectFirstHalf } from "./predictor";
import { easternTipoff } from "./time";

export type LineBasis = "opening" | "latest";
const marketSchema = z.object({
  sportsbook: z.string(),
  openingLine: z.number().positive().nullable(),
  latestLine: z.number().positive().nullable(),
  capturedAt: z.iso.datetime(),
  source: z.url(),
  closingVerified: z.literal(false),
});
export const predictionSchema = z.object({
  gameId: z.string(),
  startsAt: z.iso.datetime(),
  awayTeam: z.string(),
  homeTeam: z.string(),
  awayConference: z.string().nullable().default(null),
  homeConference: z.string().nullable().default(null),
  awayRank: z.number().int().min(1).max(25).nullable().default(null),
  homeRank: z.number().int().min(1).max(25).nullable().default(null),
  rankingsKnown: z.boolean().default(false),
  status: z.string(),
  projectedFirstHalfTotal: z.number().min(0).nullable(),
  actualFirstHalfTotal: z.number().int().min(0).nullable(),
  simpleTotal: z.number().nullable(),
  paceAdjustedTotal: z.number().nullable(),
  featureKind: z
    .enum(["captured_pregame", "reconstructed_season_debut"])
    .nullable(),
  featureCapturedAt: z.iso.datetime().nullable(),
  unavailableReason: z.string().nullable(),
  markets: z.array(marketSchema),
});
export const predictionFeedSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.enum(["all", "daily"]).default("all"),
  gameDate: z.iso.date().nullable().default(null),
  season: z.string(),
  through: z.iso.date(),
  generatedAt: z.iso.datetime(),
  marketCapturedAt: z.iso.datetime(),
  modelVersion: z.literal("season-bridge-v1"),
  mode: z.literal("regular_season_research"),
  defaultSportsbook: z.string(),
  defaultLineBasis: z.literal("latest"),
  source: z.object({
    repository: z.url(),
    projectionCode: z.url(),
    batchCode: z.url(),
    revision: z.string(),
  }),
  counts: z.object({
    matchups: z.number().int(),
    predicted: z.number().int(),
    unavailable: z.number().int(),
  }),
  predictions: z.array(predictionSchema),
});
export type PredictionRow = z.infer<typeof predictionSchema>;
export type PredictionFeed = z.infer<typeof predictionFeedSchema>;

export const dailyArchiveSchema = z.object({
  schemaVersion: z.literal(1),
  archives: z.array(
    z.object({
      date: z.iso.date(),
      generatedAt: z.iso.datetime(),
      marketCapturedAt: z.iso.datetime(),
      matchups: z.number().int().min(0),
      predicted: z.number().int().min(0),
      csvPath: z
        .string()
        .regex(/^data\/daily\/\d{4}-\d{2}-\d{2}\/predictions\.csv$/),
      jsonPath: z
        .string()
        .regex(/^data\/daily\/\d{4}-\d{2}-\d{2}\/predictions\.json$/),
      xlsxPath: z
        .string()
        .regex(/^data\/daily\/\d{4}-\d{2}-\d{2}\/predictions\.xlsx$/)
        .optional(),
      teamXlsxPath: z
        .string()
        .regex(/^data\/daily\/\d{4}-\d{2}-\d{2}\/team-comparison\.xlsx$/)
        .optional(),
    }),
  ),
});
export type DailyArchive = z.infer<typeof dailyArchiveSchema>;

export function newYorkDate(timestamp: string) {
  return easternTipoff(timestamp).date;
}

/** Archive only today's refreshed data, with games assigned to their New York date. */
export function dailyPredictions(feed: PredictionFeed): PredictionFeed | null {
  const date = newYorkDate(feed.generatedAt);
  if (feed.through !== date) return null;
  const rows = feed.predictions.filter(
    (row) => newYorkDate(row.startsAt) === date,
  );
  const predicted = rows.filter(
    (row) => row.projectedFirstHalfTotal !== null,
  ).length;
  return predictionFeedSchema.parse({
    ...feed,
    scope: "daily",
    gameDate: date,
    predictions: rows,
    counts: {
      matchups: rows.length,
      predicted,
      unavailable: rows.length - predicted,
    },
  });
}

export function updateDailyArchive(
  index: DailyArchive,
  daily: PredictionFeed,
): DailyArchive {
  if (daily.scope !== "daily" || !daily.gameDate)
    throw new Error("Expected a daily prediction snapshot");
  const date = daily.gameDate;
  const entry = {
    date,
    generatedAt: daily.generatedAt,
    marketCapturedAt: daily.marketCapturedAt,
    matchups: daily.counts.matchups,
    predicted: daily.counts.predicted,
    csvPath: `data/daily/${date}/predictions.csv`,
    jsonPath: `data/daily/${date}/predictions.json`,
    xlsxPath: `data/daily/${date}/predictions.xlsx`,
    teamXlsxPath: `data/daily/${date}/team-comparison.xlsx`,
  };
  return dailyArchiveSchema.parse({
    schemaVersion: 1,
    archives: [
      ...index.archives.filter((row) => row.date !== date),
      entry,
    ].sort((a, b) => b.date.localeCompare(a.date)),
  });
}

/** One row per ledger game. A market line is not needed to calculate the total. */
export function generatePredictions(
  ledger: SeasonLedger,
  generatedAt: string,
  revision = "main",
): PredictionFeed {
  if (revision !== "main" && !/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid source revision");
  const repository = "https://github.com/rickyhyppolite88-lang/1H-Model";
  const predictions = ledger.games.map((game): PredictionRow => {
    const features = game.featureSnapshot;
    const usable = validFeatures(game);
    const projection =
      usable && features
        ? projectFirstHalf(features.away, features.home, "regular")
        : null;
    return {
      gameId: game.id,
      startsAt: game.startsAt,
      awayTeam: game.away.name,
      homeTeam: game.home.name,
      awayConference: game.away.conference,
      homeConference: game.home.conference,
      awayRank: game.away.rank,
      homeRank: game.home.rank,
      rankingsKnown: game.away.rankKnown && game.home.rankKnown,
      status: game.status,
      projectedFirstHalfTotal: projection?.projectedTotal ?? null,
      actualFirstHalfTotal:
        game.firstHalfComplete &&
        game.away.firstHalfPoints !== null &&
        game.home.firstHalfPoints !== null
          ? game.away.firstHalfPoints + game.home.firstHalfPoints
          : null,
      simpleTotal: projection?.simpleTotal ?? null,
      paceAdjustedTotal: projection?.paceAdjustedTotal ?? null,
      featureKind: usable && features ? features.kind : null,
      featureCapturedAt: usable && features ? features.capturedAt : null,
      unavailableReason: projection
        ? null
        : !game.away.modelId || !game.home.modelId
          ? "One or both teams are outside the model's team-stat coverage."
          : "No valid pregame feature archive or eligible season-debut reconstruction.",
      markets: game.quotes.map((quote) => ({
        sportsbook: quote.sportsbook,
        openingLine: quote.opening?.total ?? null,
        latestLine: quote.latest?.total ?? null,
        capturedAt: quote.latestCapturedAt,
        source: quote.source,
        closingVerified: false,
      })),
    };
  });
  const predicted = predictions.filter(
    (row) => row.projectedFirstHalfTotal !== null,
  ).length;
  return predictionFeedSchema.parse({
    schemaVersion: 1,
    season: ledger.season,
    through: ledger.through,
    generatedAt,
    marketCapturedAt: ledger.capturedAt,
    modelVersion: "season-bridge-v1",
    mode: "regular_season_research",
    defaultSportsbook: "betmgm",
    defaultLineBasis: "latest",
    source: {
      repository,
      projectionCode: `${repository}/blob/${revision}/src/model/predictor.ts`,
      batchCode: `${repository}/blob/${revision}/src/model/predictions.ts`,
      revision,
    },
    counts: {
      matchups: predictions.length,
      predicted,
      unavailable: predictions.length - predicted,
    },
    predictions,
  });
}

export function predictionComparison(
  row: PredictionRow,
  sportsbook: string,
  basis: LineBasis,
) {
  const market = row.markets.find((quote) => quote.sportsbook === sportsbook);
  const line =
    (basis === "opening" ? market?.openingLine : market?.latestLine) ?? null;
  const comparison =
    row.projectedFirstHalfTotal !== null && line !== null
      ? compareTotal(row.projectedFirstHalfTotal, line)
      : null;
  return {
    line,
    signedEdge: comparison?.signedEdge ?? null,
    lean: comparison?.modelLean ?? null,
  };
}

export function isTop25(row: PredictionRow) {
  return row.awayRank !== null || row.homeRank !== null;
}

export function conferenceNames(rows: PredictionRow[]) {
  return [
    ...new Set(
      rows
        .flatMap((row) => [row.awayConference, row.homeConference])
        .filter((name): name is string => name !== null),
    ),
  ].sort();
}

export function filterPredictionGroups(
  rows: PredictionRow[],
  conference = "all",
  top25 = false,
) {
  return rows.filter(
    (row) =>
      (conference === "all" ||
        row.awayConference === conference ||
        row.homeConference === conference) &&
      (!top25 || isTop25(row)),
  );
}

/** Readable workbook rows use the same comparison function as the page and CSV. */
export function workbookPayload(feed: PredictionFeed) {
  return {
    ...feed,
    predictions: feed.predictions.map((row) => ({
      ...row,
      comparison: predictionComparison(
        row,
        feed.defaultSportsbook,
        feed.defaultLineBasis,
      ),
      top25: isTop25(row),
    })),
  };
}

export const csvCell = (value: string | number | null) => {
  let text = value === null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function predictionsToCsv(
  rows: PredictionRow[],
  sportsbook = "betmgm",
  basis: LineBasis = "latest",
) {
  const headers = [
    "game_id",
    "tipoff_utc",
    "tipoff_date_et",
    "tipoff_time_et",
    "tipoff_zone",
    "away_team",
    "home_team",
    "away_conference",
    "home_conference",
    "away_rank",
    "home_rank",
    "top_25_game",
    "status",
    "predicted_1h_total",
    "sportsbook",
    "line_basis",
    "comparison_line",
    "model_minus_line",
    "research_lean",
    "opening_1h_line",
    "latest_1h_line",
    "actual_1h_total",
    "feature_origin",
    "feature_captured_at",
    "unavailable_reason",
  ];
  const round = (value: number | null) =>
    value === null ? null : Number(value.toFixed(4));
  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => {
      const tipoff = easternTipoff(row.startsAt);
      const comparison = predictionComparison(row, sportsbook, basis);
      const market = row.markets.find(
        (quote) => quote.sportsbook === sportsbook,
      );
      return [
        row.gameId,
        row.startsAt,
        tipoff.date,
        tipoff.time,
        tipoff.zone,
        row.awayTeam,
        row.homeTeam,
        row.awayConference,
        row.homeConference,
        row.awayRank,
        row.homeRank,
        isTop25(row) ? "Yes" : row.rankingsKnown ? "No" : "Unknown",
        row.status,
        round(row.projectedFirstHalfTotal),
        sportsbook,
        basis,
        comparison.line,
        round(comparison.signedEdge),
        comparison.lean,
        market?.openingLine ?? null,
        market?.latestLine ?? null,
        row.actualFirstHalfTotal,
        row.featureKind,
        row.featureCapturedAt,
        row.unavailableReason,
      ]
        .map(csvCell)
        .join(",");
    }),
  ].join("\r\n")}\r\n`;
}
