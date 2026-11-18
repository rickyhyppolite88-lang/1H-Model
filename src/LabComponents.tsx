import type { LabForecast, LabStore } from "./model/lab";
import { labComponentComparison } from "./model/labComponents";

const points = (n: number | null) => (n === null ? "—" : n.toFixed(2));
export default function LabComponents({
  forecasts,
  store,
}: {
  forecasts: LabForecast[];
  store: LabStore;
}) {
  const rows = labComponentComparison(forecasts, store);
  const measured = rows[0].games;
  return (
    <details className="lab-calibration">
      <summary>Lab component comparison · {measured} completed games</summary>
      <p>
        Each row uses the same completed games and their original frozen inputs.
        Lower point error is better; a negative change improves on Actual core.
        The record columns hold the full Lab’s original qualified/control games
        and saved lines fixed. These component replays are research, not
        separate official betting records.
      </p>
      <p>
        All saved dates or the selected date apply here. Missing components and
        unresolved schedule reviews are excluded. Removing a context factor
        reapplies the original ±4 point cap. Actual weights stay unchanged; no
        component is promoted automatically.
      </p>
      <div className="table-wrap">
        <table
          className="component-table"
          aria-label="Lab component comparison"
        >
          <thead>
            <tr>
              <th scope="col">Saved component</th>
              <th scope="col">Games</th>
              <th scope="col">Point error (MAE)</th>
              <th scope="col">Change vs core</th>
              <th scope="col">Same selected games W–L–P</th>
              <th scope="col">No lean</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.name}</th>
                <td>{row.games}</td>
                <td>{points(row.mae)}</td>
                <td>
                  {row.delta === null
                    ? "—"
                    : `${row.delta > 0 ? "+" : ""}${points(row.delta)}`}
                </td>
                <td>
                  {row.wins}–{row.losses}–{row.pushes}
                </td>
                <td>{row.noLean}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!measured && (
        <p>
          Waiting for completed first halves with all saved Lab v2 components.
        </p>
      )}
    </details>
  );
}
