/** biome-ignore-all lint/a11y/useSemanticElements: These native table elements need explicit roles because mobile CSS changes their display. */
/** biome-ignore-all lint/a11y/noRedundantRoles: Explicit roles preserve table semantics when mobile CSS displays rows as cards. */
import { useEffect, useMemo, useState } from "react";
import AvailabilityHelp from "./AvailabilityHelp";
import DailyRecord, { type DailyRecordEvidence } from "./DailyRecord";
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import LineMovement from "./LineMovement";
import type { RecordedLinePick } from "./model/lineMovement";
import {
  marketStatus,
  marketStatusLabel,
  sportsbookNames,
} from "./model/marketCoverage";
import { recordGrade } from "./model/predictionRecord";
import {
  conferenceNames,
  type DailyArchive,
  dailyArchiveSchema,
  filterPredictionGroups,
  type PredictionFeed,
  type PredictionRow,
  predictionComparison,
  predictionFeedSchema,
  predictionsToCsv,
  topEdgePredictions,
} from "./model/predictions";
import { predictionRating } from "./model/ratingDisplay";
import { predictionSignal } from "./model/signals";
import { easternTipoff, tipoffState } from "./model/time";
import { unitsForScore } from "./model/units";
import ResponsiveDetails from "./ResponsiveDetails";
import SignalBadge from "./SignalBadge";
import TeamIdentity from "./TeamIdentity";
import {
  preferenceCoverage,
  preferenceGroup,
  preferenceLineDate,
  preferencePage,
  preferenceSort,
  preferenceSportsbook,
  preferenceText,
  preferenceTiming,
  usePreference,
} from "./usePreference";

const books = sportsbookNames;
const format = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);
const basis = "latest";
function hasUpcomingPick(row: PredictionRow, book: string, now: number) {
  const { lean } = predictionComparison(row, book, basis);
  return (
    tipoffState(row, now) === "upcoming" &&
    row.featureKind === "captured_pregame" &&
    (lean === "OVER" || lean === "UNDER")
  );
}
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

