import { z } from "zod";
import { ledgerSchema, type SeasonLedger, validFeatures } from "./audit";
import { dailyCoverageSchema, dailyRecordCoverage } from "./dailyRecord";
import { gameContextSchema } from "./gameContext";
import {
  csvCell,
  type PredictionFeed,
  predictionComparison,
  predictionFeedSchema,
  predictionSchema,
} from "./predictions";
import { participantsSchema, reviewSchedule } from "./scheduleReview";
import { predictionSignal, signalSchema } from "./signals";
import { easternTipoff } from "./time";

export { dailyRecordGames, dailyRecordStatus } from "./dailyRecord";

const gameSchema = ledgerSchema.shape.games.element;
export const forecastRecordSchema = z.object({
  id: z.string(),
  season: z.string(),
  gameId: z.string(),
  gameDate: z.iso.date(),
  version: z.number().int().positive(),
  recordedAt: z.iso.datetime(),
  signalCalculatedAt: z.iso.datetime(),
  origin: z.enum(["batch_capture", "published_observation"]),
  importedAt: z.iso.datetime().optional(),
  evidence: z
    .object({
      url: z.url(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      publishedAt: z.iso.datetime().optional(),
      deploymentUrl: z.url().optional(),
    })
    .nullable(),
  inputSnapshots: z
    .object({
      prior: z.string().regex(/^data\/input-snapshots\/[a-f0-9]{64}\.json$/),
      current: z.string().regex(/^data\/input-snapshots\/[a-f0-9]{64}\.json$/),
      currentMatchesFrozenInputs: z.boolean(),
    })
    .optional(),
  modelVersion: z.string(),
  source: predictionFeedSchema.shape.source,
  state: z.enum(["pregame", "historical", "unavailable"]),
  sportsbook: z.string(),
  basis: z.enum(["opening", "latest"]),
  comparison: z.object({
    line: z.number().positive().nullable(),
    signedEdge: z.number().nullable(),
    lean: z.enum(["OVER", "UNDER", "PUSH"]).nullable(),
  }),
  signal: signalSchema,
  prediction: predictionSchema,
  features: gameSchema.shape.featureSnapshot,
  quotes: gameSchema.shape.quotes,
  participants: participantsSchema.optional(),
});
export const resultEventSchema = z.object({
  id: z.string(),
  season: z.string(),
  gameId: z.string(),
  observedAt: z.iso.datetime(),
  sourceCapturedAt: z.iso.datetime(),
  startsAt: z.iso.datetime().optional(),
  awayPoints: z.number().int().min(0),
  homePoints: z.number().int().min(0),
  source: z.url(),
  participants: participantsSchema.optional(),
  context: gameContextSchema.optional(),
});
export const recordStoreSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  records: z.array(forecastRecordSchema),
  results: z.array(resultEventSchema),
});
export type ForecastRecord = z.infer<typeof forecastRecordSchema>;
export type RecordStore = z.infer<typeof recordStoreSchema>;
const countsSchema = z.object({
  season: z.string(),
  modelVersion: z.string(),
  sportsbook: z.string(),
  basis: z.string(),
  games: z.number(),
  versions: z.number(),
  pregame: z.number(),
  wins: z.number(),
  losses: z.number(),
  pushes: z.number(),
  pending: z.number(),
  winRate: z.number().nullable(),
  mae: z.number().nullable(),
  bands: z.array(
    z.object({
      label: z.string(),
      wins: z.number(),
      losses: z.number(),
      pushes: z.number(),
      pending: z.number(),
      winRate: z.number().nullable(),
    }),
  ),
});
export const recordIndexSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  canonicalIds: z.array(z.string()),
  summary: z.array(countsSchema),
  archives: z.array(
    z.object({
      date: z.iso.date(),
      games: z.number(),
      versions: z.number(),
      jsonPath: z
        .string()
        .regex(/^data\/prediction-record\/\d{4}-\d{2}-\d{2}\.json$/),
      csvPath: z
        .string()
        .regex(/^data\/prediction-record\/\d{4}-\d{2}-\d{2}\.csv$/),
      gamesCsvPath: z
        .string()
        .regex(/^data\/prediction-record\/\d{4}-\d{2}-\d{2}-games\.csv$/)
        .optional(),
      coverage: dailyCoverageSchema.optional(),
    }),
  ),
});
export type RecordIndex = z.infer<typeof recordIndexSchema>;
const gameKey = (r: { season: string; gameId: string }) =>
  `${r.season}:${r.gameId}`;
