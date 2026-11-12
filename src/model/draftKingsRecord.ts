import { usesTipoffEntry } from "./entryPolicy";
import { marketStatus } from "./marketCoverage";
import {
  buildRecordIndex,
  canonicalRecords,
  type ForecastRecord,
  type RecordStore,
  recordIndexSchema,
  recordStoreSchema,
} from "./predictionRecord";
import { compareTotal } from "./predictor";
import { projectionSignal } from "./signals";
import { easternTipoff } from "./time";

const key = (row: ForecastRecord) =>
  `${row.season}:${row.modelVersion}:${row.gameId}`;

export function draftKingsRecordIndex(store: RecordStore) {
  const index = buildRecordIndex(store);
  return recordIndexSchema.parse({
    ...index,
    archives: index.archives.map((archive) => ({
      ...archive,
      jsonPath: archive.jsonPath.replace(
        "prediction-record/",
        "prediction-record-draftkings/",
      ),
      csvPath: archive.csvPath.replace(
        "prediction-record/",
        "prediction-record-draftkings/",
      ),
      ...(archive.gamesCsvPath
        ? {
            gamesCsvPath: archive.gamesCsvPath.replace(
              "prediction-record/",
              "prediction-record-draftkings/",
            ),
          }
        : {}),
    })),
  });
}

/** Select only source-verified DraftKings quotes observed before the original tip. */
export function archivedDraftKingsQuote(
  original: ForecastRecord,
  rows: ForecastRecord[],
) {
  return rows
    .filter((row) => {
      const quote = row.quotes.find((item) => item.sportsbook === "draftkings");
      const market = row.prediction.markets.find(
        (item) => item.sportsbook === "draftkings",
      );
      return (
        key(row) === key(original) &&
        quote?.latest !== null &&
        quote?.latest !== undefined &&
        row.prediction.actualFirstHalfTotal === null &&
        marketStatus(row.prediction, "draftkings") === "available" &&
        market?.latestLine === quote.latest.total &&
        Date.parse(quote.latestCapturedAt) <= Date.parse(row.recordedAt) &&
        Date.parse(row.recordedAt) < Date.parse(original.prediction.startsAt) &&
        (!original.participants ||
          !row.participants ||
          (original.participants.away.espnId === row.participants.away.espnId &&
            original.participants.home.espnId === row.participants.home.espnId))
      );
    })
    .sort((a, b) => {
      const captured = (row: ForecastRecord) =>
        row.quotes.find((item) => item.sportsbook === "draftkings")
          ?.latestCapturedAt ?? "";
      return (
        Date.parse(captured(b)) - Date.parse(captured(a)) ||
        Date.parse(b.recordedAt) - Date.parse(a.recordedAt) ||
        b.version - a.version
      );
    })[0];
}

/** Derivative view only: never write these research replays into the official store or stake journal. */
export function draftKingsRecord(store: RecordStore, at: string): RecordStore {
  const records: ForecastRecord[] = [];
  const originals = canonicalRecords(store.records, store.entryPolicy);
  const histories = new Map<string, ForecastRecord[]>();
  for (const row of store.records)
    histories.set(key(row), [...(histories.get(key(row)) ?? []), row]);
  const preferred = new Map<string, ForecastRecord>();
  for (const row of originals) {
    const previous = preferred.get(key(row));
    if (!previous || row.sportsbook === "draftkings")
      preferred.set(key(row), row);
  }
  const pastDate = easternTipoff(at).date;
  const finished = new Set(
    store.results
      .filter((result) => Date.parse(result.observedAt) <= Date.parse(at))
      .map((result) => `${result.season}:${result.gameId}`),
  );
  const pastReplays = new Set<string>();
  // Past-day research can replay a frozen pregame forecast even if the final-window
  // official entry was missed. This never becomes a recorded pre-tip stake.
  for (const row of [...store.records].sort(
    (a, b) =>
      Date.parse(a.recordedAt) - Date.parse(b.recordedAt) ||
      a.version - b.version,
  )) {
    if (
      preferred.has(key(row)) ||
      row.gameDate >= pastDate ||
      !finished.has(`${row.season}:${row.gameId}`) ||
      row.state !== "pregame" ||
      row.prediction.featureKind !== "captured_pregame" ||
      row.prediction.projectedFirstHalfTotal === null ||
      Date.parse(row.recordedAt) >= Date.parse(row.prediction.startsAt)
    )
      continue;
    preferred.set(key(row), row);
    pastReplays.add(key(row));
  }
  for (const original of preferred.values()) {
    if (
      original.sportsbook === "draftkings" &&
      !pastReplays.has(key(original))
    ) {
      records.push(original);
      continue;
    }
    // Current-day and future entries still require the official pre-tip check.
    if (
      !pastReplays.has(key(original)) &&
      usesTipoffEntry(
        original.prediction.startsAt,
        store.entryPolicy,
        `${original.season}:${original.gameId}`,
      )
    )
      continue;
    if (
      original.prediction.featureKind !== "captured_pregame" ||
      Date.parse(original.recordedAt) >=
        Date.parse(original.prediction.startsAt) ||
      (original.prediction.featureCapturedAt &&
        Date.parse(original.prediction.featureCapturedAt) >
          Date.parse(original.recordedAt))
    )
      continue;
    const source = archivedDraftKingsQuote(
      original,
      histories.get(key(original)) ?? [],
    );
    const quote = source?.quotes.find(
      (item) => item.sportsbook === "draftkings",
    )?.latest;
    if (
      !source ||
      !quote ||
      original.prediction.projectedFirstHalfTotal === null
    )
      continue;
    const comparison = compareTotal(
      original.prediction.projectedFirstHalfTotal,
      quote.total,
    );
    const calculated = projectionSignal(original.prediction, quote.total);
    records.push({
      ...original,
      id: `${original.id}_draftkings_replay_${source.id}`,
      sportsbook: "draftkings",
      basis: "latest",
      recordedAt: source.recordedAt,
      signalCalculatedAt: at,
      quotes: source.quotes,
      comparison: {
        line: quote.total,
        signedEdge: comparison.signedEdge,
        lean: comparison.modelLean,
      },
      signal: {
        ...calculated,
        score: null,
        fill: null,
        reason:
          "DraftKings archive replay; confidence calculated later from the original frozen model and archived pre-tip line.",
      },
      replay: {
        method: "draftkings-archive-v1",
        sourceRecordId: original.id,
        sourceQuoteRecordId: source.id,
        originalSportsbook: original.sportsbook,
        calculatedAt: at,
      },
    });
  }
  // Official entries were selected above with their original policy. This
  // derivative store also contains older archive replays, which must not be
  // rejected a second time by the live final-15-minute entry rule.
  return recordStoreSchema.parse({
    ...store,
    entryPolicy: undefined,
    updatedAt: at,
    records,
  });
}
