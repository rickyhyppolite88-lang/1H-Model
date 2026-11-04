import GameTime from "./GameTime";
import { dailyRecordStatus } from "./model/dailyRecord";
import {
  type ForecastRecord,
  type RecordStore,
  recordGrade,
} from "./model/predictionRecord";
import SignalBadge from "./SignalBadge";

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
    <div className="table-wrap">
      <table aria-label="Recorded predictions">
        <thead>
          <tr>
            <th>Tipoff (ET)</th>
            <th className="matchup-cell">Matchup</th>
            <th>Saved model</th>
            <th>Saved line</th>
            <th>Lean</th>
            <th>Saved signal</th>
            <th>Actual 1H</th>
            <th>Result</th>
            <th>Coverage status</th>
            {showVersions && <th>Record version</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const grade = recordGrade(record, results);
            return (
              <tr
                key={record.id}
                style={{ backgroundColor: record.signal.fill ?? undefined }}
              >
                <td>
                  <GameTime startsAt={record.prediction.startsAt} />
                  {onOpenDay && (
                    <button
                      className="text-button record-day-link"
                      type="button"
                      onClick={() => onOpenDay(record.gameDate)}
                      aria-label={`View day ${record.gameDate} for ${record.prediction.awayTeam} at ${record.prediction.homeTeam}`}
                    >
                      View day →
                    </button>
                  )}
                </td>
                <td className="matchup-cell">
                  <strong>
                    {record.prediction.awayTeam} / {record.prediction.homeTeam}
                  </strong>
                  {showVersions && (
                    <small>
                      Recorded <GameTime startsAt={record.recordedAt} />
                    </small>
                  )}
                </td>
                <td>{point(record.prediction.projectedFirstHalfTotal)}</td>
                <td>{point(record.comparison.line)}</td>
                <td>{record.comparison.lean ?? "—"}</td>
                <td>
                  <SignalBadge signal={record.signal} />
                </td>
                <td>{grade.actual ?? "—"}</td>
                <td>
                  <span
                    className={`record-grade grade-${grade.grade.toLowerCase().replaceAll(" ", "-")}`}
                  >
                    {grade.grade}
                  </span>
                </td>
                <td title={record.prediction.unavailableReason ?? undefined}>
                  {dailyRecordStatus(record, ids)}
                </td>
                {showVersions && (
                  <td>
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
              </tr>
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
