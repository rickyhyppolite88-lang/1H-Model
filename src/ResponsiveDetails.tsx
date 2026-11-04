import { type ReactNode, useEffect, useState } from "react";

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
  const [open, setOpen] = useState(
    () => !initiallyCollapsed && !window.matchMedia?.(compactQuery).matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.(compactQuery);
    if (!media) return;
    const resize = () => setOpen(!initiallyCollapsed && !media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, [initiallyCollapsed]);
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
