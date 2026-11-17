/** biome-ignore-all lint/a11y/useSemanticElements: Mobile cards retain explicit native table roles. */
/** biome-ignore-all lint/a11y/noRedundantRoles: CSS changes mobile table display. */

import ContextDetails from "./ContextDetails";
import FoulDetails from "./FoulDetails";
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import { usesTipoffEntry, verifiedTipoffQuote } from "./model/entryPolicy";
import { gradeLab, type LabForecast, type LabStore } from "./model/lab";
import { isPaperLabMethod } from "./model/labVersions";
import { sportsbookNames } from "./model/marketCoverage";
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
              bonus ? "Bet forecast" : "Confidence & units",
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
            const awaitingTipCheck =
              usesTipoffEntry(
                row.startsAt,
                store.entryPolicy,
                `${row.season}:${row.gameId}`,
              ) &&
              !verifiedTipoffQuote(
                row.startsAt,
                typeof row.inputs.entryQuoteCapturedAt === "string"
                  ? row.inputs.entryQuoteCapturedAt
                  : null,
                store.entryPolicy,
              );
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
                  data-label={
                    bonus
                      ? "League min"
                      : `Saved ${sportsbookNames[row.sportsbook] ?? row.sportsbook}`
                  }
                >
                  {point(bonus ? row.bonusBaselineMinutes : row.line)}
                  {!bonus && (
                    <small>
                      {sportsbookNames[row.sportsbook] ?? row.sportsbook}
                    </small>
                  )}
                  {typeof row.inputs.entryQuoteCapturedAt === "string" && (
                    <small className="card-detail">
                      Line captured{" "}
                      <GameTime startsAt={row.inputs.entryQuoteCapturedAt} />
                    </small>
                  )}
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
                  data-label="Confidence"
                >
                  {bonus ? (
                    <div className="signal-badge">
                      <span className="confidence-label">Bet forecast</span>
                      <strong>None</strong>
                    </div>
                  ) : (
                    <SignalBadge {...rating} />
                  )}
                  {!bonus && isPaperLabMethod(row.methodId) && (
                    <small className="unit-suggestion">
                      {row.status === "qualified" ? "1u paper" : "0u · Watch"}
                    </small>
                  )}
                  {!bonus && !isPaperLabMethod(row.methodId) && (
                    <small className="unit-suggestion">
                      {unitPlays?.get(row.id)?.units != null
                        ? `${unitPlays.get(row.id)?.units}u recorded`
                        : row.status === "qualified" &&
                            unitsForScore(row.signalStrength) !== null
                          ? `${unitsForScore(row.signalStrength)}u suggested`
                          : "0u · Watch"}
                    </small>
                  )}
                  {row.research && row.status !== "qualified" && (
                    <small className="unit-check-note">
                      {row.reason.includes("15 minutes")
                        ? "Awaiting pre-tip check"
                        : row.methodId === "referee-core-v4" &&
                            row.research.probability === null
                          ? "Referee inputs pending"
                          : row.status === "data_gap"
                            ? "Inputs pending"
                            : "Below qualification threshold"}
                    </small>
                  )}
                  {!unitPlays &&
                    !isPaperLabMethod(row.methodId) &&
                    awaitingTipCheck &&
                    row.status === "qualified" &&
                    unitsForScore(row.signalStrength) !== null && (
                      <small className="unit-check-note">
                        Awaiting pre-tip check
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
                  {row.research && (
                    <div className="research-forecast-details">
                      <p>
                        Estimated return:{" "}
                        {row.research.expectedReturn === null
                          ? "Pending"
                          : `${(row.research.expectedReturn * 100).toFixed(1)}%`}{" "}
                        · Training sample: {row.research.trainingGames} earlier
                        games · Stake: {row.research.paperUnits}u paper.
                      </p>
                      <p>
                        The unchanged Actual total and direction are retained.
                        Confidence is an unvalidated probability estimate,
                        distinct from the earlier Lab signal score.
                      </p>
                      {row.methodId === "referee-core-v4" && (
                        <>
                          <p>
                            Crew:{" "}
                            {row.research.crew.length
                              ? row.research.crew
                                  .map(
                                    (r) =>
                                      `${r.name} (${r.pricedGames} priced prior halves)`,
                                  )
                                  .join("; ")
                              : "Awaiting verified pregame assignment"}
                            .
                          </p>
                          <p>
                            Referee scoring association:{" "}
                            {point(row.research.refereePointsEquivalent)} points
                            equivalent. Officials are averaged; effects are not
                            added three times. Individual caller attribution is
                            unavailable.
                          </p>
                          {row.research.refereeBaselineProbability !== null && (
                            <p>
                              V3 reference confidence before referee inputs:{" "}
                              {(
                                row.research.refereeBaselineProbability * 100
                              ).toFixed(1)}
                              %.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
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