const groupKey = (r: ForecastRecord) =>
  `${r.season}:${r.modelVersion}:${r.sportsbook}:${r.basis}`;

function signature(
  row: ForecastRecord["prediction"],
  game: SeasonLedger["games"][number],
  includeQuotes = true,
) {
  return JSON.stringify({
    startsAt: row.startsAt,
    total: row.projectedFirstHalfTotal,
    simple: row.simpleTotal,
    pace: row.paceAdjustedTotal,
    reason: row.unavailableReason,
    features: game.featureSnapshot ?? null,
    quotes: includeQuotes
      ? game.quotes.map((q) => ({
          sportsbook: q.sportsbook,
          opening: q.opening,
          latest: q.latest,
        }))
      : undefined,
    // Retained quote evidence can be unchanged when a book vanishes/reappears.
    // Version the usable lines, without versioning check timestamps alone.
    marketLines: includeQuotes
      ? row.markets.map((market) => ({
          sportsbook: market.sportsbook,
          latestLine: market.latestLine,
        }))
      : undefined,
  });
}

/** Append prediction changes and result corrections. Earlier records are never rewritten. */
export function updatePredictionRecord(
  store: RecordStore,
  feed: PredictionFeed,
  ledger: SeasonLedger,
  recordedAt: string,
  options: {
    origin?: ForecastRecord["origin"];
    evidence?: ForecastRecord["evidence"];
    signalAt?: string;
    inputSnapshots?: {
      prior: string;
      current: string;
      currentRetrievedAt: string;
    };
  } = {},
): RecordStore {
  if (feed.season !== ledger.season)
    throw new Error("Record sources cover different seasons.");
  const records = [...store.records];
  const results = [...store.results];
  const games = new Map(ledger.games.map((g) => [g.id, g]));
  const latest = new Map<string, ForecastRecord>();
  const versions = new Map<string, number>();
  for (const r of records) {
    const key = gameKey(r);
    const previous = latest.get(key);
    if (
      !previous ||
      Date.parse(r.recordedAt) > Date.parse(previous.recordedAt) ||
      (r.recordedAt === previous.recordedAt && r.version > previous.version)
    )
      latest.set(key, r);
    versions.set(key, Math.max(versions.get(key) ?? 0, r.version));
  }
  for (const row of feed.predictions) {
    const game = games.get(row.gameId);
    if (!game) throw new Error(`Missing source game ${row.gameId}`);
    const key = `${feed.season}:${row.gameId}`;
    const previous = latest.get(key);
    if (previous) {
      if (Date.parse(recordedAt) < Date.parse(previous.recordedAt))
        throw new Error("Cannot backdate a prediction record.");
      // Freeze after either recorded tipoff. Results and corrections use their own events.
      const oldGame = {
        ...game,
        featureSnapshot: previous.features,
        quotes: previous.quotes,
      };
      const beforeTip =
        Date.parse(recordedAt) <
        Math.min(
          Date.parse(previous.prediction.startsAt),
          Date.parse(row.startsAt),
        );
      if (
        signature(row, game, beforeTip) ===
          signature(previous.prediction, oldGame, beforeTip) &&
        previous.modelVersion === feed.modelVersion &&
        previous.sportsbook === feed.defaultSportsbook &&
        previous.basis === feed.defaultLineBasis
      )
        continue;
    }
    const version = (versions.get(key) ?? 0) + 1;
    const quote = row.markets.find(
      (m) => m.sportsbook === feed.defaultSportsbook,
    );
    const pregame =
      !game.firstHalfComplete &&
      validFeatures(game) &&
      row.featureKind === "captured_pregame" &&
      row.actualFirstHalfTotal === null &&
      Date.parse(recordedAt) < Date.parse(row.startsAt) &&
      Date.parse(feed.generatedAt) <= Date.parse(recordedAt) &&
      (!quote || Date.parse(quote.capturedAt) <= Date.parse(recordedAt));
    const record = forecastRecordSchema.parse({
      id: `${feed.season}_${row.gameId}_v${version}`,
      season: feed.season,
      gameId: row.gameId,
      gameDate: easternTipoff(row.startsAt).date,
      version,
      recordedAt,
      signalCalculatedAt: options.signalAt ?? recordedAt,
      origin: options.origin ?? "batch_capture",
      evidence: options.evidence ?? null,
      inputSnapshots: options.inputSnapshots
        ? {
            prior: options.inputSnapshots.prior,
            current: options.inputSnapshots.current,
            currentMatchesFrozenInputs:
              game.featureSnapshot?.statsRetrievedAt ===
              options.inputSnapshots.currentRetrievedAt,
          }
        : undefined,
      modelVersion: feed.modelVersion,
      source: feed.source,
      state:
        row.projectedFirstHalfTotal === null
          ? "unavailable"
          : pregame
            ? "pregame"
            : "historical",
      sportsbook: feed.defaultSportsbook,
      basis: feed.defaultLineBasis,
      comparison: predictionComparison(
        row,
        feed.defaultSportsbook,
        feed.defaultLineBasis,
      ),
      signal: predictionSignal(
        row,
        feed.defaultSportsbook,
        feed.defaultLineBasis,
        options.signalAt ?? recordedAt,
      ),
      prediction: row,
      features: game.featureSnapshot ?? null,
      quotes: game.quotes,
      participants: { away: game.away, home: game.home },
    });
    records.push(record);
    latest.set(key, record);
    versions.set(key, version);
  }
  const lastResult = new Map<string, RecordStore["results"][number]>();
  for (const result of results) lastResult.set(gameKey(result), result);
  for (const game of ledger.games) {
    if (
      !game.firstHalfComplete ||
      game.away.firstHalfPoints === null ||
      game.home.firstHalfPoints === null
    )
      continue;
    const key = `${ledger.season}:${game.id}`;
    const previous = lastResult.get(key);
    const participants = participantsSchema.parse({
      away: game.away,
      home: game.home,
    });
    if (
      previous?.awayPoints === game.away.firstHalfPoints &&
      previous.homePoints === game.home.firstHalfPoints &&
      previous.startsAt === game.startsAt &&
      JSON.stringify(previous.participants) === JSON.stringify(participants) &&
      JSON.stringify(previous.context) === JSON.stringify(game.context)
    )
      continue;
    if (previous && Date.parse(recordedAt) < Date.parse(previous.observedAt))
      throw new Error("Cannot backdate a result correction.");
    const result = {
      id: `${key}_result${results.filter((r) => gameKey(r) === key).length + 1}`,
      season: ledger.season,
      gameId: game.id,
      observedAt: recordedAt,
      sourceCapturedAt: game.capturedAt,
      startsAt: game.startsAt,
      awayPoints: game.away.firstHalfPoints,
      homePoints: game.home.firstHalfPoints,
      source: game.scoresSource,
      participants,
      ...(game.context ? { context: game.context } : {}),
    };
    results.push(result);
    lastResult.set(key, result);
  }
  return recordStoreSchema.parse({
    schemaVersion: 1,
    updatedAt: options.signalAt ?? recordedAt,
    records,
    results,
  });
}

