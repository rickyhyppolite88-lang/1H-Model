import type { SeasonLedger } from "./audit";
import type { LabHalf } from "./lab";
import { featureReplaySchema } from "./labFeatureSchema";
import { captureFeatureForecast, fitFeatureModel } from "./labFeatures";
import { featurePaperMethods } from "./labVersions";
import { type RecordStore, recordGrade } from "./predictionRecord";
import type { PredictionFeed } from "./predictions";
import { easternTipoff } from "./time";
import { settleUnits } from "./units";

/** Research replay only. Never constructs a Lab store or a stake assignment. */
export function replayFeatureTrials(
  record: RecordStore,
  ledger: SeasonLedger,
  halves: LabHalf[],
  at: string,
  excluded: string[] = [],
) {
  const results = record.results.filter(
    (r) => Date.parse(r.observedAt) <= Date.parse(at),
  );
  const games = new Map(ledger.games.map((g) => [g.id, g]));
  const records = record.records.filter(
    (r) =>
      r.state === "pregame" &&
      r.features &&
      r.prediction.featureKind === "captured_pregame" &&
      r.recordedAt <= at &&
      r.recordedAt < r.prediction.startsAt,
  );
  const firstCapture = new Map<string, string>();
  for (const r of records) {
    const date = easternTipoff(r.recordedAt).date;
    if (
      !firstCapture.has(date) ||
      r.recordedAt < (firstCapture.get(date) ?? "")
    )
      firstCapture.set(date, r.recordedAt);
  }
  const models = new Map(
    [...firstCapture].map(([date, time]) => [
      date,
      fitFeatureModel(
        halves,
        ledger.season,
        time,
        "historical-replay",
        excluded,
      ),
    ]),
  );
  const selected = new Map<
    string,
    {
      method: string;
      gameId: string;
      date: string;
      recordId: string;
      recordedAt: string;
      quoteAt: string;
      line: number;
      total: number;
      baseline: number;
      actual: number;
      side: "OVER" | "UNDER";
      price: number;
      baselinePrice: number | null;
      adjustment: number;
      fitAt: string;
      trainingGames: number;
    }
  >();
  const candidates = new Set<string>();
  for (const r of [...records].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  )) {
    const grade = recordGrade(r, results),
      original = games.get(r.gameId);
    if (
      grade.actual === null ||
      grade.error === null ||
      !original ||
      !r.features
    )
      continue;
    const game = {
      ...original,
      startsAt: r.prediction.startsAt,
      featureSnapshot: r.features,
      quotes: r.quotes,
      firstHalfComplete: false,
      away: {
        ...original.away,
        ...r.participants?.away,
        firstHalfPoints: null,
      },
      home: {
        ...original.home,
        ...r.participants?.home,
        firstHalfPoints: null,
      },
    };
    const model = models.get(easternTipoff(r.recordedAt).date);
    const feed = {
      season: r.season,
      source: { revision: "historical-replay" },
      marketCapturedAt: r.prediction.marketCoverage?.checkedAt ?? r.recordedAt,
    } as PredictionFeed;
    candidates.add(r.gameId);
    for (const method of featurePaperMethods) {
      const row = captureFeatureForecast(
        method,
        r.prediction,
        game,
        feed,
        model,
        "historical-replay",
        r.recordedAt,
      );
      if (
        row.status !== "paper_test" ||
        !row.feature ||
        row.line === null ||
        row.total === null ||
        row.baselineTotal === null ||
        (row.side !== "OVER" && row.side !== "UNDER")
      )
        continue;
      const price = row.side === "OVER" ? row.overPrice : row.underPrice;
      if (price === null) continue;
      selected.set(`${method}:${r.gameId}`, {
        method,
        gameId: r.gameId,
        date: r.gameDate,
        recordId: r.id,
        recordedAt: r.recordedAt,
        quoteAt: String(row.inputs.entryQuoteCapturedAt),
        line: row.line,
        total: row.total,
        baseline: row.baselineTotal,
        actual: grade.actual,
        side: row.side,
        price,
        baselinePrice:
          row.baselineTotal > row.line
            ? row.overPrice
            : row.baselineTotal < row.line
              ? row.underPrice
              : null,
        adjustment: row.feature.adjustment,
        fitAt: row.feature.fittedAt,
        trainingGames: row.feature.trainingGames,
      });
    }
  }
  const rows = [...selected.values()];
  const methods = Object.fromEntries(
    featurePaperMethods.map((method) => {
      const cohort = rows.filter((r) => r.method === method);
      let wins = 0,
        losses = 0,
        pushes = 0,
        net = 0,
        baselineWins = 0,
        baselineLosses = 0,
        baselinePushes = 0,
        baselineNoLean = 0,
        baselineNet = 0,
        changedSides = 0;
      for (const r of cohort) {
        const grade =
          r.actual === r.line
            ? "Push"
            : r.actual > r.line === (r.side === "OVER")
              ? "Win"
              : "Loss";
        if (grade === "Win") wins++;
        else if (grade === "Loss") losses++;
        else pushes++;
        net += settleUnits(1, r.price, grade) ?? 0;
        if (r.baseline === r.line) {
          baselineNoLean++;
          continue;
        }
        const baselineSide = r.baseline > r.line ? "OVER" : "UNDER";
        const bg =
          r.actual === r.line
            ? "Push"
            : r.actual > r.line === (baselineSide === "OVER")
              ? "Win"
              : "Loss";
        if (bg === "Win") baselineWins++;
        else if (bg === "Loss") baselineLosses++;
        else baselinePushes++;
        baselineNet += settleUnits(1, r.baselinePrice, bg) ?? 0;
        if (baselineSide !== r.side) changedSides++;
      }
      return [
        method,
        {
          games: cohort.length,
          wins,
          losses,
          pushes,
          net,
          baselineWins,
          baselineLosses,
          baselinePushes,
          baselineNoLean,
          baselineNet,
          changedSides,
          mae: cohort.length
            ? cohort.reduce((s, r) => s + Math.abs(r.total - r.actual), 0) /
              cohort.length
            : null,
          baselineMae: cohort.length
            ? cohort.reduce((s, r) => s + Math.abs(r.baseline - r.actual), 0) /
              cohort.length
            : null,
        },
      ];
    }),
  );
  const dates = rows.map((r) => r.date).sort();
  return {
    report: featureReplaySchema.parse({
      schemaVersion: 1,
      policy: "isolated-half-features-v1",
      updatedAt: at,
      from: dates[0] ?? null,
      through: dates.at(-1) ?? null,
      candidates: candidates.size,
      skipped: candidates.size - new Set(rows.map((r) => r.gameId)).size,
      methods,
    }),
    rows,
  };
}
