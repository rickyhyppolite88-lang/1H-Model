import type { ModelSignal } from "./model/signals";

export default function SignalBadge({ signal }: { signal: ModelSignal }) {
  return (
    <span
      className={`signal-badge ${signal.score === null ? "signal-neutral" : ""}`}
      title={`Confidence is an uncalibrated model score, not a win probability. ${signal.reason}`}
    >
      <small className="confidence-label">Confidence score</small>
      <strong>{signal.score === null ? "—" : `${signal.score}%`}</strong>
      <small className="signal-status">{signal.label}</small>
      <small className="signal-explanation card-detail">
        Model score, not a win probability
      </small>
    </span>
  );
}
