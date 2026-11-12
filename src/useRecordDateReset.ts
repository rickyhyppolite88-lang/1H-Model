import { useEffect } from "react";

/** Blank-space clicks dismiss a daily drilldown without interrupting plays or controls. */
export function useRecordDateReset(
  date: string,
  onSelectDate: (date: string) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || date === "all") return;
    const dismiss = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        !(event.target instanceof Element) ||
        window.getSelection()?.toString() ||
        event.target.closest(
          ".game-card, button, a, input, select, textarea, label, summary, [role='button'], [contenteditable='true']",
        )
      )
        return;
      onSelectDate("all");
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented)
        onSelectDate("all");
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [date, onSelectDate, enabled]);
}
