import { type ReactNode, useEffect, useState } from "react";

const compactQuery = "(max-width: 780px)";

export default function ResponsiveDetails({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(
    () => !window.matchMedia?.(compactQuery).matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.(compactQuery);
    if (!media) return;
    const resize = () => setOpen(!media.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
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
