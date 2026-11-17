import { ratingFallback } from "./model/ratingDisplay";
import type { ModelSignal } from "./model/signals";

export default function SignalBadge({
  signal,
  label = "Confidence",
  provenance,
  scoreUnit = "percent",
  meaning = "score",
}: {
  signal: ModelSignal;
  label?: string;
  provenance?: string;
  scoreUnit?: "percent" | "points";
  meaning?: "score" | "probability";
}) {
  return (
    <span
      className={`signal-badge ${signal.score === null ? "signal-neutral" : ""}`}
      title={`${meaning === "probability" ? "Estimated win probability; research estimates are not validated." : "Confidence is an uncalibrated model score, not a win probability."} ${signal.reason}`}
    >
      <small className="confidence-label">{label}</small>
      <strong>
        {signal.score === null
          ? ratingFallback(signal)
          : `${signal.score}${scoreUnit === "percent" ? "%" : ""}`}
      </strong>
      <small className="signal-status">{signal.label}</small>
      {provenance && <small className="signal-provenance">{provenance}</small>}
      <small className="signal-explanation card-detail">
        {signal.reason}{" "}
        {meaning === "probability"
          ? "Unvalidated research probability estimate."
          : "Model score, not a win probability."}
      </small>
    </span>
  );
}
