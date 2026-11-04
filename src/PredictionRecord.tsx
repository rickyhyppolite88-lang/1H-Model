import { useEffect, useRef, useState } from "react";
import AvailabilityHelp from "./AvailabilityHelp";
import { DailyRecordSummary } from "./DailyRecord";
import GameTime from "./GameTime";
import { dailyRecordCoverage, dailyRecordGames } from "./model/dailyRecord";
import { dailyRecordedResults } from "./model/dailyResults";
import {
  type RecordIndex,
  type RecordStore,
  recordForDate,
  recordGrade,
  recordIndexSchema,
  recordStoreSchema,
} from "./model/predictionRecord";
import { mergeRecordStores } from "./model/recordViews";
import { easternTipoff } from "./model/time";
import RecordTable from "./RecordTable";

const rate = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const summaryKey = (s: RecordIndex["summary"][number]) =>
  `${s.season}:${s.modelVersion}:${s.sportsbook}:${s.basis}`;

export default function PredictionRecord() {
  const [index, setIndex] = useState<RecordIndex | null>(null);
  const [indexError, setIndexError] = useState("");
  const [scope, setScope] = useState<"full" | "day">("full");
  const [date, setDate] = useState("");
  const [group, setGroup] = useState("");
  const [view, setView] = useState("games");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
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
  const archive =
    index?.archives.find((a) => a.date === date) ??
    index?.archives.find(
      (a) => a.date === easternTipoff(new Date().toISOString()).date,
    ) ??
    index?.archives[0];
  const loadKey = `${index?.updatedAt ?? ""}:${scope}:${scope === "full" ? "all" : (archive?.date ?? "none")}:${retry}`;
  useEffect(() => {
    if (!index) return;
    const controller = new AbortController();
    const archives =
      scope === "full" ? index.archives : archive ? [archive] : [];
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
              scope === "full"
                ? "The full record could not load all dates. No partial history is shown."
                : "The selected day’s record could not be loaded.",
          });
      }
    };
    void load();
    return () => controller.abort();
  }, [index, scope, archive, loadKey]);

  if (!index)
    return indexError ? (
      <div className="notice error" role="alert">
        {indexError}
      </div>
    ) : (
      <div className="empty-state">Loading the shared prediction record…</div>
    );
  const summary =
    index.summary.find((s) => summaryKey(s) === group) ??
    index.summary[index.summary.length - 1];
  const current = loaded?.key === loadKey ? loaded : null;
  const store = current?.store ?? null;
  const ids = new Set(index.canonicalIds);
  const scoped = (store?.records ?? []).filter(
    (r) =>
      (!summary ||
        (r.season === summary.season &&
          r.modelVersion === summary.modelVersion &&
          r.sportsbook === summary.sportsbook &&
          r.basis === summary.basis)) &&
      (scope === "full" || r.gameDate === archive?.date),
  );
  const scopedStore = store ? { ...store, records: scoped } : null;
  const savedDates = new Set(scoped.map((record) => record.gameDate));
  const recentDays =
    scope === "full" && scopedStore
      ? index.archives
          .filter((day) => savedDates.has(day.date))
          .slice(0, 8)
          .map((day) => ({
            date: day.date,
            ...dailyRecordedResults(
              recordForDate(scopedStore, day.date),
              index.canonicalIds,
              day.date,
            ),
          }))
      : [];
  const coverage = scopedStore
    ? dailyRecordCoverage(scopedStore, index.canonicalIds)
    : null;
  const selected =
    view === "games" ? dailyRecordGames(scoped, index.canonicalIds) : scoped;
  const rows = selected
    .filter(
      (r) =>
        `${r.prediction.awayTeam} ${r.prediction.homeTeam}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (view === "games" ||
          view === "all" ||
          (view === "official" && ids.has(r.id)) ||
          (view === "settled" &&
            ids.has(r.id) &&
            ["Win", "Loss", "Push"].includes(
              recordGrade(r, store?.results ?? []).grade,
            ))),
    )
    .sort((a, b) =>
      view === "games"
        ? b.gameDate.localeCompare(a.gameDate) ||
          a.prediction.startsAt.localeCompare(b.prediction.startsAt)
        : b.recordedAt.localeCompare(a.recordedAt) || b.version - a.version,
    );
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * 25, (safePage + 1) * 25);
  const dayIndex = index.archives.findIndex((a) => a.date === archive?.date);
  function resetFilters() {
    setView("games");
    setQuery("");
    setPage(0);
  }
  function openDay(value: string) {
    setDate(value);
    setScope("day");
    resetFilters();
  }
  function changeScope(value: "full" | "day") {
    setScope(value);
    resetFilters();
  }
  return (
    <section className="panel prediction-record-panel">
      <div className="section-heading">
        <span className="step">LOG</span>
        <div>
          <h2>Running prediction record</h2>
          <p>
            Start with the full history, then open a day to review its saved
            picks and results.
          </p>
        </div>
      </div>
      <div
        className="record-scope-switch"
        role="tablist"
        aria-label="Record scope"
      >
        {[
          ["full", "Full record"],
          ["day", "By day"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`record-scope-${value}`}
            aria-controls="record-scope-panel"
            aria-selected={scope === value}
            onClick={() => changeScope(value as "full" | "day")}
          >
            {label}
          </button>
        ))}
      </div>
      {summary && (
        <p className="record-benchmark">
          {summary.season} · {summary.modelVersion} ·{" "}
          {summary.sportsbook === "betmgm" ? "BetMGM" : summary.sportsbook}/
          {summary.basis} at recording
        </p>
      )}
      {index.summary.length > 1 && (
        <label className="record-model-control">
          Record season / model
          <select
            value={summary ? summaryKey(summary) : ""}
            onChange={(e) => {
              setGroup(e.target.value);
              resetFilters();
            }}
          >
            {index.summary.map((s) => (
              <option key={summaryKey(s)} value={summaryKey(s)}>
                {s.season} · {s.modelVersion} · {s.sportsbook}/{s.basis}
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
      <div
        id="record-scope-panel"
        role="tabpanel"
        aria-labelledby={`record-scope-${scope}`}
      >
        {scope === "full" ? (
          <>
            {summary && (
              <section
                className="record-overview"
                aria-label="Full record summary"
              >
                <h3>Full prediction record</h3>
                <p>
                  All saved dates · each game’s first eligible pregame pick
                  counts once.
                </p>
                <div className="audit-metrics">
                  <div>
                    <span>Wins / losses / pushes</span>
                    <strong>
                      {summary.wins} / {summary.losses} / {summary.pushes}
                    </strong>
                  </div>
                  <div>
                    <span>Pending picks</span>
                    <strong>{summary.pending}</strong>
                  </div>
                  <div>
                    <span>Observed win rate</span>
                    <strong>{rate(summary.winRate)}</strong>
                  </div>
                  <div>
                    <span>Counted pregame picks</span>
                    <strong>{summary.pregame}</strong>
                  </div>
                </div>
                <p className="inline-note">
                  {summary.games} saved games · {summary.versions} prediction
                  versions. Pushes are excluded from win rate.
                </p>
              </section>
            )}
            <div className="prediction-actions">
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
            </div>
            {scopedStore && (
              <section
                className="record-day-breakdown"
                aria-label="Daily breakdown"
              >
                <h3>Daily breakdown</h3>
                <p>
                  Choose a date to see only that day’s record and predictions.
                </p>
                <div className="record-day-grid">
                  {recentDays.map((result) => {
                    return (
                      <button
                        className="record-day-card"
                        key={result.date}
                        type="button"
                        aria-label={`View record for ${result.date}`}
                        onClick={() => openDay(result.date)}
                      >
                        <span className="record-day-card-date">
                          {result.date} · ET <span>View day →</span>
                        </span>
                        <strong>
                          {result.wins} W · {result.losses} L · {result.pushes}{" "}
                          P
                        </strong>
                        <span>
                          {result.pending} pending · {rate(result.winRate)}{" "}
                          observed win rate
                        </span>
                        <small>
                          {result.games} games saved · {result.counted} counted
                          picks
                        </small>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <div className="record-day-controls">
              <button
                className="text-button"
                type="button"
                onClick={() => changeScope("full")}
              >
                ← Back to full record
              </button>
              <label>
                Game date (ET)
                <select
                  value={archive?.date ?? ""}
                  disabled={!index.archives.length}
                  onChange={(e) => openDay(e.target.value)}
                >
                  {index.archives.map((a) => (
                    <option key={a.date} value={a.date}>
                      {a.date} · {a.games} games
                    </option>
                  ))}
                </select>
              </label>
              <div className="button-group">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    dayIndex < 0 || dayIndex >= index.archives.length - 1
                  }
                  onClick={() => openDay(index.archives[dayIndex + 1].date)}
                >
                  Previous day
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={dayIndex <= 0}
                  onClick={() => openDay(index.archives[dayIndex - 1].date)}
                >
                  Next day
                </button>
              </div>
              {savedDates.size > 8 && (
                <p className="inline-note">
                  Showing the 8 most recent dates. Use By day to browse every
                  saved date.
                </p>
              )}
            </div>
            {scopedStore && archive && (
              <DailyRecordSummary
                date={archive.date}
                store={scopedStore}
                canonicalIds={index.canonicalIds}
                sportsbook={summary?.sportsbook ?? "betmgm"}
                basis={summary?.basis ?? "latest"}
                gamesCsvPath={archive.gamesCsvPath}
              />
            )}
            {!archive && (
              <p className="empty-state">
                No saved record dates are available yet.
              </p>
            )}
          </>
        )}
        <div className="record-history-heading">
          <h3>
            {scope === "full"
              ? "Full prediction history"
              : `Predictions for ${archive?.date ?? "selected day"}`}
          </h3>
          <span>
            {scope === "full" ? "All saved dates" : "Selected day only"}
          </span>
        </div>
        <div className="record-history-filters">
          <label>
            Record view
            <select
              value={view}
              onChange={(e) => {
                setView(e.target.value);
                setPage(0);
              }}
            >
              <option value="games">All games · one row per matchup</option>
              <option value="official">Official pregame forecasts</option>
              <option value="all">All saved versions</option>
              <option value="settled">Official settled results</option>
            </select>
          </label>
          <label>
            Search recorded matchups
            <input
              value={query}
              placeholder="Team name…"
              onChange={(e) => {
                setQuery(e.target.value);
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
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry loading records
            </button>
          </div>
        ) : !store ? (
          <div className="empty-state">
            {scope === "full"
              ? "Loading all recorded dates…"
              : "Loading this date’s records…"}
          </div>
        ) : (
          <>
            <RecordTable
              records={visible}
              results={store.results}
              canonicalIds={index.canonicalIds}
              showVersions={view === "all"}
              onOpenDay={scope === "full" ? openDay : undefined}
            />
            <div className="prediction-pagination">
              <span>
                {rows.length}{" "}
                {view === "games"
                  ? "games"
                  : view === "all"
                    ? "saved versions"
                    : "official picks"}{" "}
                in this view · {scope === "full" ? "all dates" : archive?.date}
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
          {scope === "day" && coverage && (
            <details>
              <summary>Coverage & data gaps for {archive?.date}</summary>
              <p>
                {coverage.games} games saved · {coverage.projected} with
                projections · {coverage.unavailable} missing model inputs ·{" "}
                {coverage.withResults} first-half results available.
              </p>
              <p>
                {coverage.counted} counted pregame · {coverage.unpriced} without
                a recorded line · {coverage.historical} historical estimates ·{" "}
                {coverage.noLean} without a model lean.
              </p>
              <AvailabilityHelp />
            </details>
          )}
          {scope === "full" && summary && (
            <details>
              <summary>Results by frozen model signal</summary>
              <p>
                Observed results by saved score band; these are research
                rankings.
              </p>
              <div className="table-wrap">
                <table aria-label="Signal results">
                  <thead>
                    <tr>
                      <th>Signal score band</th>
                      <th>Wins</th>
                      <th>Losses</th>
                      <th>Pushes</th>
                      <th>Pending</th>
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
                        <td>{band.pending}</td>
                        <td>{rate(band.winRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <details>
            <summary>How records and exclusions work</summary>
            <p>
              Only original eligible pregame picks enter the win/loss record.
              Later versions remain available in All saved versions. Results use
              the original saved line; later movement does not change the
              official grade.
            </p>
            <AvailabilityHelp />
          </details>
          <details>
            <summary>Source data and downloads</summary>
            <p>
              Forecasts and result corrections are saved as separate events.
              Source files retain team inputs, quotes, timestamps, and code
              revisions.
            </p>
            {scope === "day" && archive ? (
              <div className="prediction-actions">
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
              </div>
            ) : (
              <p>
                Use the full Excel or all-versions CSV above, or open a day for
                its source JSON.
              </p>
            )}
          </details>
        </div>
      </div>
      <p className="record-updated">
        Updated <GameTime startsAt={index.updatedAt} />
      </p>
    </section>
  );
}
