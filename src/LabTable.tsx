/** biome-ignore-all lint/a11y/useSemanticElements: Mobile cards retain explicit native table roles. */
/** biome-ignore-all lint/a11y/noRedundantRoles: CSS changes mobile table display. */

import ContextDetails from "./ContextDetails";
import FoulDetails from "./FoulDetails";
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import { gradeLab, type LabForecast, type LabStore } from "./model/lab";
import { labRating } from "./model/ratingDisplay";
import { scheduleMessages } from "./model/scheduleReview";
import { type UnitPlay, unitsForScore } from "./model/units";
import SignalBadge from "./SignalBadge";
import TeamIdentity from "./TeamIdentity";
import UnitResult from "./UnitResult";

const point = (value: number | null) =>
  value === null ? "—" : value.toFixed(2);
export default function LabTable({
  rows,
  store,
  bonus,
  unitPlays,
}: {
  rows: LabForecast[];
  store: LabStore;
  bonus: boolean;
  unitPlays?: Map<string, UnitPlay>;
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
            const rating = labRating(row);
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
                  {row.methodId.startsWith("enhanced-baseline-") && (
                    <small className="card-detail">
                      Actual {point(row.baselineTotal)}
                    </small>
                  )}
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
                  {bonus ? (
                    <div className="signal-badge">
                      <span className="confidence-label">Bet forecast</span>
                      <strong>None</strong>
                    </div>
                  ) : (
                    <SignalBadge {...rating} scoreUnit="points" />
                  )}
                  {!unitPlays &&
                    row.status === "qualified" &&
                    unitsForScore(row.signalStrength) !== null && (
                      <small className="unit-suggestion">
                        {unitsForScore(row.signalStrength)}u suggested
                      </small>
                    )}
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
                    title={scheduleMessages[result.schedule]}
                  >
                    {result.grade}
                  </span>
                  {result.schedule !== "unchanged" && (
                    <small className="schedule-note">
                      {result.schedule === "verified_time_change"
                        ? "Tip-time change verified"
                        : "Schedule review"}
                    </small>
                  )}
                  {unitPlays && <UnitResult play={unitPlays.get(row.id)} />}
                </td>
                <td
                  role="cell"
                  className="card-wide card-detail lab-forecast-details"
                  data-label="Research details"
                >
                  <p>{row.reason}</p>
                  {row.methodId === "enhanced-baseline-v2" && (
                    <p>
                      Actual {point(row.baselineTotal)} → 1H defense{" "}
                      {point(
                        typeof row.inputs.defenseAdjustedTotal === "number"
                          ? row.inputs.defenseAdjustedTotal
                          : null,
                      )}{" "}
                      → venue/matchup{" "}
                      {row.context
                        ? `${row.context.adjustment >= 0 ? "+" : ""}${point(row.context.adjustment)}`
                        : "Missing"}{" "}
                      → FT/fouls{" "}
                      {row.foulExposure
                        ? `${row.foulExposure.pointsAdjustment >= 0 ? "+" : ""}${point(row.foulExposure.pointsAdjustment)}`
                        : "Missing"}{" "}
                      → Lab {point(row.total)}.
                    </p>
                  )}
                  {row.methodId === "enhanced-baseline-v1" && (
                    <p className="lab-calculation">
                      Actual {point(row.baselineTotal)} → defense{" "}
                      {point(
                        typeof row.inputs.defenseAdjustedTotal === "number"
                          ? row.inputs.defenseAdjustedTotal
                          : null,
                      )}{" "}
                      → bonus{" "}
                      {typeof row.inputs.bonusPointsAdjustment === "number"
                        ? `${row.inputs.bonusPointsAdjustment >= 0 ? "+" : ""}${point(row.inputs.bonusPointsAdjustment)}`
                        : "Missing"}{" "}
                      → Lab {point(row.total)}. Qualification uses the final
                      total and both adjusted components.
                    </p>
                  )}
                  <p>Research lean: {row.side ?? "No priced lean"}</p>
                  <ContextDetails context={row.context} />
                  <FoulDetails
                    forecast={row.foulExposure}
                    away={row.awayTeam}
                    home={row.homeTeam}
                    actualFTA={result.actualFTA}
                    actualFouls={result.actualFouls}
                  />
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
