/** biome-ignore-all lint/a11y/useSemanticElements: Explicit roles preserve this native row when mobile CSS changes its display. */
/** biome-ignore-all lint/a11y/noRedundantRoles: Mobile cards retain native table semantics. */
import { type CSSProperties, type ReactNode, useId, useState } from "react";

export default function GameCardRow({
  label,
  fill,
  signalScore,
  kind = "prediction",
  children,
}: {
  label: string;
  fill: string | null;
  signalScore?: number | null;
  kind?: "prediction" | "record";
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <tr
      role="row"
      id={id}
      className={`game-card game-card-${kind}${expanded ? " is-expanded" : ""}`}
      style={
        {
          "--signal-fill": fill ?? "transparent",
          "--signal-tint": `${(signalScore ?? 0) * 0.32}%`,
          "--signal-border": `${signalScore ?? 0}%`,
        } as CSSProperties
      }
    >
      {children}
      <td role="cell" className="card-toggle-cell">
        <button
          className="card-toggle-button"
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={`${expanded ? "Collapse" : "Expand"} details for ${label}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Less detail" : "Full details"}
          <span aria-hidden="true">{expanded ? "−" : "+"}</span>
        </button>
      </td>
    </tr>
  );
}