/** Recover only missing pregame benchmarks from a verified published archive. */
export function recoverPublishedPredictions(
  store: RecordStore,
  feed: PredictionFeed,
  ledger: SeasonLedger,
  publishedAt: string,
  importedAt: string,
  evidence: { url: string; sha256: string; deploymentUrl: string },
  gameDate: string,
): RecordStore {
  if (!/^[a-f0-9]{40}$/.test(feed.source.revision))
    throw new Error("Archive recovery requires an immutable source revision.");
  if (
    Date.parse(publishedAt) < Date.parse(feed.generatedAt) ||
    Date.parse(publishedAt) > Date.parse(importedAt)
  )
    throw new Error("Invalid verified publication time.");
  const candidates = updatePredictionRecord(
    { schemaVersion: 1, updatedAt: publishedAt, records: [], results: [] },
    feed,
    ledger,
    publishedAt,
    {
      origin: "published_observation",
      evidence: { ...evidence, publishedAt },
      signalAt: importedAt,
    },
  );
  const existing = new Set(
    canonicalRecords(store.records).map((r) => `${groupKey(r)}:${r.gameId}`),
  );
  const records = [...store.records];
  for (const r of canonicalRecords(candidates.records)) {
    const key = `${groupKey(r)}:${r.gameId}`;
    if (r.gameDate !== gameDate || existing.has(key)) continue;
    const version =
      Math.max(
        0,
        ...records
          .filter((p) => gameKey(p) === gameKey(r))
          .map((p) => p.version),
      ) + 1;
    records.push({
      ...r,
      id: `${r.season}_${r.gameId}_v${version}`,
      version,
      importedAt,
    });
    existing.add(key);
  }
  return recordStoreSchema.parse({ ...store, updatedAt: importedAt, records });
}

