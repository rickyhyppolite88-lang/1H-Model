import { useEffect, useState } from "react";
import GameTime from "./GameTime";
import { dailyRecordedResults } from "./model/dailyResults";
import {
  type RecordIndex,
  type RecordStore,
  recordIndexSchema,
  recordStoreSchema,
} from "./model/predictionRecord";

export type DailyRecordEvidence = {
  date: string;
  store: RecordStore | null;
  canonicalIds: string[];
  status: "ready" | "missing" | "error";
};

type Benchmark = {
  season: string;
  modelVersion: string;
  sportsbook: string;
  basis: string;
};

export function DailyRecordSummary({
  date,
  store,
  canonicalIds,
  sportsbook,
  basis,
  gamesCsvPath,
}: {
  date: string;
  store: RecordStore;
  canonicalIds: string[];
  sportsbook: string;
  basis: string;
  gamesCsvPath?: string;
}) {
  const results = dailyRecordedResults(store, canonicalIds, date);
  return (
    <section className="daily-results" aria-label={`Record for ${date}`}>
      <h3>Record for {date} · ET</h3>
      <p>
        Whole-day record · {sportsbook === "betmgm" ? "BetMGM" : sportsbook}/
        {basis} at recording. Each game’s first eligible pregame pick counts
        once, using its original saved line. Table filters do not change this
        record.
      </p>
      <div className="audit-metrics">
        <div>
          <span>Wins / losses / pushes</span>
          <strong>
            {results.wins} / {results.losses} / {results.pushes}
          </strong>
        </div>
        <div>
          <span>Pending picks</span>
          <strong>{results.pending}</strong>
        </div>
        <div>
          <span>Observed win rate</span>
          <strong>
            {results.winRate === null
              ? "—"
              : `${(results.winRate * 100).toFixed(1)}%`}
          </strong>
        </div>
        <div>
          <span>Counted pregame picks</span>
          <strong>{results.counted}</strong>
        </div>
      </div>
      <p className="inline-note">
        {results.games} games saved · {results.excluded} outside the official
        record. Missing projections, unpriced games, and historical estimates
        are excluded. Pushes are excluded from win rate.
        {results.winRate === null ? " No graded wins or losses yet." : ""}
      </p>
      <div className="daily-record-footer">
        {gamesCsvPath && (
          <a
            className="text-button"
            href={`${import.meta.env.BASE_URL}${gamesCsvPath}`}
            download={`1h-record-${date}.csv`}
          >
            Download this day’s record CSV ↓
          </a>
        )}
        <span>
          Record updated <GameTime startsAt={store.updatedAt} />
        </span>
      </div>
    </section>
  );
}

type LoadedRecord = {
  date: string;
  index: RecordIndex;
  store: RecordStore | null;
  gamesCsvPath?: string;
};

export default function DailyRecord({
  date,
  season,
  modelVersion,
  sportsbook,
  basis,
  onEvidence,
}: Benchmark & {
  date: string;
  onEvidence?: (evidence: DailyRecordEvidence) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedRecord | null>(null);
  const [error, setError] = useState<{ date: string; message: string } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    const read = async (path: string) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "The daily record could not be loaded. Try refreshing the page.",
        );
      return response.json();
    };
    const load = async () => {
      try {
        const index = recordIndexSchema.parse(
          await read("data/prediction-record-index.json"),
        );
        const archive = index.archives.find((entry) => entry.date === date);
        const store = archive
          ? recordStoreSchema.parse(await read(archive.jsonPath))
          : null;
        if (controller.signal.aborted) return;
        setLoaded({
          date,
          index,
          store: store
            ? {
                ...store,
                records: store.records.filter(
                  (r) =>
                    r.gameDate === date &&
                    r.season === season &&
                    r.modelVersion === modelVersion &&
                    r.sportsbook === sportsbook &&
                    r.basis === basis,
                ),
              }
            : null,
          gamesCsvPath: archive?.gamesCsvPath,
        });
        setError(null);
        onEvidence?.({
          date,
          store,
          canonicalIds: index.canonicalIds,
          status: store ? "ready" : "missing",
        });
      } catch {
        if (!controller.signal.aborted) {
          setError({
            date,
            message:
              "The daily record could not be loaded. Try refreshing the page.",
          });
          onEvidence?.({
            date,
            store: null,
            canonicalIds: [],
            status: "error",
          });
        }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [date, season, modelVersion, sportsbook, basis, onEvidence]);
  if (error?.date === date)
    return (
      <section className="daily-results" aria-label={`Record for ${date}`}>
        <h3>Record for {date} · ET</h3>
        <p>{error.message}</p>
      </section>
    );
  if (loaded?.date !== date)
    return (
      <section className="daily-results" aria-label={`Record for ${date}`}>
        <h3>Record for {date} · ET</h3>
        <p>Loading this day’s record…</p>
      </section>
    );
  if (!loaded.store)
    return (
      <section className="daily-results" aria-label={`Record for ${date}`}>
        <h3>Record for {date} · ET</h3>
        <p>No saved record is available for this date yet.</p>
      </section>
    );
  return (
    <DailyRecordSummary
      date={date}
      store={loaded.store}
      canonicalIds={loaded.index.canonicalIds}
      sportsbook={sportsbook}
      basis={basis}
      gamesCsvPath={loaded.gamesCsvPath}
    />
  );
}
