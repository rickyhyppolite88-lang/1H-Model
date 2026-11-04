import type { ReactNode } from "react";
import { preferenceFlag, usePreference } from "./usePreference";

const compactQuery = "(max-width: 780px)";

export default function ResponsiveDetails({
  summary,
  children,
  initiallyCollapsed = false,
}: {
  summary: string;
  children: ReactNode;
  initiallyCollapsed?: boolean;
}) {
  const [open, setOpen] = usePreference(
    `details.${summary}`,
    preferenceFlag,
    !initiallyCollapsed && !window.matchMedia?.(compactQuery).matches,
  );
  return (
    <details
      className="responsive-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <div className="responsive-details-content">{children}</div>
    </details>
  );
}