export function recordGrade(
  record: ForecastRecord,
  results: RecordStore["results"],
) {
  let result: RecordStore["results"][number] | undefined;
  for (let i = results.length - 1; i >= 0; i--)
    if (gameKey(results[i]) === gameKey(record)) {
      result = results[i];
      break;
    }
  const actual = result ? result.awayPoints + result.homePoints : null;
  const total = record.prediction.projectedFirstHalfTotal;
  let grade:
    | "Win"
    | "Loss"
    | "Push"
    | "Pending"
    | "Historical"
    | "No projection"
    | "No line"
    | "No lean";
  const schedule = reviewSchedule(
    {
      ...record,
      ...record.prediction,
      awayModelId: record.features?.away.id,
      homeModelId: record.features?.home.id,
    },
    result,
  );
  const scheduleChanged = schedule === "review";
  if (total === null) grade = "No projection";
  else if (record.state !== "pregame") grade = "Historical";
  else if (record.comparison.line === null) grade = "No line";
  else if (!record.comparison.lean || record.comparison.lean === "PUSH")
    grade = "No lean";
  else if (actual === null || scheduleChanged) grade = "Pending";
  else if (actual === record.comparison.line) grade = "Push";
  else
    grade =
      actual > record.comparison.line === (record.comparison.lean === "OVER")
        ? "Win"
        : "Loss";
  return {
    grade,
    actual,
    schedule,
    resultStartsAt: result?.startsAt ?? null,
    error:
      actual !== null && total !== null && !scheduleChanged
        ? total - actual
        : null,
  };
}

