import { useEffect, useMemo, useState } from "react";
import {
  type DailyArchive,
  dailyArchiveSchema,
  type LineBasis,
  type PredictionFeed,
  predictionComparison,
  predictionFeedSchema,
  predictionsToCsv,
} from "./model/predictions";

const books: Record<string, string> = {
  betmgm: "BetMGM",
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  bet365: "bet365",
  caesars: "Caesars",
  fanatics: "Fanatics",
  hardrock: "Hard Rock",
  bet_rivers_co: "BetRivers",
};
const format = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);

export default function Predictions() {
  const [feed, setFeed] = useState<PredictionFeed | null>(null);
  const [archive, setArchive] = useState<DailyArchive | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveDate, setArchiveDate] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [book, setBook] = useState("betmgm");
  const [basis, setBasis] = useState<LineBasis>("latest");
  const [coverage, setCoverage] = useState("all");
  const [page, setPage] = useState(0);
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
  const rows = useMemo(
    () =>
      (feed?.predictions ?? []).filter((row) => {
        const matches = `${row.awayTeam} ${row.homeTeam}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
        const available = row.projectedFirstHalfTotal !== null;
        return (
          matches &&
          (coverage === "all" ||
            (coverage === "available" && available) ||
            (coverage === "unavailable" && !available) ||
            (coverage === "completed" && row.actualFirstHalfTotal !== null))
        );
      }),
    [feed, query, coverage],
  );
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
  const selectedArchive =
    archive?.archives.find((row) => row.date === archiveDate) ??
    archive?.archives[0];
  function exportAll() {
    if (!feed) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", predictionsToCsv(feed.predictions, book, basis)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `1h-predictions-${feed.through}-${book}-${basis}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel predictions-panel">
      <div className="section-heading">
        <span className="step">ALL</span>
        <div>
          <h2>Every matchup. Every model total.</h2>
          <p>
            Automatically generated from the same projection function as the
            matchup lab.
          </p>
        </div>
      </div>
      <div className="prediction-actions">
        <button className="secondary-button" type="button" onClick={exportAll}>
          Download all {feed.counts.matchups} rows · CSV ↓
        </button>
        <a
          className="secondary-button"
          href={`${import.meta.env.BASE_URL}data/predictions.json`}
          target="_blank"
          rel="noreferrer"
        >
          JSON feed ↗
        </a>
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
          <span>Matchups returned</span>
          <strong>{feed.counts.matchups}</strong>
        </div>
        <div>
          <span>Predicted first-half totals</span>
          <strong>{feed.counts.predicted}</strong>
        </div>
        <div>
          <span>Missing inputs / archive</span>
          <strong>{feed.counts.unavailable}</strong>
        </div>
        <div>
          <span>Snapshot date</span>
          <strong className="prediction-date">{feed.through}</strong>
        </div>
      </div>
      <div className="daily-downloads">
        <div>
          <h3>Daily downloads</h3>
          <p>
            Refreshes automatically three times every day. Dated copies remain
            available after the day ends.
          </p>
        </div>
        {selectedArchive && (
          <div className="button-group">
            <label>
              Prediction date
              <select
                value={selectedArchive.date}
                onChange={(event) => setArchiveDate(event.target.value)}
              >
                {archive?.archives.map((row) => (
                  <option key={row.date} value={row.date}>
                    {row.date} · {row.predicted}/{row.matchups} projected
                  </option>
                ))}
              </select>
            </label>
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
          </div>
        )}
        {archiveError && <p className="inline-note">{archiveError}</p>}
      </div>
      <div className="prediction-filters">
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
            onChange={(event) => setBook(event.target.value)}
          >
            {availableBooks.map((name) => (
              <option key={name} value={name}>
                {books[name] ?? name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Compare with</span>
          <select
            value={basis}
            onChange={(event) => setBasis(event.target.value as LineBasis)}
          >
            <option value="latest">Latest displayed line</option>
            <option value="opening">Opening line</option>
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
            <option value="unavailable">Missing inputs</option>
            <option value="completed">Completed first halves</option>
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Matchup / tipoff ET</th>
              <th>Predicted 1H total</th>
              <th>{basis === "latest" ? "Latest line" : "Opening line"}</th>
              <th>Model − line</th>
              <th>Research lean</th>
              <th>Actual 1H</th>
              <th>Input origin / availability</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const comparison = predictionComparison(row, book, basis);
              return (
                <tr key={row.gameId}>
                  <td>
                    <strong>
                      {row.awayTeam} / {row.homeTeam}
                    </strong>
                    <small>
                      {new Date(row.startsAt).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {row.status}
                    </small>
                  </td>
                  <td className="prediction-total">
                    {format(row.projectedFirstHalfTotal)}
                  </td>
                  <td>{format(comparison.line)}</td>
                  <td>
                    {comparison.signedEdge === null
                      ? "—"
                      : `${comparison.signedEdge > 0 ? "+" : ""}${format(comparison.signedEdge)}`}
                  </td>
                  <td>
                    {comparison.lean ??
                      (row.projectedFirstHalfTotal !== null
                        ? "Line unavailable"
                        : "Unavailable")}
                  </td>
                  <td>{row.actualFirstHalfTotal ?? "—"}</td>
                  <td className="availability-cell">
                    {row.unavailableReason ??
                      (row.featureKind === "captured_pregame"
                        ? "Archived before tipoff"
                        : "Reconstructed season debut")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && (
          <div className="empty-state">No matchups match these filters.</div>
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
          The CSV includes every matchup, including rows with unavailable
          projections. The selected sportsbook and line basis apply to the
          export. Model totals do not require an available sportsbook line.
          Positive model-minus-line means OVER; negative means UNDER. These are
          regular-season research leans.
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
