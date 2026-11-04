import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GameTime from "./GameTime";
import {
  describeLineMovement,
  linePoints,
  type RecordAvailability,
  type RecordedLinePick,
} from "./model/lineMovement";
import type { PredictionRow } from "./model/predictions";
import { tipoffState } from "./model/time";

export default function LineMovement({
  row,
  sportsbook,
  recorded,
  recordAvailability,
  at,
}: {
  row: PredictionRow;
  sportsbook: string;
  recorded?: RecordedLinePick;
  recordAvailability: RecordAvailability;
  at: number;
}) {
  const details = describeLineMovement(
    row,
    sportsbook,
    recorded,
    recordAvailability,
  );
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (!open || !button.current || !tooltip.current) return;
    const place = () => {
      if (!button.current || !tooltip.current) return;
      const anchor = button.current.getBoundingClientRect();
      const box = tooltip.current.getBoundingClientRect();
      setPosition({
        left: Math.max(
          12,
          Math.min(anchor.left, window.innerWidth - box.width - 12),
        ),
        top:
          anchor.bottom + box.height + 8 <= window.innerHeight - 12
            ? anchor.bottom + 8
            : Math.max(12, anchor.top - box.height - 8),
      });
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(tooltip.current);
    const close = () => setOpen(false);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const outside = (event: PointerEvent) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !tooltip.current?.contains(event.target as Node)
      )
        close();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", close, true);
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);
  const label =
    details.delta === null
      ? "?"
      : `${details.delta > 0 ? "+" : details.delta < 0 ? "−" : ""}${linePoints(Math.abs(details.delta))}`;
  const started = tipoffState(row, at) === "started";
  return (
    <span className="line-display">
      {details.current === null ? (
        <span className="line-missing">Not posted</span>
      ) : (
        details.current.toFixed(2)
      )}
      <button
        ref={button}
        type="button"
        className={`line-move line-move-${details.direction}`}
        aria-label={`Line movement for ${row.awayTeam} at ${row.homeTeam}: ${details.delta === null ? "unavailable" : details.delta === 0 ? "unchanged" : `${details.direction} ${linePoints(Math.abs(details.delta))} points`}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={show}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            id={id}
            role="tooltip"
            className="line-move-tooltip"
            style={{
              left: position?.left ?? 12,
              top: position?.top ?? 12,
              visibility: position ? "visible" : "hidden",
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <strong>Line movement & bet impact</strong>
            <p>{details.movement}</p>
            <p>
              <b>Model effect:</b> {details.modelImpact}
            </p>
            <p>
              <b>Recorded pick:</b> {details.recordedImpact}
            </p>
            {started && <p>Game has started. This comparison is for review.</p>}
            <small>
              Green + means the total rose; red − means it fell. These colors
              show movement direction.
            </small>
            <small>
              Point totals only; odds-price changes are not compared.
            </small>
            {details.capturedAt && (
              <small>
                Last retrieved <GameTime startsAt={details.capturedAt} />
              </small>
            )}
            {details.capturedMinutesBeforeTipoff !== null && (
              <small>
                Quote timing:{" "}
                {details.capturedMinutesBeforeTipoff > 0
                  ? `${details.capturedMinutesBeforeTipoff} min before scheduled tipoff`
                  : details.capturedMinutesBeforeTipoff < 0
                    ? `${Math.abs(details.capturedMinutesBeforeTipoff)} min after scheduled tipoff`
                    : "at scheduled tipoff"}
                .
              </small>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