/** First eligible forecast for each game and benchmark is the official record. */
export function canonicalRecords(records: ForecastRecord[]) {
  const map = new Map<string, ForecastRecord>();
  for (const r of [...records].sort(
    (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.version - b.version,
  )) {
    if (
      r.state !== "pregame" ||
      r.prediction.projectedFirstHalfTotal === null ||
      r.comparison.line === null ||
      !r.comparison.lean ||
      r.comparison.lean === "PUSH"
    )
      continue;
    const key = `${groupKey(r)}:${r.gameId}`;
    if (!map.has(key)) map.set(key, r);
  }
  return [...map.values()];
}
const bandLabel = (r: ForecastRecord) =>
  r.signal.score === null
    ? "Unranked / review"
    : r.signal.score < 25
      ? "0–24"
      : r.signal.score < 50
        ? "25–49"
        : r.signal.score < 75
          ? "50–74"
          : "75–100";

export function buildRecordIndex(store: RecordStore): RecordIndex {
  const canonical = canonicalRecords(store.records);
  const keys = [...new Set(store.records.map(groupKey))];
  const tally = (records: ForecastRecord[]) => {
    const grades = records.map((r) => recordGrade(r, store.results));
    const wins = grades.filter((g) => g.grade === "Win").length;
    const losses = grades.filter((g) => g.grade === "Loss").length;
    return {
      wins,
      losses,
      pushes: grades.filter((g) => g.grade === "Push").length,
      pending: grades.filter((g) => g.grade === "Pending").length,
      winRate: wins + losses ? wins / (wins + losses) : null,
    };
  };
  const summary = keys.map((key) => {
    const all = store.records.filter((r) => groupKey(r) === key);
    const first = all[0];
    const counted = canonical.filter((r) => groupKey(r) === key);
    const errors = counted
      .map((r) => recordGrade(r, store.results).error)
      .filter((n): n is number => n !== null);
    return {
      season: first.season,
      modelVersion: first.modelVersion,
      sportsbook: first.sportsbook,
      basis: first.basis,
      games: new Set(all.map(gameKey)).size,
      versions: all.length,
      pregame: counted.length,
      ...tally(counted),
      mae: errors.length
        ? errors.reduce((sum, n) => sum + Math.abs(n), 0) / errors.length
        : null,
      bands: ["75–100", "50–74", "25–49", "0–24", "Unranked / review"].map(
        (label) => ({
          label,
          ...tally(counted.filter((r) => bandLabel(r) === label)),
        }),
      ),
    };
  });
  const dates = [...new Set(store.records.map((r) => r.gameDate))]
    .sort()
    .reverse();
  return recordIndexSchema.parse({
    schemaVersion: 1,
    updatedAt: store.updatedAt,
    canonicalIds: canonical.map((r) => r.id),
    summary,
    archives: dates.map((date) => {
      const records = store.records.filter((r) => r.gameDate === date);
      return {
        date,
        versions: records.length,
        games: new Set(records.map(gameKey)).size,
        jsonPath: `data/prediction-record/${date}.json`,
        csvPath: `data/prediction-record/${date}.csv`,
        gamesCsvPath: `data/prediction-record/${date}-games.csv`,
        coverage: dailyRecordCoverage(
          recordForDate(store, date),
          canonical.map((r) => r.id),
        ),
      };
    }),
  });
}

export function recordForDate(store: RecordStore, date: string): RecordStore {
  const records = store.records.filter((r) => r.gameDate === date);
  const games = new Set(records.map(gameKey));
  return {
    ...store,
    records,
    results: store.results.filter((r) => games.has(gameKey(r))),
  };
}

export function recordToCsv(store: RecordStore, canonicalIds: string[]) {
  const ids = new Set(canonicalIds);
  const headers = [
    "record_id",
    "recorded_at_utc",
    "season",
    "game_id",
    "version",
    "tipoff_date_et",
    "tipoff_time_et",
    "away_team",
    "home_team",
    "model_1h",
    "sportsbook",
    "line_basis",
    "frozen_line",
    "lean",
    "signal_score",
    "signal_status",
    "actual_1h",
    "result",
    "counted_in_record",
    "feature_kind",
    "feature_captured_at",
    "source_revision",
    ...["away", "home"].flatMap((side) =>
      [
        "firstHalfPoints",
        "pace",
        "offensiveEfficiency",
        "defensiveEfficiency",
        "currentGames",
        "currentWeight",
      ].map((m) => `${side}_${m}`),
    ),
    "schedule_status",
    "result_tipoff_utc",
  ];
  const rows = store.records.map((r) => {
    const g = recordGrade(r, store.results);
    const t = easternTipoff(r.prediction.startsAt);
    return [
      r.id,
      r.recordedAt,
      r.season,
      r.gameId,
      r.version,
      t.date,
      `${t.time} ET`,
      r.prediction.awayTeam,
      r.prediction.homeTeam,
      r.prediction.projectedFirstHalfTotal,
      r.sportsbook,
      r.basis,
      r.comparison.line,
      r.comparison.lean,
      r.signal.score,
      r.signal.label,
      g.actual,
      g.grade,
      ids.has(r.id) ? "Yes" : "No",
      r.prediction.featureKind,
      r.prediction.featureCapturedAt,
      r.source.revision,
      ...(["away", "home"] as const).flatMap((side) => {
        const team = r.features?.[side];
        return [
          team?.firstHalfPoints ?? null,
          team?.pace ?? null,
          team?.offensiveEfficiency ?? null,
          team?.defensiveEfficiency ?? null,
          team?.currentGames ?? null,
          team?.currentWeight ?? null,
        ];
      }),
      g.schedule,
      g.resultStartsAt,
    ];
  });
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
