/** biome-ignore-all lint/a11y/useSemanticElements: These native table elements need explicit roles because mobile CSS changes their display. */
/** biome-ignore-all lint/a11y/noRedundantRoles: Explicit roles preserve table semantics when mobile CSS displays rows as cards. */
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import { dailyRecordStatus } from "./model/dailyRecord";
import { sportsbookNames } from "./model/marketCoverage";
import {
  type ForecastRecord,
  type RecordStore,
  recordGrade,
} from "./model/predictionRecord";
import { recordRating } from "./model/ratingDisplay";
import { scheduleMessages } from "./model/scheduleReview";
import type { UnitPlay } from "./model/units";
import SignalBadge from "./SignalBadge";
import TeamIdentity from "./TeamIdentity";
import UnitResult from "./UnitResult";

const point = (n: number | null) => (n === null ? "—" : n.toFixed(2));

export default function RecordTable({
  records,
  results,
  canonicalIds,
  showVersions,
  onOpenDay,
  emptyMessage,
  unitPlays,
}: {
  records: ForecastRecord[];
  results: RecordStore["results"];
  canonicalIds: string[];
  showVersions: boolean;
  onOpenDay?: (date: string) => void;
  emptyMessage?: string;
  unitPlays?: Map<string, UnitPlay>;
}) {
  const ids = new Set(canonicalIds);
  return (
    <div className="table-wrap card-table-wrap">
      <table
        role="table"
        className="card-table"
        aria-label="Recorded predictions"
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
              Saved model
            </th>
            <th role="columnheader" scope="col">
              Saved line
            </th>
            <th role="columnheader" scope="col">
              Lean
            </th>
            <th role="columnheader" scope="col">
              Confidence rating
            </th>
            <th role="columnheader" scope="col">
              Actual 1H
            </th>
            <th role="columnheader" scope="col">
              Result
            </th>
            <th role="columnheader" scope="col">
              Coverage status
            </th>
            {showVersions && (
              <th role="columnheader" scope="col">
                Record version
              </th>
            )}
            <th role="columnheader" scope="col" className="card-toggle-cell">
              Details
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {records.map((record) => {
            const grade = recordGrade(record, results);
            const rating = recordRating(record);
            const quote = record.quotes.find(
              (row) => row.sportsbook === record.sportsbook,
            );
            const lineCapturedAt =
              record.basis === "opening"
                ? quote?.openingCapturedAt
                : quote?.latestCapturedAt;
            return (
              <GameCardRow
                key={record.id}
                kind="record"
                label={`${record.prediction.awayTeam} at ${record.prediction.homeTeam}`}
              >
                <td role="cell" className="card-time" data-label="Tipoff (ET)">
                  <GameTime startsAt={record.prediction.startsAt} />
                  {onOpenDay && (
                    <button
                      className="text-button record-day-link card-detail"
                      type="button"
                      onClick={() => onOpenDay(record.gameDate)}
                      aria-label={`View day ${record.gameDate} for ${record.prediction.awayTeam} at ${record.prediction.homeTeam}`}
                    >
                      View day →
                    </button>
                  )}
                </td>
                <td
                  role="cell"
                  className="matchup-cell card-matchup"
                  data-label="Matchup"
                >
                  <TeamIdentity
                    name={record.prediction.awayTeam}
                    rank={record.prediction.awayRank}
                    conference={record.prediction.awayConference}
                  />
                  <TeamIdentity
                    name={record.prediction.homeTeam}
                    rank={record.prediction.homeRank}
                    conference={record.prediction.homeConference}
                  />
                  {showVersions && (
                    <small className="card-detail">
                      Recorded <GameTime startsAt={record.recordedAt} />
                    </small>
                  )}
                </td>
                <td
                  role="cell"
                  className="card-primary"
                  data-label="Saved model"
                >
                  {point(record.prediction.projectedFirstHalfTotal)}
                </td>
                <td
                  role="cell"
                  className="card-primary"
                  data-label="Saved line"
                >
                  {point(record.comparison.line)}
                  <small>
                    {sportsbookNames[record.sportsbook] ?? record.sportsbook}
                  </small>
                  {record.replay && <small>Archived line · Replay</small>}
                  {lineCapturedAt && (
                    <small className="card-detail">
                      Line captured <GameTime startsAt={lineCapturedAt} />
                    </small>
                  )}
                </td>
                <td role="cell" className="card-lean" data-label="Lean">
                  <span
                    className={`lean-badge lean-${record.comparison.lean?.toLowerCase() ?? "missing"}`}
                  >
                    {record.comparison.lean ?? "—"}
                  </span>
                </td>
                <td
                  role="cell"
                  className="card-confidence"
                  data-label="Confidence rating"
                >
                  <SignalBadge {...rating} />
                </td>
                <td role="cell" className="card-actual" data-label="Actual 1H">
                  {grade.actual ?? "—"}
                </td>
                <td role="cell" className="card-result" data-label="Result">
                  <span
                    className={`record-grade grade-${grade.grade.toLowerCase().replaceAll(" ", "-")}`}
                    title={scheduleMessages[grade.schedule]}
                  >
                    {grade.grade === "Pending" && grade.actual !== null
                      ? "Review needed"
                      : grade.grade}
                  </span>
                  {grade.schedule !== "unchanged" && (
                    <small className="schedule-note">
                      {grade.schedule === "verified_time_change"
                        ? "Tip-time change verified"
                        : "Schedule review"}
                    </small>
                  )}
                  {unitPlays && <UnitResult play={unitPlays.get(record.id)} />}
                  {record.replay && (
                    <small className="card-detail">
                      DraftKings replay from original{" "}
                      {record.replay.originalSportsbook} entry; calculated
                      later.
                    </small>
                  )}
                </td>
                <td
                  role="cell"
                  className="card-wide card-detail"
                  data-label="Coverage status"
                  title={record.prediction.unavailableReason ?? undefined}
                >
                  {dailyRecordStatus(record, ids)}
                </td>
                {showVersions && (
                  <td
                    role="cell"
                    className="card-wide card-detail"
                    data-label="Record version"
                  >
                    v{record.version}
                    <small>
                      {ids.has(record.id)
                        ? "Counted once"
                        : "Excluded from win rate"}
                    </small>
                    {record.importedAt && record.evidence?.publishedAt && (
                      <small>Recovered published forecast</small>
                    )}
                  </td>
                )}
              </GameCardRow>
            );
          })}
        </tbody>
      </table>
      {!records.length && (
        <div className="empty-state">
          {emptyMessage ?? "No recorded forecasts match these filters."}
        </div>
      )}
    </div>
  );
}
