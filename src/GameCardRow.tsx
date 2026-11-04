/** biome-ignore-all lint/a11y/useSemanticElements: Explicit roles preserve this native row when mobile CSS changes its display. */
/** biome-ignore-all lint/a11y/noRedundantRoles: Mobile cards retain native table semantics. */
import { type ReactNode, useId, useState } from "react";

export default function GameCardRow({
  label,
  kind = "prediction",
  children,
}: {
  label: string;
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
