import { useEffect, useState } from "react";
import GameTime from "./GameTime";
import {
  type TeamEvaluation as Report,
  teamEvaluationSchema,
} from "./model/teamEvaluation";
import { preferenceFlag, preferenceText, usePreference } from "./usePreference";

const metrics = {
  firstHalfPoints: ["1H points scored / game", 1],
  firstHalfAllowed: ["1H points allowed / game", 1],
  pace: ["Possessions / full game", 1],
  offensiveEfficiency: ["Offense: points / 100 possessions", 100],
  defensiveEfficiency: ["Defense: points allowed / 100 possessions", 100],
} as const;
const number = (value: number | null, factor = 1) =>
  value === null ? "—" : (value * factor).toFixed(1);
const signed = (value: number | null, factor = 1) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${number(value, factor)}`;

export default function TeamEvaluation() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = usePreference(
    "teams.selected",
    preferenceText,
    "",
  );
  const [query, setQuery] = usePreference("teams.search", preferenceText, "");
  const [conference, setConference] = usePreference(
    "teams.conference",
    preferenceText,
    "all",
  );
  const [top25, setTop25] = usePreference("teams.top25", preferenceFlag, false);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch(`${import.meta.env.BASE_URL}data/team-evaluation.json`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Could not load team comparisons: HTTP ${response.status}`,
            );
          return teamEvaluationSchema.parse(await response.json());
        })
        .then((data) => {
          setReport(data);
          setError("");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : "Team comparisons are unavailable.",
            );
        });
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  if (error)
    return (
      <div className="notice error" role="alert">
        {error}
      </div>
    );
  if (!report)
    return (
      <div className="empty-state">
        Loading offense and defense comparisons…
      </div>
    );
  const conferences = [
    ...new Set(
      report.teams.flatMap((team) =>
        team.conference ? [team.conference] : [],
      ),
    ),
  ].sort();
  const teams = report.teams.filter(
    (team) =>
      team.name.toLowerCase().includes(query.toLowerCase()) &&
      (conference === "all" || team.conference === conference) &&
      (!top25 || team.rank !== null),
  );
  const team = teams.find((row) => row.id === selected) ?? teams[0];
  const games = team
    ? report.games
        .filter((game) => game.awayId === team.id || game.homeId === team.id)
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    : [];
  const base = import.meta.env.BASE_URL;
  return (
    <section className="panel team-evaluation">
      <div className="section-heading">
        <span className="step">TEAM</span>
        <div>
          <h2>Offense, defense, and the season transition</h2>
          <p>
            {report.priorSeason} final through {report.priorAsOf} →{" "}
            {report.currentSeason} through {report.currentAsOf}
          </p>
        </div>
      </div>
      <div className="prediction-actions">
        <a
          className="secondary-button"
          href={`${base}data/team-comparison.xlsx`}
          download="1h-team-comparison.xlsx"
        >
          Team comparison Excel ↓
        </a>
        <a
          className="secondary-button"
          href={`${base}data/team-comparison.csv`}
          download="1h-team-comparison.csv"
        >
          All team inputs CSV ↓
        </a>
        <a
          className="text-button"
          href={`${base}data/team-evaluation.json`}
          target="_blank"
          rel="noreferrer"
        >
          Comparison JSON ↗
        </a>
      </div>
      <p className="group-description">
        Higher offensive efficiency means more scoring per possession. Lower
        defensive efficiency means fewer points conceded. Current-season weight
        grows as a team plays: 1 game = 11%, 8 games = 50%. The prior is
        regressed 35% toward the prior league average.
      </p>
      <div className="audit-metrics">
        <div>
          <span>Teams with current inputs</span>
          <strong>
            {report.teams.filter((row) => row.currentWeight > 0).length} /{" "}
            {report.teams.length}
          </strong>
        </div>
        <div>
          <span>Pregame forecasts graded</span>
          <strong>{report.summary.prospective.sample}</strong>
        </div>
        <div>
          <span>Reconstructed game checks</span>
          <strong>{report.summary.reconstructed.sample}</strong>
        </div>
        <div>
          <span>Completed games without a grade</span>
          <strong>{report.summary.ungradedCompleted}</strong>
        </div>
      </div>
      <h3>Season-wide combined-total comparison</h3>
      <div className="table-wrap">
        <table aria-label="Season total accuracy">
          <thead>
            <tr>
              <th>Prediction origin</th>
              <th>Games checked</th>
              <th>Prior baseline MAE</th>
              <th>Blended model MAE</th>
              <th>Model bias</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Pregame forecasts", report.summary.prospective],
                ["Reconstructed game checks", report.summary.reconstructed],
              ] as const
            ).map(([label, cohort]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{cohort.sample}</td>
                <td>{number(cohort.priorMae)}</td>
                <td>{number(cohort.modelMae)}</td>
                <td>{signed(cohort.bias)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="inline-note">
        Only games with an actual first-half result and eligible archived inputs
        are graded. Lower MAE means a smaller point error. The cohorts stay
        separate; a reconstructed check is not a pregame forecast.
      </p>
      <div className="evaluation-filters">
        <label>
          Find a team
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teams…"
          />
        </label>
        <label>
          Team conference
          <select
            value={conference}
            onChange={(event) => setConference(event.target.value)}
          >
            <option value="all">All conferences</option>
            {conference !== "all" && !conferences.includes(conference) && (
              <option value={conference}>
                {conference} · unavailable in this snapshot
              </option>
            )}
            {conferences.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Compare team
          <select
            value={team?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {teams.map((row) => (
              <option value={row.id} key={row.id}>
                {row.rank ? `#${row.rank} ` : ""}
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="evaluation-ranked">
          <input
            type="checkbox"
            checked={top25}
            onChange={(event) => setTop25(event.target.checked)}
          />{" "}
          Top 25 teams only
        </label>
      </div>
      {!team ? (
        <div className="empty-state">No teams match these filters.</div>
      ) : (
        <>
          <h3>
            {team.rank ? `#${team.rank} ` : ""}
            {team.name} · {team.conference ?? "Conference unavailable"}
          </h3>
          <p className="inline-note">
            {team.priorGames} prior-season games · {team.currentGames}{" "}
            current-season games in the stat snapshot ·{" "}
            {Math.round(team.currentWeight * 100)}% current-season weight.
            Latest inputs below are descriptive; game checks use the archived
            inputs available for each game.
          </p>
          <div className="table-wrap">
            <table aria-label="Team offense and defense comparison">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>{report.priorSeason} final</th>
                  <th>{report.currentSeason} observed</th>
                  <th>Season change</th>
                  <th>Blended model input</th>
                </tr>
              </thead>
              <tbody>
                {team.metrics.map((metric) => {
                  const [label, factor] = metrics[metric.key];
                  return (
                    <tr key={metric.key}>
                      <th scope="row">{label}</th>
                      <td>{number(metric.prior, factor)}</td>
                      <td>{number(metric.current, factor)}</td>
                      <td>{signed(metric.change, factor)}</td>
                      <td>
                        {metric.key === "firstHalfAllowed"
                          ? "Context statistic"
                          : number(metric.blended, factor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="inline-note">
            First-half points allowed is a new comparison statistic. The
            existing formula uses defensive efficiency for opponent adjustment;
            it does not yet use first-half points allowed as a separate
            coefficient. Missing observations stay blank. Roster turnover,
            injuries, home advantage and travel are not automatically adjusted.
          </p>
          <h3>How the estimates matched {team.name}'s results</h3>
          <p className="inline-note">
            Errors are in first-half points; lower mean absolute error (MAE) is
            better. Offense checks the team's scoring. Defense checks the
            opponent's scoring. Prior baseline and blended model use the same
            games. Small samples describe results and do not establish accuracy.
          </p>
          <div className="table-wrap">
            <table aria-label="Team prediction accuracy">
              <thead>
                <tr>
                  <th>Prediction origin</th>
                  <th>Games checked</th>
                  <th>Prior offense MAE</th>
                  <th>Model offense MAE</th>
                  <th>Prior defense MAE</th>
                  <th>Model defense MAE</th>
                  <th>Scoring bias*</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Captured before tipoff", team.prospective],
                    ["Reconstructed season debuts", team.reconstructed],
                  ] as const
                ).map(([label, cohort]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{cohort.sample}</td>
                    <td>{number(cohort.priorMae)}</td>
                    <td>{number(cohort.modelMae)}</td>
                    <td>{number(cohort.priorDefenseMae)}</td>
                    <td>{number(cohort.defenseMae)}</td>
                    <td>{signed(cohort.bias)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="inline-note">
            *Positive bias means the model overestimated scoring. Reconstructed
            estimates were calculated after the game with prior-season inputs
            and are not forecasts recorded before tipoff.
          </p>
          <h3>Game checks</h3>
          <div className="table-wrap">
            <table aria-label="Team game checks">
              <thead>
                <tr>
                  <th>Tipoff (ET)</th>
                  <th className="matchup-cell">Opponent</th>
                  <th>Model for / allowed</th>
                  <th>Actual for / allowed</th>
                  <th>Prior total</th>
                  <th>Blended total</th>
                  <th>Change</th>
                  <th>Total error*</th>
                  <th>Origin</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const away = game.awayId === team.id;
                  return (
                    <tr key={game.gameId}>
                      <td>
                        <GameTime startsAt={game.startsAt} />
                      </td>
                      <td className="matchup-cell">
                        <strong>
                          {away ? "at" : "vs"}{" "}
                          {away ? game.homeTeam : game.awayTeam}
                        </strong>
                      </td>
                      <td>
                        {number(away ? game.awayProjected : game.homeProjected)}{" "}
                        /{" "}
                        {number(away ? game.homeProjected : game.awayProjected)}
                      </td>
                      <td>
                        {number(away ? game.awayActual : game.homeActual)} /{" "}
                        {number(away ? game.homeActual : game.awayActual)}
                      </td>
                      <td>{number(game.priorTotal)}</td>
                      <td>{number(game.modelTotal)}</td>
                      <td>{signed(game.shift)}</td>
                      <td>{signed(game.error)}</td>
                      <td>
                        {game.kind === "captured_pregame"
                          ? "Captured before tipoff"
                          : game.kind === "reconstructed_season_debut"
                            ? "Reconstructed debut"
                            : "No eligible inputs"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!games.length && (
              <div className="empty-state">
                No imported matchups for this team yet.
              </div>
            )}
          </div>
        </>
      )}
      <div className="data-notes">
        <p>
          The prior baseline uses the completed {report.priorSeason} season,
          league regression, and zero current-season weight. The blended
          projection adds eligible current-season inputs captured for that
          matchup. This measures how the prior carries into{" "}
          {report.currentSeason}; previous-season prediction archives have not
          been recovered, so a historical season backtest is not shown.
        </p>
        <p>
          *Total error = blended prediction minus actual combined first-half
          points. No sportsbook line is required to grade scoring.{" "}
          {report.summary.ungradedCompleted} completed games have no comparable
          prediction and are excluded from accuracy totals.
        </p>
        <div className="button-group">
          <a
            href={report.source.prior.offensiveEfficiency}
            target="_blank"
            rel="noreferrer"
          >
            Prior offense source ↗
          </a>
          <a
            href={report.source.current.defensiveEfficiency}
            target="_blank"
            rel="noreferrer"
          >
            Current defense source ↗
          </a>
          <a
            href={report.source.current.firstHalfAllowed}
            target="_blank"
            rel="noreferrer"
          >
            1H points allowed source ↗
          </a>
        </div>
      </div>
    </section>
  );
}
