import { useEffect, useState } from "react";
import GameTime from "./GameTime";
import {
  type RecordIndex,
  type RecordStore,
  recordGrade,
  recordIndexSchema,
  recordStoreSchema,
} from "./model/predictionRecord";
import SignalBadge from "./SignalBadge";

const point = (n: number | null) => (n === null ? "—" : n.toFixed(2));
const rate = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;

export default function PredictionRecord() {
  const [index, setIndex] = useState<RecordIndex | null>(null);
  const [store, setStore] = useState<RecordStore | null>(null);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [group, setGroup] = useState("");
  const [view, setView] = useState("official");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch(`${import.meta.env.BASE_URL}data/prediction-record-index.json`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok)
            throw new Error("The prediction record could not be loaded.");
          return recordIndexSchema.parse(await r.json());
        })
        .then((data) => {
          setIndex(data);
          setError("");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error ? reason.message : "Record unavailable.",
            );
        });
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  const archive =
    index?.archives.find((a) => a.date === date) ?? index?.archives[0];
  useEffect(() => {
    if (!archive) return;
    const controller = new AbortController();
    setStore(null);
    fetch(`${import.meta.env.BASE_URL}${archive.jsonPath}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error("The dated prediction record could not be loaded.");
        return recordStoreSchema.parse(await r.json());
      })
      .then((data) => {
        setStore(data);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Record unavailable.",
          );
      });
    return () => controller.abort();
  }, [archive]);
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (!index)
    return (
      <div className="empty-state">Loading the shared prediction record…</div>
    );
  const summary =
    index.summary.find(
      (s) =>
        `${s.season}:${s.modelVersion}:${s.sportsbook}:${s.basis}` === group,
    ) ?? index.summary[index.summary.length - 1];
  const ids = new Set(index.canonicalIds);
  const rows = (store?.records ?? [])
    .filter(
      (r) =>
        (!summary ||
          (r.season === summary.season &&
            r.modelVersion === summary.modelVersion &&
            r.sportsbook === summary.sportsbook &&
            r.basis === summary.basis)) &&
        `${r.prediction.awayTeam} ${r.prediction.homeTeam}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (view === "all" ||
          (view === "official" && ids.has(r.id)) ||
          (view === "settled" &&
            ids.has(r.id) &&
            ["Win", "Loss", "Push"].includes(
              recordGrade(r, store?.results ?? []).grade,
            ))),
    )
    .sort(
      (a, b) =>
        b.recordedAt.localeCompare(a.recordedAt) || b.version - a.version,
    );
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * 25, (safePage + 1) * 25);
  return (
    <section className="panel prediction-record-panel">
      <div className="section-heading">
        <span className="step">LOG</span>
        <div>
          <h2>Running prediction record</h2>
          <p>
            Original predictions, original lines, every saved version, and
            first-half results.
          </p>
        </div>
      </div>
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
        {archive && (
          <a
            className="secondary-button"
            href={`${import.meta.env.BASE_URL}${archive.jsonPath}`}
            download
          >
            Full dated inputs JSON ↓
          </a>
        )}
      </div>
      {summary && (
        <>
          <p className="group-description">
            Season record: {summary.season} · {summary.modelVersion} ·{" "}
            {summary.sportsbook}/{summary.basis} at recording. Each game's first
            eligible pregame forecast counts once. Pushes are excluded from win
            rate. Later versions and historical estimates remain available in
            All saved versions.
          </p>
          <div className="audit-metrics">
            <div>
              <span>Wins / losses / pushes</span>
              <strong>
                {summary.wins} / {summary.losses} / {summary.pushes}
              </strong>
            </div>
            <div>
              <span>Pending pregame forecasts</span>
              <strong>{summary.pending}</strong>
            </div>
            <div>
              <span>Observed win rate</span>
              <strong>{rate(summary.winRate)}</strong>
            </div>
            <div>
              <span>Saved games / versions</span>
              <strong>
                {summary.games} / {summary.versions}
              </strong>
            </div>
          </div>
          <h3>Results by frozen model signal</h3>
          <p className="inline-note">
            Darker green means a stronger research signal. These are observed
            results by score band, not a calibrated probability for the next
            game.
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
                {summary.bands.map((b) => (
                  <tr key={b.label}>
                    <th scope="row">{b.label}</th>
                    <td>{b.wins}</td>
                    <td>{b.losses}</td>
                    <td>{b.pushes}</td>
                    <td>{b.pending}</td>
                    <td>{rate(b.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="record-filters">
        <label>
          Record season / model
          <select
            value={
              summary
                ? `${summary.season}:${summary.modelVersion}:${summary.sportsbook}:${summary.basis}`
                : ""
            }
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(0);
            }}
          >
            {index.summary.map((s) => (
              <option
                key={`${s.season}:${s.modelVersion}:${s.sportsbook}:${s.basis}`}
                value={`${s.season}:${s.modelVersion}:${s.sportsbook}:${s.basis}`}
              >
                {s.season} · {s.modelVersion} · {s.sportsbook}/{s.basis}
              </option>
            ))}
          </select>
        </label>
        <label>
          Game date (ET)
          <select
            value={archive?.date ?? ""}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(0);
            }}
          >
            {index.archives.map((a) => (
              <option value={a.date} key={a.date}>
                {a.date} · {a.versions} versions
              </option>
            ))}
          </select>
        </label>
        <label>
          Record view
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setPage(0);
            }}
          >
            <option value="official">Official pregame forecasts</option>
            <option value="all">All saved versions</option>
            <option value="settled">Official settled results</option>
          </select>
        </label>
        <label>
          Search recorded matchups
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      {!store ? (
        <div className="empty-state">Loading this date's records…</div>
      ) : (
        <div className="table-wrap">
          <table aria-label="Recorded predictions">
            <thead>
              <tr>
                <th>Tipoff (ET)</th>
                <th className="matchup-cell">Matchup / recorded ET</th>
                <th>Frozen model</th>
                <th>Frozen line</th>
                <th>Lean</th>
                <th>Frozen signal</th>
                <th>Actual 1H</th>
                <th>Result</th>
                <th>Record version</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const grade = recordGrade(r, store.results);
                return (
                  <tr
                    key={r.id}
                    style={{ backgroundColor: r.signal.fill ?? undefined }}
                  >
                    <td>
                      <GameTime startsAt={r.prediction.startsAt} />
                    </td>
                    <td className="matchup-cell">
                      <strong>
                        {r.prediction.awayTeam} / {r.prediction.homeTeam}
                      </strong>
                      <small>
                        <GameTime startsAt={r.recordedAt} />
                      </small>
                    </td>
                    <td>{point(r.prediction.projectedFirstHalfTotal)}</td>
                    <td>{point(r.comparison.line)}</td>
                    <td>{r.comparison.lean ?? "—"}</td>
                    <td>
                      <SignalBadge signal={r.signal} />
                    </td>
                    <td>{grade.actual ?? "—"}</td>
                    <td>
                      <span
                        className={`record-grade grade-${grade.grade.toLowerCase().replaceAll(" ", "-")}`}
                      >
                        {grade.grade}
                      </span>
                    </td>
                    <td>
                      v{r.version}
                      <small>
                        {ids.has(r.id)
                          ? "Counted once"
                          : r.state === "pregame"
                            ? "Later / unpriced version"
                            : "Excluded from win rate"}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && (
            <div className="empty-state">
              No recorded forecasts match these filters.
            </div>
          )}
        </div>
      )}
      <div className="prediction-pagination">
        <span>{rows.length} saved versions in this view</span>
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
          Prediction versions are append-only. A line, price, projection, or
          input change before tipoff creates another version. Post-tipoff
          updates cannot replace the frozen forecast. Result corrections append
          a separate event, so earlier observations remain recoverable. JSON
          includes frozen team inputs, all captured sportsbook quotes,
          timestamps, and source code revisions.
        </p>
        <p>
          The record is committed to GitHub after successful validation and
          remains available across devices. Missing predictions and post-tipoff
          imports are saved and excluded from headline results. Grade = original
          lean versus the original recorded line. No profit estimate is made
          without using the recorded prices.
        </p>
        <p>
          Updated <GameTime startsAt={index.updatedAt} />
        </p>
      </div>
    </section>
  );
}
