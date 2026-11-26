import type { PlayDecision } from "./model/playDecision";

export default function BetDecision({
  decision,
  units = 1,
  paper = false,
  provenance,
}: {
  decision: PlayDecision;
  units?: number | null;
  paper?: boolean;
  provenance?: "recorded" | "replay";
}) {
  const yes = decision.yes && units !== null && units > 0;
  return (
    <span
      className={`bet-decision ${yes ? "bet-yes" : "bet-no"}`}
      title={decision.reason}
    >
      <strong>{yes ? "YES BET" : "NO BET"}</strong>
      {yes && (
        <small>
          {units}u{paper ? " paper" : provenance ? ` ${provenance}` : ""}
        </small>
      )}
      {!yes && <small className="card-detail">{decision.reason}</small>}
    </span>
  );
}
