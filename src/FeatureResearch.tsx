import { useEffect, useState } from "react";
import type { z } from "zod";
import { featureReplaySchema } from "./model/labFeatureSchema";
import type { FeaturePaperMethod } from "./model/labVersions";
import { formatUnits } from "./model/units";
import { watchPublishedUpdates } from "./publishedUpdates";

export default function FeatureResearch({
  method,
}: {
  method: FeaturePaperMethod;
}) {
  const [report, setReport] = useState<z.infer<
    typeof featureReplaySchema
  > | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/lab-feature-replay.json`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Unavailable");
        const data = featureReplaySchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setReport(data);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setError("Historical comparison is awaiting publication or refresh.");
      }
    };
    void load();
    const stop = watchPublishedUpdates(load);
    return () => {
      controller.abort();
      stop();
    };
  }, []);
  const result = report?.methods[method];
  return (
    <details className="lab-calibration">
      <summary>Historical replay & test plan</summary>
      <p>
        Historical replay at 1u risk per game using archived pregame inputs and
        DraftKings prices. Daily fits use only earlier days. These results stay
        separate from the prospective paper record and calendar.
      </p>
      {error && <output>{error}</output>}
      {result && (
        <>
          <p>
            {report?.from} to {report?.through} · {result.games} matched
            completed first halves. Review-only gaps and missing inputs receive
            no replay stake.
          </p>
          <div className="table-wrap">
            <table aria-label="Historical component replay">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">W–L–P</th>
                  <th scope="col">Net</th>
                  <th scope="col">Point MAE</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">This Lab version</th>
                  <td>
                    {result.wins}–{result.losses}–{result.pushes}
                  </td>
                  <td>{formatUnits(result.net)}</td>
                  <td>{result.mae?.toFixed(2) ?? "—"}</td>
                </tr>
                <tr>
                  <th scope="row">Actual on the same lines</th>
                  <td>
                    {result.baselineWins}–{result.baselineLosses}–
                    {result.baselinePushes}
                  </td>
                  <td>{formatUnits(result.baselineNet)}</td>
                  <td>{result.baselineMae?.toFixed(2) ?? "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            {result.changedSides} directions changed. Actual has{" "}
            {result.baselineNoLean} exact-line no-leans in this cohort. This is
            a retrospective study with current result corrections, not
            independently validated profitability.
          </p>
        </>
      )}
      <p>
        Forward checkpoint: at least 30 days and 300 completed matched paper
        plays, whichever takes longer. Keep numerical rules fixed; review data
        collection weekly. Track units and point error against Actual on
        identical entries. No automatic promotion from a positive short run.
      </p>
    </details>
  );
}
