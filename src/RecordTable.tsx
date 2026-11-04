/** biome-ignore-all lint/a11y/useSemanticElements: These native table elements need explicit roles because mobile CSS changes their display. */
/** biome-ignore-all lint/a11y/noRedundantRoles: Explicit roles preserve table semantics when mobile CSS displays rows as cards. */
import GameCardRow from "./GameCardRow";
import GameTime from "./GameTime";
import { dailyRecordStatus } from "./model/dailyRecord";
import {
  type ForecastRecord,
  type RecordStore,
  recordGrade,
} from "./model/predictionRecord";
import SignalBadge from "./SignalBadge";
import TeamIdentity from "./TeamIdentity";

const point = (n: number | null) => (n === null ? "—" : n.toFixed(2));

export default function RecordTable({
  records,
  results,
  canonicalIds,
  showVersions,
  onOpenDay,
}: {
  records: ForecastRecord[];
  results: RecordStore["results"];
  canonicalIds: string[];
  showVersions: boolean;
  onOpenDay?: (date: string) => void;
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
              Saved signal
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
            return (
              <GameCardRow
                key={record.id}
                kind="record"
                label={`${record.prediction.awayTeam} at ${record.prediction.homeTeam}`}
                fill={record.signal.fill}
                signalScore={record.signal.score}
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
                </td>
                <td role="cell" className="card-lean" data-label="Lean">
                  {record.comparison.lean ?? "—"}
                </td>
                <td
                  role="cell"
                  className="card-detail"
                  data-label="Saved signal"
                >
                  <SignalBadge signal={record.signal} />
                </td>
                <td role="cell" className="card-detail" data-label="Actual 1H">
                  {grade.actual ?? "—"}
                </td>
                <td role="cell" className="card-result" data-label="Result">
                  <span
                    className={`record-grade grade-${grade.grade.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    {grade.grade}
                  </span>
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
          No recorded forecasts match these filters.
        </div>
      )}
    </div>
  );
}
