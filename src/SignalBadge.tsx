import type { ModelSignal } from "./model/signals";

export default function SignalBadge({ signal }: { signal: ModelSignal }) {
  return (
    <span
      className={`signal-badge ${signal.score === null ? "signal-neutral" : ""}`}
      title={signal.reason}
    >
      {signal.score !== null && <strong>{signal.score}/100</strong>}
      <small>{signal.label}</small>
    </span>
  );
}
