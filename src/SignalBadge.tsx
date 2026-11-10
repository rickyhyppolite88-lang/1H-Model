import { ratingFallback } from "./model/ratingDisplay";
import type { ModelSignal } from "./model/signals";

export default function SignalBadge({
  signal,
  label = "Confidence",
  provenance,
  scoreUnit = "percent",
}: {
  signal: ModelSignal;
  label?: string;
  provenance?: string;
  scoreUnit?: "percent" | "points";
}) {
  return (
    <span
      className={`signal-badge ${signal.score === null ? "signal-neutral" : ""}`}
      title={`Confidence is an uncalibrated model score, not a win probability. ${signal.reason}`}
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
        {signal.reason} Model score, not a win probability.
      </small>
    </span>
  );
}
