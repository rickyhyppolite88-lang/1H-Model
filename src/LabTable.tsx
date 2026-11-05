/** biome-ignore-all lint/a11y/useSemanticElements: Mobile cards retain explicit native table roles. */
/** biome-ignore-all lint/a11y/noRedundantRoles: CSS changes mobile table display. */
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import { gradeLab, type LabForecast, type LabStore } from "./model/lab";
import TeamIdentity from "./TeamIdentity";

const point = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);
export default function LabTable({
  rows,
  store,
  bonus,
}: {
  rows: LabForecast[];
  store: LabStore;
  bonus: boolean;
}) {
  return (
    <div className="table-wrap card-table-wrap">
      <table role="table" className="card-table" aria-label="Lab forecasts">
        <thead role="rowgroup">
          <tr role="row">
            {[
              "Tipoff (ET)",
              "Matchup",
              bonus ? "Expected bonus minutes" : "Lab total",
              bonus ? "League bonus baseline" : "Saved 1H line",
              "Research decision",
              bonus ? "Bet forecast" : "Signal strength / 100",
              bonus ? "Actual bonus / 1H total" : "Actual 1H",
              "Lab result",
              "Research details",
              "Details",
            ].map((label) => (
              <th role="columnheader" scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => {
            const result = gradeLab(row, store);
            const status = {
              control: "Control",
              qualified: "Qualified research",
              watch_only: "Watch only",
              data_gap: "Data gap",
              measurement: "Measurement only",
            }[row.status];
            return (
              <GameCardRow
                key={row.id}
                kind="record"
                label={`${row.awayTeam} at ${row.homeTeam}`}
              >
                <td role="cell" className="card-time" data-label="Tipoff (ET)">
                  <GameTime startsAt={row.startsAt} />
                </td>
                <td
                  role="cell"
                  className="matchup-cell card-matchup"
                  data-label="Matchup"
                >
                  <TeamIdentity
                    name={row.awayTeam}
                    rank={null}
                    conference={null}
                  />
                  <TeamIdentity
                    name={row.homeTeam}
                    rank={null}
                    conference={null}
                  />
                </td>
                <td
                  role="cell"
                  className="card-primary"
                  data-label={bonus ? "Bonus min" : "Lab 1H"}
                >
                  {point(bonus ? row.bonusMinutes : row.total)}
                </td>
                <td
                  role="cell"
                  className="card-primary sportsbook-line"
                  data-label={bonus ? "League min" : "Saved BetMGM"}
                >
                  {point(bonus ? row.bonusBaselineMinutes : row.line)}
                </td>
                <td
                  role="cell"
                  className="card-lean"
                  data-label="Research decision"
                >
                  <span
                    className={`lean-badge lean-${row.status === "qualified" || row.status === "control" ? row.side?.toLowerCase() : "missing"}`}
                  >
                    {row.status === "qualified" || row.status === "control"
                      ? (row.side ?? status)
                      : row.status === "watch_only" && row.side
                        ? `${row.side} · watch`
                        : status}
                  </span>
                  <small className="card-detail">{status}</small>
                </td>
                <td
                  role="cell"
                  className="card-confidence"
                  data-label="Strength / 100"
                >
                  <div className="signal-badge">
                    <span className="confidence-label">
                      {bonus ? "Bet forecast" : "Strength / 100"}
                    </span>
                    <strong>
                      {bonus ? "None" : (row.signalStrength ?? "—")}
                    </strong>
                    <small className="card-detail">
                      Uncalibrated strength, not win probability
                    </small>
                  </div>
                </td>
                <td
                  role="cell"
                  className="card-actual"
                  data-label={bonus ? "Actual bonus" : "Actual 1H"}
                >
                  {bonus ? (
                    <>
                      {point(result.actualBonus)} min
                      <small>1H total: {result.actual ?? "—"}</small>
                    </>
                  ) : (
                    (result.actual ?? "—")
                  )}
                </td>
                <td role="cell" className="card-result" data-label="Result">
                  <span
                    className={`record-grade grade-${result.grade.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    {result.grade}
                  </span>
                </td>
                <td
                  role="cell"
                  className="card-wide card-detail lab-forecast-details"
                  data-label="Research details"
                >
                  <p>{row.reason}</p>
                  <p>Research lean: {row.side ?? "No priced lean"}</p>
                  <p>
                    Baseline total: {point(row.baselineTotal)} · Saved line:{" "}
                    {point(row.line)} · Model error: {point(result.error)}
                  </p>
                  {row.status === "watch_only" && result.hypothetical && (
                    <p>
                      Watch-only hypothetical: {result.hypothetical}. Excluded
                      from the qualified record.
                    </p>
                  )}
                  <p>
                    Recorded <GameTime startsAt={row.recordedAt} /> · version{" "}
                    {row.version} · {row.methodId}
                  </p>
                  <details>
                    <summary>Frozen research inputs</summary>
                    <dl>
                      {Object.entries(row.inputs).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value === null ? "Missing" : String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </td>
              </GameCardRow>
            );
          })}
        </tbody>
      </table>
      {!rows.length && (
        <p className="empty-state">No Lab forecasts match this view yet.</p>
      )}
    </div>
  );
}
