import { useEffect, useRef, useState } from "react";
import AvailabilityHelp from "./AvailabilityHelp";
import GameTime from "./GameTime";
import { dailyRecordCoverage, dailyRecordGames } from "./model/dailyRecord";
import {
  type RecordIndex,
  type RecordStore,
  recordGrade,
  recordIndexSchema,
  recordStoreSchema,
} from "./model/predictionRecord";
import {
  finishedRecordStore,
  finishedRecordSummary,
  mergeRecordStores,
} from "./model/recordViews";
import { actualUnitPlay } from "./model/units";
import RecordTable from "./RecordTable";
import UnitCalendar from "./UnitCalendar";
import {
  preferencePage,
  preferenceRecordDate,
  preferenceRecordView,
  preferenceText,
  usePreference,
} from "./usePreference";
import { useUnitLedger } from "./useUnitLedger";

const rate = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const summaryKey = (s: RecordIndex["summary"][number]) =>
  `${s.season}:${s.modelVersion}:${s.sportsbook}:${s.basis}`;

export default function PredictionRecord() {
  const {
    ledger: unitLedger,
    plays: calendarPlays,
    error: unitError,
  } = useUnitLedger();
  const [index, setIndex] = useState<RecordIndex | null>(null);
  const [indexError, setIndexError] = useState("");
  const [date, setDate] = usePreference(
    "record.date",
    preferenceRecordDate,
    "all",
  );
  const [group, setGroup] = usePreference("record.group", preferenceText, "");
  const [view, setView] = usePreference(
    "record.view",
    preferenceRecordView,
    "games",
  );
  const [query, setQuery] = usePreference("record.search", preferenceText, "");
  const [page, setPage] = usePreference("record.page", preferencePage, 0);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    store: RecordStore | null;
    error: string;
  } | null>(null);
  const cache = useRef(
    new Map<string, { revision: string; store: RecordStore }>(),
  );
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/prediction-record-index.json`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("The prediction record could not be loaded.");
        const data = recordIndexSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setIndex(data);
          setIndexError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setIndexError(
            "The prediction record could not be refreshed. Try reloading the page.",
          );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  const archive = index?.archives.find((entry) => entry.date === date);
  const loadKey = `${index?.updatedAt ?? ""}:${date}:${retry}`;
  useEffect(() => {
    if (!index) return;
    const controller = new AbortController();
    const archives = date === "all" ? index.archives : archive ? [archive] : [];
    const load = async () => {
      try {
        const stores = await Promise.all(
          archives.map(async (entry) => {
            const cached = cache.current.get(entry.jsonPath);
            if (cached?.revision === index.updatedAt) return cached.store;
            const response = await fetch(
              `${import.meta.env.BASE_URL}${entry.jsonPath}`,
              { signal: controller.signal, cache: "no-store" },
            );
            if (!response.ok)
              throw new Error("A saved record could not be loaded.");
            const store = recordStoreSchema.parse(await response.json());
            if (!controller.signal.aborted)
              cache.current.set(entry.jsonPath, {
                revision: index.updatedAt,
                store,
              });
            return store;
          }),
        );
        const store = mergeRecordStores(stores, index.updatedAt);
        if (!controller.signal.aborted)
          setLoaded({ key: loadKey, store, error: "" });
      } catch {
        if (!controller.signal.aborted)
          setLoaded({
            key: loadKey,
            store: null,
            error:
              "The full record could not load all dates. No partial history is shown.",
          });
      }
    };
    void load();
    return () => controller.abort();
  }, [index, date, archive, loadKey]);

  if (!index)
    return indexError ? (
      <div className="notice error" role="alert">
        {indexError}
      </div>
    ) : (
      <div className="empty-state">Loading the shared prediction record…</div>
    );
  const benchmark =
    index.summary.find((entry) => summaryKey(entry) === group) ??
    index.summary[index.summary.length - 1];
  const current = loaded?.key === loadKey ? loaded : null;
  const store = current?.store ?? null;
  const modelRecords = (store?.records ?? []).filter(
    (record) =>
      !benchmark ||
      (record.season === benchmark.season &&
        record.modelVersion === benchmark.modelVersion &&
        record.sportsbook === benchmark.sportsbook &&
        record.basis === benchmark.basis),
  );
  const unitPlays = modelRecords
    .filter((record) => index.canonicalIds.includes(record.id))
    .map((record) => actualUnitPlay(record, store?.results ?? [], unitLedger));
  const unitMap = new Map(unitPlays.map((play) => [play.id, play]));
  const scopedStore = store
    ? finishedRecordStore({
        ...store,
        records: store.records.filter(
          (record) =>
            (!benchmark ||
              (record.season === benchmark.season &&
                record.modelVersion === benchmark.modelVersion &&
                record.sportsbook === benchmark.sportsbook &&
                record.basis === benchmark.basis)) &&
            (date === "all" || record.gameDate === date),
        ),
      })
    : null;
  const summary = scopedStore
    ? finishedRecordSummary(scopedStore, index.canonicalIds)
    : null;
  const coverage = scopedStore
    ? dailyRecordCoverage(scopedStore, index.canonicalIds)
    : null;
  const ids = new Set(index.canonicalIds);
  const selected =
    view === "games"
      ? dailyRecordGames(scopedStore?.records ?? [], index.canonicalIds)
      : (scopedStore?.records ?? []);
  const rows = selected
    .filter(
      (record) =>
        `${record.prediction.awayTeam} ${record.prediction.homeTeam}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (view !== "official" ||
          (ids.has(record.id) &&
            ["Win", "Loss", "Push"].includes(
              recordGrade(record, store?.results ?? []).grade,
            ))),
    )
    .sort(
      (a, b) =>
        b.gameDate.localeCompare(a.gameDate) ||
        a.prediction.startsAt.localeCompare(b.prediction.startsAt) ||
        b.version - a.version,
    );
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * 25, (safePage + 1) * 25);
  function resetFilters() {
    setView("games");
    setQuery("");
    setPage(0);
  }
  function selectDate(value: string) {
    setDate(value);
    resetFilters();
  }

  return (
    <section className="panel prediction-record-panel">
      <div className="section-heading">
        <span className="step">LOG</span>
        <div>
          <h2>Running prediction record</h2>
          <p>
            Finished first-half results. Tap a calendar day to see its picks,
            stakes and results. Saved confidence % is the original model score,
            not a win probability.
          </p>
        </div>
      </div>
      {benchmark && (
        <p className="record-benchmark">
          {benchmark.season} · {benchmark.modelVersion} ·{" "}
          {benchmark.sportsbook === "betmgm" ? "BetMGM" : benchmark.sportsbook}/
          {benchmark.basis} at recording
        </p>
      )}
      {index.summary.length > 1 && (
        <label className="record-model-control">
          Record season / model
          <select
            value={benchmark ? summaryKey(benchmark) : ""}
            onChange={(event) => {
              setGroup(event.target.value);
              resetFilters();
            }}
          >
            {index.summary.map((entry) => (
              <option key={summaryKey(entry)} value={summaryKey(entry)}>
                {entry.season} · {entry.modelVersion} · {entry.sportsbook}/
                {entry.basis}
              </option>
            ))}
          </select>
        </label>
      )}
      {indexError && (
        <p className="notice error" role="alert">
          {indexError}
        </p>
      )}
      <UnitCalendar
        plays={(calendarPlays ?? []).filter(
          (play) =>
            play.source === "actual" &&
            play.actual !== null &&
            (!benchmark ||
              (play.season === benchmark.season &&
                play.method === benchmark.modelVersion &&
                play.sportsbook === benchmark.sportsbook &&
                play.basis === benchmark.basis)),
        )}
        date={date}
        onSelectDate={(value) => {
          selectDate(value);
          if (value !== "all") setView("official");
        }}
        available={Boolean(unitLedger && calendarPlays)}
        error={unitError}
      />
      <section
        className="record-overview"
        aria-label="Full record summary"
        aria-live="polite"
        aria-busy={!summary && !current?.error}
      >
        <div className="record-overview-top">
          <div>
            <h3>Full prediction record</h3>
            <p>
              {date === "all"
                ? "All dates · finished first halves"
                : `${date} · ET · finished first halves`}
            </p>
          </div>
          <label className="record-date-control">
            Daily breakdown (ET)
            <select
              value={date}
              onChange={(event) => selectDate(event.target.value)}
            >
              <option value="all">All dates · full record</option>
              {date !== "all" && !archive && (
                <option value={date}>{date} · no saved archive</option>
              )}
              {index.archives.map((entry) => (
                <option key={entry.date} value={entry.date}>
                  {entry.date} · ET
                </option>
              ))}
            </select>
          </label>
        </div>
        {summary ? (
          <>
            <div className="audit-metrics">
              <div>
                <span>Wins / losses / pushes</span>
                <strong>
                  {summary.wins} / {summary.losses} / {summary.pushes}
                </strong>
              </div>
              <div>
                <span>Observed win rate</span>
                <strong>{rate(summary.winRate)}</strong>
              </div>
              <div>
                <span>Official graded picks</span>
                <strong>{summary.counted}</strong>
              </div>
              <div>
                <span>Finished games</span>
                <strong>{summary.games}</strong>
              </div>
            </div>
            <p className="inline-note">
              Only each game’s original eligible pregame pick counts in the
              win/loss record. Pushes are excluded from win rate.{" "}
              {summary.ungraded} finished games have no official grade.
              {summary.review > 0
                ? ` ${summary.review} results need schedule review.`
                : ""}
            </p>
          </>
        ) : (
          <p>
            {current?.error
              ? "Record totals are unavailable until the selected records load."
              : "Loading finished results…"}
          </p>
        )}
      </section>
      <div className="record-history-heading">
        <h3>
          {date === "all"
            ? "Finished prediction history"
            : `Finished predictions for ${date}`}
        </h3>
        <span>{date === "all" ? "All saved dates" : "Selected day only"}</span>
      </div>
      <div className="record-history-filters">
        <label>
          Record view
          <select
            value={view}
            onChange={(event) => {
              setView(event.target.value);
              setPage(0);
            }}
          >
            <option value="games">Finished games · one row per matchup</option>
            <option value="official">Official graded results</option>
            <option value="all">All saved versions · finished games</option>
          </select>
        </label>
        <label>
          Search recorded matchups
          <input
            value={query}
            placeholder="Team name…"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      {current?.error ? (
        <div className="record-load-error">
          <p className="notice error" role="alert">
            {current.error}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry loading records
          </button>
        </div>
      ) : !scopedStore ? (
        <div className="empty-state">Loading finished prediction history…</div>
      ) : (
        <>
          <RecordTable
            records={visible}
            results={scopedStore.results}
            canonicalIds={index.canonicalIds}
            unitPlays={unitMap}
            showVersions={view === "all"}
            onOpenDay={date === "all" ? selectDate : undefined}
            emptyMessage={
              summary?.games
                ? undefined
                : `No finished first-half results are recorded${date === "all" ? "" : ` for ${date}`} yet. Upcoming games are available in Today’s lines.`
            }
          />
          <div className="prediction-pagination">
            <span>
              {rows.length}{" "}
              {view === "all"
                ? "finished-game versions"
                : view === "official"
                  ? "official graded picks"
                  : "finished games"}{" "}
              in this view · {date === "all" ? "all dates" : date}
            </span>
            <div className="button-group">
              <button
                className="secondary-button"
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={safePage >= pages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      <div className="record-extras">
        {summary && (
          <details>
            <summary>Results by saved confidence score</summary>
            <p>
              Official finished results for{" "}
              {date === "all" ? "all dates" : date}; confidence scores are
              research rankings, not win probabilities. These bands use only
              original saved scores; ratings labeled Calculated later remain
              separate.
            </p>
            <div className="table-wrap">
              <table aria-label="Signal results">
                <thead>
                  <tr>
                    <th>Confidence score band (%)</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Pushes</th>
                    <th>Observed win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.bands.map((band) => (
                    <tr key={band.label}>
                      <th scope="row">{band.label}</th>
                      <td>{band.wins}</td>
                      <td>{band.losses}</td>
                      <td>{band.pushes}</td>
                      <td>{rate(band.winRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        {coverage && (
          <details>
            <summary>Coverage & data gaps</summary>
            <p>
              {coverage.games} finished games · {coverage.projected} with
              projections · {coverage.unavailable} missing model inputs.
            </p>
            <p>
              {coverage.unpriced} without a recorded line ·{" "}
              {coverage.historical} historical estimates · {coverage.noLean}{" "}
              without a model lean.
            </p>
            <AvailabilityHelp />
          </details>
        )}
        <details>
          <summary>How records and exclusions work</summary>
          <p>
            Games appear once the first-half result is final. Only original
            eligible pregame picks enter the win/loss record. Later versions
            remain in All saved versions. Results use the original saved line;
            later movement does not change the official grade.
          </p>
        </details>
        <details>
          <summary>Source data and downloads</summary>
          <p>
            The permanent archives retain every forecast, including upcoming
            games and pending picks. Downloads below include those complete
            archives.
          </p>
          <div className="prediction-actions">
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/actual-units.csv`}
              download="1h-actual-units.csv"
            >
              All Actual unit plays CSV ↓
            </a>
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/prediction-record.xlsx`}
              download="1h-prediction-record.xlsx"
            >
              Running record Excel ↓
            </a>
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/prediction-record.csv`}
              download="1h-prediction-record.csv"
            >
              All versions CSV ↓
            </a>
            {archive && (
              <>
                <a
                  className="text-button"
                  href={`${import.meta.env.BASE_URL}${archive.jsonPath}`}
                  download
                >
                  Full dated inputs JSON ↓
                </a>
                {archive.gamesCsvPath && (
                  <a
                    className="text-button"
                    href={`${import.meta.env.BASE_URL}${archive.gamesCsvPath}`}
                    download={`1h-all-games-${archive.date}.csv`}
                  >
                    Selected day: all games CSV ↓
                  </a>
                )}
              </>
            )}
          </div>
        </details>
      </div>
      <p className="record-updated">
        Updated <GameTime startsAt={index.updatedAt} />
      </p>
    </section>
  );
}