export default function Predictions() {
  const [feed, setFeed] = useState<PredictionFeed | null>(null);
  const [archive, setArchive] = useState<DailyArchive | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [dateChoice, setDateChoice] = usePreference(
    "lines.date",
    preferenceLineDate,
    "today",
  );
  const [timing, setTiming] = usePreference(
    "lines.timing",
    preferenceTiming,
    "all",
  );
  const [error, setError] = useState("");
  const [query, setQuery] = usePreference("lines.search", preferenceText, "");
  const [book, setBook] = usePreference(
    "sportsbook",
    preferenceSportsbook,
    "betmgm",
  );
  const [recordEvidence, setRecordEvidence] =
    useState<DailyRecordEvidence | null>(null);
  const [coverage, setCoverage] = usePreference(
    "lines.coverage",
    preferenceCoverage,
    "all",
  );
  const [group, setGroup] = usePreference(
    "lines.group",
    preferenceGroup,
    "all",
  );
  const [conference, setConference] = usePreference(
    "lines.conference",
    preferenceText,
    "all",
  );
  const [page, setPage] = usePreference("lines.page", preferencePage, 0);
  const [sort, setSort] = usePreference("lines.sort", preferenceSort, "signal");
  const [clock, setClock] = useState(() => Date.now());
  const today = easternTipoff(new Date(clock).toISOString()).date;
  const selectedDate = dateChoice === "today" ? today : dateChoice;
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const loadFeed = () =>
      fetch(`${import.meta.env.BASE_URL}data/predictions.json`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Could not load predictions: HTTP ${response.status}`,
            );
          return predictionFeedSchema.parse(await response.json());
        })
        .then((data) => {
          setFeed(data);
          setError("");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "Predictions could not be loaded.",
            );
        });
    const loadArchive = () =>
      fetch(`${import.meta.env.BASE_URL}data/prediction-archive.json`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              "The daily download archive is temporarily unavailable.",
            );
          return dailyArchiveSchema.parse(await response.json());
        })
        .then((data) => {
          setArchive(data);
          setArchiveError("");
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setArchiveError(
              "Daily archive could not be refreshed. The full CSV export is still available.",
            );
        });
    const refresh = () => {
      void loadFeed();
      void loadArchive();
    };
    refresh();
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);
  const dateRows = useMemo(
    () =>
      (feed?.predictions ?? []).filter(
        (row) => easternTipoff(row.startsAt).date === selectedDate,
      ),
    [feed, selectedDate],
  );
  const matchingRows = useMemo(
    () =>
      filterPredictionGroups(dateRows, conference, group === "top25")
        .filter((row) => {
          const matches = `${row.awayTeam} ${row.homeTeam}`
            .toLowerCase()
            .includes(query.trim().toLowerCase());
          const available = row.projectedFirstHalfTotal !== null;
          const missingLine =
            predictionComparison(row, book, basis).line === null;
          return (
            matches &&
            (coverage === "all" ||
              (coverage === "available" && available) ||
              (coverage === "unavailable" && !available) ||
              (coverage === "completed" && row.actualFirstHalfTotal !== null) ||
              (coverage === "line_missing" && missingLine) ||
              (coverage === "other_books" &&
                missingLine &&
                row.markets.some(
                  (market) =>
                    marketStatus(row, market.sportsbook) === "available",
                )))
          );
        })
        .sort((a, b) => {
          const pickOrder =
            Number(hasUpcomingPick(b, book, clock)) -
            Number(hasUpcomingPick(a, book, clock));
          if (pickOrder) return pickOrder;
          if (sort === "signal") {
            const at = new Date(clock).toISOString();
            const diff =
              (predictionSignal(b, book, basis, at).score ?? -1) -
              (predictionSignal(a, book, basis, at).score ?? -1);
            if (diff) return diff;
          }
          return Date.parse(a.startsAt) - Date.parse(b.startsAt);
        }),
    [dateRows, query, coverage, conference, group, sort, clock, book],
  );
  function rowsForTiming(value: string) {
    const filtered = matchingRows.filter(
      (row) => value === "all" || tipoffState(row, clock) === value,
    );
    return group === "top10"
      ? topEdgePredictions(filtered, book, basis)
      : filtered;
  }
  const rows = rowsForTiming(timing);
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (!feed)
    return <div className="empty-state">Loading all matchup projections…</div>;
  const availableBooks = [
    ...new Set([
      book,
      feed.defaultSportsbook,
      ...feed.predictions.flatMap((row) =>
        row.markets.map((market) => market.sportsbook),
      ),
    ]),
  ].sort();
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const evidence =
    recordEvidence?.date === selectedDate ? recordEvidence : null;
  const recordedPicks = new Map<string, RecordedLinePick>();
  if (evidence?.store) {
    const ids = new Set(evidence.canonicalIds);
    for (const record of evidence.store.records) {
      const side = record.comparison.lean;
      if (
        !ids.has(record.id) ||
        record.gameDate !== selectedDate ||
        record.season !== feed.season ||
        record.modelVersion !== feed.modelVersion ||
        record.sportsbook !== book ||
        record.basis !== basis ||
        record.comparison.line === null ||
        (side !== "OVER" && side !== "UNDER")
      )
        continue;
      const result = recordGrade(record, evidence.store.results);
      recordedPicks.set(record.gameId, {
        line: record.comparison.line,
        side,
        actual: result.actual,
        grade: result.grade,
      });
    }
  }
  const selectedArchive = archive?.archives.find(
    (row) => row.date === selectedDate,
  );
  const dates = [
    ...new Set([
      today,
      selectedDate,
      ...feed.predictions.map((row) => easternTipoff(row.startsAt).date),
      ...(archive?.archives.map((row) => row.date) ?? []),
    ]),
  ]
    .sort()
    .reverse();
  function selectDate(value: string) {
    setDateChoice(value);
    setPage(0);
  }
  function exportCsv(scope: "date" | "filtered" | "all" = "date") {
    if (!feed) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          "\uFEFF",
          predictionsToCsv(
            scope === "filtered"
              ? rows
              : scope === "all"
                ? feed.predictions
                : dateRows,
            book,
            basis,
            new Date(clock).toISOString(),
          ),
        ],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `1h-predictions-${scope === "all" ? "all-dates" : selectedDate}-${scope === "filtered" ? `${timing}-${group}-${conference.replace(/\W+/g, "-")}` : "all"}-${book}-${basis}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel predictions-panel">
      <div className="section-heading">
        <span className="step">1H</span>
        <div>
          <h2>First-half lines & predictions</h2>
          <p>
            Daily first-half projections, current sportsbook totals, and
            research leans.
          </p>
        </div>
      </div>
      <div className="game-day-panel">
        <div>
          <span className="game-day-eyebrow">Game date · Eastern Time</span>
          <h3>
            {selectedDate === today ? "Today’s 1H lines" : "Archived 1H lines"}
          </h3>
          <p>
            {dateLabel(selectedDate)} · {dateRows.length} games
          </p>
        </div>
        <div className="game-date-controls">
          <button
            type="button"
            className="secondary-button"
            onClick={() => selectDate("today")}
          >
            Today
          </button>
          <label>
            Game date (ET)
            <select
              value={dateChoice}
              onChange={(event) => selectDate(event.target.value)}
            >
              <option value="today">{today}</option>
              {dates
                .filter((date) => date !== today)
                .map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
      <div className="board-toolbar">
        <div
          className="prediction-groups"
          role="tablist"
          aria-label="Game groups"
        >
          {[
            ["all", "All games"],
            ["top25", "Top 25"],
            ["top10", "Top 10 edges"],
            ["conference", "Conferences"],
          ].map(([value, label]) => (
            <button
              type="button"
              role="tab"
              id={`prediction-group-${value}`}
              aria-controls="prediction-results"
              aria-selected={group === value}
              key={value}
              className={group === value ? "active" : ""}
              title={
                value === "top10"
                  ? "The 10 largest absolute model-to-line edges for your selected sportsbook and filters, including signals flagged for review."
                  : undefined
              }
              onClick={() => {
                setGroup(value);
                if (value === "all") setConference("all");
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <fieldset className="tipoff-filters" aria-label="Tipoff filter">
          {[
            ["all", "All games"],
            ["upcoming", "Not tipped off"],
            ["started", "Tipped off"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={timing === value}
              onClick={() => {
                setTiming(value);
                setPage(0);
              }}
            >
              {label} <span>{rowsForTiming(value).length}</span>
            </button>
          ))}
        </fieldset>
      </div>

      {selectedDate === today && feed.through < today && (
        <output className="notice">
          Today’s schedule has not been published yet. The last data refresh
          covers {feed.through}; earlier dates are available in Game date (ET).
        </output>
      )}
      <aside
        className="prediction-sidebar"
        aria-label="Daily record and downloads"
      >
        <ResponsiveDetails summary="Daily record">
          <DailyRecord
            date={selectedDate}
            season={feed.season}
            modelVersion={feed.modelVersion}
            sportsbook={feed.defaultSportsbook}
            basis={feed.defaultLineBasis}
            onEvidence={setRecordEvidence}
          />
        </ResponsiveDetails>
        <ResponsiveDetails summary="Downloads, coverage & confidence guide">
          <div className="prediction-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => exportCsv()}
            >
              Download {dateRows.length} games for {selectedDate} · CSV ↓
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => exportCsv("filtered")}
            >
              Download filtered {rows.length} rows · CSV ↓
            </button>
            {selectedArchive?.xlsxPath && (
              <a
                className="secondary-button"
                href={`${import.meta.env.BASE_URL}${selectedArchive.xlsxPath}`}
                download={`1h-predictions-${selectedDate}.xlsx`}
              >
                Excel workbook ↓
              </a>
            )}
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/predictions.json`}
              target="_blank"
              rel="noreferrer"
            >
              All dates JSON feed ↗
            </a>
            <button
              className="text-button"
              type="button"
              onClick={() => exportCsv("all")}
            >
              All dates CSV ↓
            </button>
            <a
              className="text-button"
              href={feed.source.projectionCode}
              target="_blank"
              rel="noreferrer"
            >
              Projection formula ↗
            </a>
            <a
              className="text-button"
              href={feed.source.batchCode}
              target="_blank"
              rel="noreferrer"
            >
              Batch code ↗
            </a>
          </div>
          <div className="audit-metrics">
            <div>
              <span>Games in this view</span>
              <strong>{rows.length}</strong>
            </div>
            <div>
              <span>Predicted first-half totals</span>
              <strong>
                {
                  rows.filter((row) => row.projectedFirstHalfTotal !== null)
                    .length
                }
              </strong>
            </div>
            <div>
              <span>Projection data gaps</span>
              <strong>
                {
                  rows.filter((row) => row.projectedFirstHalfTotal === null)
                    .length
                }
              </strong>
            </div>
            <div>
              <span>Posted {books[book] ?? book} 1H lines</span>
              <strong>
                {
                  rows.filter(
                    (row) =>
                      predictionComparison(row, book, basis).line !== null,
                  ).length
                }{" "}
                / {rows.length}
              </strong>
            </div>
          </div>
          <AvailabilityHelp />
          <p className="tipoff-explanation">
            Tipoff filters use the scheduled start and latest reported status,
            and update every minute. Delayed games stay under Not tipped off;
            postponed and canceled games appear under All games.
          </p>
          <p className="line-movement-legend">
            Current lines are shown.{" "}
            <span className="movement-up-text">Green +</span> means the total
            rose from the opener;{" "}
            <span className="movement-down-text">red −</span> means it fell.
            Hover, focus, or tap the small movement badge for the model and
            recorded-pick impact.
          </p>
          <div className="signal-legend">
            <strong>Confidence score (%)</strong>
            <p>
              Confidence expresses the existing 0–100 model-strength score as a
              percentage. It is not a win probability. Scoring/pace agreement
              strengthens the score; 8+ point gaps are held for outlier review.
              Extreme gaps show Review. After tipoff, the shown-line score uses
              the displayed projection and line; it is labeled separately from a
              saved pregame score. Older record scores calculated from frozen
              inputs are labeled Calculated later. Missing inputs are identified
              explicitly.
            </p>
          </div>
          <div className="daily-downloads">
            <div>
              <h3>Downloads for {dateLabel(selectedDate)}</h3>
              <p>
                Line checks target about one hour before tipoff, with follow-up
                checks closer to the game. The movement tooltip shows the actual
                source capture time. Dated copies update after successful checks
                and remain available afterward. Use the filtered CSV for the
                current tipoff and conference filters.
              </p>
            </div>
            {selectedArchive && (
              <div className="button-group">
                <a
                  className="secondary-button"
                  href={`${import.meta.env.BASE_URL}${selectedArchive.csvPath}`}
                  download={`1h-predictions-${selectedArchive.date}.csv`}
                >
                  Daily CSV ↓
                </a>
                <a
                  className="secondary-button"
                  href={`${import.meta.env.BASE_URL}${selectedArchive.jsonPath}`}
                  download={`1h-predictions-${selectedArchive.date}.json`}
                >
                  Daily JSON ↓
                </a>
                {selectedArchive.xlsxPath && (
                  <a
                    className="secondary-button"
                    href={`${import.meta.env.BASE_URL}${selectedArchive.xlsxPath}`}
                    download={`1h-predictions-${selectedArchive.date}.xlsx`}
                  >
                    Daily Excel ↓
                  </a>
                )}
                {selectedArchive.teamXlsxPath && (
                  <a
                    className="secondary-button"
                    href={`${import.meta.env.BASE_URL}${selectedArchive.teamXlsxPath}`}
                    download={`1h-team-comparison-${selectedArchive.date}.xlsx`}
                  >
                    Daily team review Excel ↓
                  </a>
                )}
              </div>
            )}
            {!selectedArchive && (
              <p>No dated downloads are available for {selectedDate} yet.</p>
            )}
            {archiveError && <p className="inline-note">{archiveError}</p>}
          </div>
        </ResponsiveDetails>
      </aside>
      <ResponsiveDetails summary="Filters & search" initiallyCollapsed>
        <p className="group-description">
          Top 25 includes either team ranked 1–25 by ESPN at retrieval.
          Conference filters include games involving either team. Select a
          conference while on Top 25 to combine both filters.
        </p>
        <div className="prediction-filters">
          <label>
            <span>Sort games</span>
            <select
              value={group === "top10" ? "edge" : sort}
              disabled={group === "top10"}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(0);
              }}
            >
              {group === "top10" && (
                <option value="edge">Biggest absolute edge</option>
              )}
              <option value="signal">Picks first, then confidence</option>
              <option value="time">Picks first, then tipoff (ET)</option>
            </select>
          </label>
          <label>
            <span>Conference</span>
            <select
              value={conference}
              onChange={(event) => {
                setConference(event.target.value);
                if (group === "all") setGroup("conference");
                setPage(0);
              }}
            >
              <option value="all">All conferences</option>
              {conference !== "all" &&
                !conferenceNames(dateRows).includes(conference) && (
                  <option value={conference}>
                    {conference} · no games on this date
                  </option>
                )}
              {conferenceNames(dateRows).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Search matchups</span>
            <input
              placeholder="Team name…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            <span>Sportsbook</span>
            <select
              value={book}
              onChange={(event) => {
                setBook(event.target.value);
                setPage(0);
              }}
            >
              {availableBooks.map((name) => (
                <option key={name} value={name}>
                  {books[name] ?? name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Projection coverage</span>
            <select
              value={coverage}
              onChange={(event) => {
                setCoverage(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">All matchups</option>
              <option value="available">With a projection</option>
              <option value="unavailable">Projection data gaps</option>
              <option value="completed">Completed first halves</option>
              <option value="line_missing">Missing selected-book line</option>
              <option value="other_books">
                Missing here; other books have lines
              </option>
            </select>
          </label>
        </div>
      </ResponsiveDetails>

      <p className="results-count" aria-live="polite">
        {rows.length} matchups · {dateLabel(selectedDate)} ·{" "}
        {books[book] ?? book}
        {group === "top10" && (
          <span className="card-expand-hint">
            Largest absolute edges first, using your sportsbook and filters.
            Large edges can still be flagged for review.
          </span>
        )}
        <span className="card-expand-hint">
          Confidence % is a model score, not a win probability. Select a matchup
          for full details.
        </span>
      </p>
      <div
        className="table-wrap card-table-wrap"
        id="prediction-results"
        role="tabpanel"
        aria-labelledby={`prediction-group-${group}`}
      >
        <table
          role="table"
          className="card-table"
          aria-label="Matchup predictions"
        >
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Tipoff (ET)
              </th>
              <th role="columnheader" scope="col" className="matchup-cell">
                Matchup
              </th>
              <th role="columnheader" scope="col">
                Predicted 1H total
              </th>
              <th role="columnheader" scope="col">
                Current 1H line <small>{books[book] ?? book}</small>
              </th>
              <th role="columnheader" scope="col">
                Model − line
              </th>
              <th role="columnheader" scope="col">
                Research lean
              </th>
              <th role="columnheader" scope="col">
                Confidence score
              </th>
              <th role="columnheader" scope="col">
                Actual 1H
              </th>
              <th role="columnheader" scope="col">
                Input origin / availability
              </th>
              <th role="columnheader" scope="col" className="card-toggle-cell">
                Details
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visible.map((row) => {
              const comparison = predictionComparison(row, book, basis);
              const rating = predictionRating(
                row,
                book,
                basis,
                new Date(clock).toISOString(),
              );
              return (
                <GameCardRow
                  key={row.gameId}
                  label={`${row.awayTeam} at ${row.homeTeam}`}
                >
                  <td
                    role="cell"
                    className="card-time"
                    data-label="Tipoff (ET)"
                  >
                    <GameTime startsAt={row.startsAt} />
                    <span
                      className={`tipoff-badge tipoff-${tipoffState(row, clock)}`}
                    >
                      {tipoffState(row, clock) === "started"
                        ? "Tipped off"
                        : tipoffState(row, clock) === "upcoming"
                          ? "Not tipped off"
                          : row.status}
                    </span>
                  </td>
                  <td
                    role="cell"
                    className="matchup-cell card-matchup"
                    data-label="Matchup"
                  >
                    <TeamIdentity
                      name={row.awayTeam}
                      rank={row.awayRank}
                      conference={row.awayConference}
                    />
                    <TeamIdentity
                      name={row.homeTeam}
                      rank={row.homeRank}
                      conference={row.homeConference}
                    />
                    <small className="card-detail">{row.status}</small>
                  </td>
                  <td
                    role="cell"
                    className="prediction-total card-primary"
                    data-label="Predicted 1H"
                  >
                    {format(row.projectedFirstHalfTotal)}
                  </td>
                  <td
                    role="cell"
                    className="sportsbook-line card-primary"
                    data-label={`Current 1H · ${books[book] ?? book}`}
                  >
                    <LineMovement
                      row={row}
                      sportsbook={book}
                      recorded={recordedPicks.get(row.gameId)}
                      recordAvailability={evidence?.status ?? "loading"}
                      at={clock}
                    />
                  </td>
                  <td
                    role="cell"
                    className="card-detail"
                    data-label="Model − line"
                  >
                    {comparison.signedEdge === null
                      ? "—"
                      : `${comparison.signedEdge > 0 ? "+" : ""}${format(comparison.signedEdge)}`}
                  </td>
                  <td
                    role="cell"
                    className="card-lean"
                    data-label="Research lean"
                  >
                    <span
                      className={`lean-badge lean-${comparison.lean?.toLowerCase() ?? "missing"}`}
                    >
                      {comparison.lean ??
                        (row.projectedFirstHalfTotal !== null
                          ? "No line to compare"
                          : "Unrated · data gap")}
                    </span>
                  </td>
                  <td
                    role="cell"
                    className="card-confidence"
                    data-label="Confidence score"
                  >
                    <SignalBadge {...rating} />
                    {rating.source === "live" && (
                      <small className="unit-suggestion">
                        {unitsForScore(rating.signal.score) === null
                          ? "No automatic stake"
                          : `${unitsForScore(rating.signal.score)}u suggested`}
                      </small>
                    )}
                  </td>
                  <td
                    role="cell"
                    className={
                      row.actualFirstHalfTotal === null
                        ? "card-detail"
                        : "card-actual"
                    }
                    data-label="Actual 1H"
                  >
                    {row.actualFirstHalfTotal ?? "—"}
                  </td>
                  <td
                    role="cell"
                    className="availability-cell card-wide card-detail"
                    data-label="Input availability"
                  >
                    {row.projectedFirstHalfTotal === null ? (
                      <>
                        <strong>Projection data gap</strong>
                        <span>
                          {row.unavailableReason ??
                            "No valid pregame team-stat snapshot is available for this game."}
                        </span>
                      </>
                    ) : row.featureKind === "captured_pregame" ? (
                      "Archived before tipoff"
                    ) : (
                      "Historical estimate · reconstructed season debut"
                    )}
                    {comparison.line === null && (
                      <span className="market-gap-reason">
                        {marketStatusLabel(row, book)}.
                        {row.markets.some(
                          (market) =>
                            market.sportsbook !== book &&
                            marketStatus(row, market.sportsbook) ===
                              "available",
                        )
                          ? " Other books have captured lines; change Sportsbook to compare."
                          : " No other current book line is captured."}
                      </span>
                    )}
                  </td>
                </GameCardRow>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <div className="empty-state">
            {dateRows.length
              ? `No ${timing === "started" ? "tipped-off" : timing === "upcoming" ? "not-yet-tipped" : "matching"} games match these filters for ${dateLabel(selectedDate)}. Try another tipoff filter.`
              : `No games are available for ${dateLabel(selectedDate)}. Earlier dates are available in Game date (ET).`}
          </div>
        )}
      </div>
      <div className="prediction-pagination">
        <span>
          Showing {rows.length ? safePage * pageSize + 1 : 0}–
          {Math.min((safePage + 1) * pageSize, rows.length)} of {rows.length}{" "}
          matches
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
      <div className="data-notes">
        <p>
          The date CSV includes every matchup on the selected Eastern date,
          including rows with unavailable projections. The selected sportsbook
          and current line apply to the export. Opening and current lines remain
          in the CSV. Model totals do not require an available sportsbook line.
          Positive model-minus-line means OVER; negative means UNDER. These are
          regular-season research leans. The filtered CSV includes every
          matching row across all pages. Excel workbooks use BetMGM/latest, with
          All Games, Top 25 and conference sheets. Cross-conference games appear
          in both relevant sheets.
        </p>
        <p>
          Generated{" "}
          {new Date(feed.generatedAt).toLocaleString("en-US", {
            timeZone: "America/New_York",
          })}{" "}
          ET. Latest quotes are snapshots and are not verified closing lines.{" "}
          <a
            href={`${feed.source.repository}/blob/${feed.source.revision}/README.md`}
            target="_blank"
            rel="noreferrer"
          >
            Code and pull commands ↗
          </a>
        </p>
      </div>
    </section>
  );
}
