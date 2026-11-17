import { useEffect, useState } from "react";
import type { z } from "zod";
import { refereeMetricLabels, refereeReportSchema } from "./model/referees";
import { watchPublishedUpdates } from "./publishedUpdates";

type Report = z.infer<typeof refereeReportSchema>;
export default function RefereeResearch() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/referee-report.json`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Unavailable");
        const data = refereeReportSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setReport(data);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Referee research has not been published or could not be refreshed.",
          );
      }
    };
    void load();
    const stop = watchPublishedUpdates(load);
    return () => {
      controller.abort();
      stop();
    };
  }, [open]);
  const matches = (report?.officials ?? []).filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase().trim()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / 20) - 1),
  );
  const profile = report?.officials.find((r) => r.id === selected);
  const show = (value: number | undefined) =>
    value === undefined ? "—" : value.toFixed(2);
  return (
    <details
      className="referee-research"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Referee research & first-half measurements</summary>
      <p>
        Every verified official in our covered games is included. These are crew
        and games-worked associations; the feed does not identify who made each
        call. Tagged foul types and bonus/FT timing remain explicit proxies.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && open && <p>Loading referee research…</p>}
      {report && (
        <>
          <p>
            {report.officials.length} officials · {report.measurements}{" "}
            reconciled first halves. Model effects use only the earlier
            priced-game sample; descriptive averages can include additional
            covered games.
          </p>
          {report.forecastTest && (
            <p className="inline-note">
              Prospective V4 comparison: {report.forecastTest.games} completed
              matching forecasts, including watch-only observations. Brier score
              (lower is better): V3{" "}
              {show(report.forecastTest.v3Brier ?? undefined)} · V4{" "}
              {show(report.forecastTest.v4Brier ?? undefined)} · market{" "}
              {show(report.forecastTest.marketBrier ?? undefined)}. Older games
              are not reconstructed as pregame forecasts.
            </p>
          )}
          <div className="referee-toolbar">
            <label>
              Search referees
              <input
                value={query}
                placeholder="Official name…"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <a
              className="secondary-button"
              href={`${import.meta.env.BASE_URL}data/referee-research.csv`}
              download="first-half-referee-research.csv"
            >
              Download all referee measurements CSV ↓
            </a>
          </div>
          {profile && (
            <section
              className="referee-profile"
              aria-label={`First-half profile for ${profile.name}`}
            >
              <h3>{profile.name}</h3>
              <p>
                {profile.games} covered first halves · {profile.pricedGames}{" "}
                matched prior priced games · shrunk scoring association{" "}
                {profile.pointsAssociation >= 0 ? "+" : ""}
                {show(profile.pointsAssociation)} points. This is not an
                individual-caller effect.
              </p>
              {profile.forecastTest && (
                <p>
                  {profile.forecastTest.games} prospective V4 games worked ·
                  matched V3 Brier{" "}
                  {show(profile.forecastTest.v3Brier ?? undefined)} · V4 Brier{" "}
                  {show(profile.forecastTest.v4Brier ?? undefined)} · qualified
                  W–L {profile.forecastTest.qualifiedWins}–
                  {profile.forecastTest.qualifiedLosses}. Samples overlap across
                  officials on the same crew.
                </p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>First-half measurement</th>
                      <th>Average</th>
                      <th>Measured games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(refereeMetricLabels).map(([key, label]) => (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>{show(profile.metrics[key]?.mean)}</td>
                        <td>{profile.metrics[key]?.samples ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="table-wrap">
            <table aria-label="Referee first-half study">
              <thead>
                <tr>
                  <th>Official</th>
                  <th>Games</th>
                  <th>1H fouls</th>
                  <th>1H FTA</th>
                  <th>Priced sample</th>
                  <th>Scoring association</th>
                </tr>
              </thead>
              <tbody>
                {matches
                  .slice(currentPage * 20, (currentPage + 1) * 20)
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setSelected(row.id)}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td>{row.games}</td>
                      <td>{show(row.metrics.fouls?.mean)}</td>
                      <td>{show(row.metrics.fta?.mean)}</td>
                      <td>
                        {row.pricedGames}
                        {row.pricedGames < 3 ? " · limited" : ""}
                      </td>
                      <td>{show(row.pointsAssociation)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="prediction-pagination">
            <span>{matches.length} matching officials</span>
            <div className="button-group">
              <button
                type="button"
                className="secondary-button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous refs
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={(currentPage + 1) * 20 >= matches.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next refs
              </button>
            </div>
          </div>
        </>
      )}
    </details>
  );
}
