import { useId, useState } from "react";
import { easternTipoff } from "./model/time";
import {
  formatUnits,
  summarizeUnits,
  type UnitMode,
  type UnitPlay,
  unitPlaysCsv,
  unitPolicy,
} from "./model/units";

export default function UnitCalendar({
  plays,
  date,
  onSelectDate,
  available,
  error = "",
  label = "Actual",
}: {
  plays: UnitPlay[];
  date: string;
  onSelectDate: (date: string) => void;
  available: boolean;
  error?: string;
  label?: string;
}) {
  const id = useId();
  const latest =
    plays
      .map((row) => row.date)
      .sort()
      .at(-1) ?? easternTipoff(new Date().toISOString()).date;
  const [monthChoice, setMonth] = useState<string | null>(null);
  const [modeChoice, setMode] = useState<UnitMode | null>(null);
  const mode =
    modeChoice ??
    (plays.some((row) => row.mode === "tracked") ? "tracked" : "historical");
  const month =
    date === "all" ? (monthChoice ?? latest.slice(0, 7)) : date.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthLabel = first.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const scoped = plays.filter((row) => row.mode === mode);
  const days = new Map<string, UnitPlay[]>();
  for (const row of scoped)
    days.set(row.date, [...(days.get(row.date) ?? []), row]);
  const selected = scoped.filter((row) =>
    date === "all" ? row.date.startsWith(month) : row.date === date,
  );
  const summary = summarizeUnits(selected);
  function move(offset: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    setMonth(next.toISOString().slice(0, 7));
    onSelectDate("all");
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", unitPlaysCsv(selected)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `1h-${label.toLowerCase()}-units-${date === "all" ? month : date}-${mode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="unit-calendar" aria-label={`${label} units calendar`}>
      <div className="unit-calendar-heading">
        <div>
          <span className="unit-calendar-kicker">
            {label} ·{" "}
            {mode === "tracked"
              ? "Recorded model stakes"
              : "Historical 1u simulation"}
          </span>
          <h3>{monthLabel}</h3>
        </div>
        <div className="button-group">
          <button
            type="button"
            className="secondary-button"
            aria-label={`Previous ${label} month`}
            onClick={() => move(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label={`Next ${label} month`}
            onClick={() => move(1)}
          >
            ›
          </button>
        </div>
      </div>
      <div className="unit-calendar-controls">
        <label htmlFor={id}>
          Unit accounting
          <select
            id={id}
            value={mode}
            onChange={(event) => setMode(event.target.value as UnitMode)}
          >
            <option value="tracked">Recorded stakes · confidence tiers</option>
            <option value="historical">
              Historical simulation · 1u per pick
            </option>
          </select>
        </label>
      </div>
      <div className="unit-calendar-caption">
        <span>Daily net units (u) · ET</span>
        <button
          type="button"
          className="text-button"
          onClick={() => onSelectDate("all")}
          disabled={date === "all"}
        >
          All finished dates
        </button>
      </div>
      <fieldset
        className="unit-calendar-grid"
        aria-label={`${monthLabel} daily net units`}
      >
        {[
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ].map((day) => (
          <span className="unit-weekday" key={day} aria-hidden="true">
            {day[0]}
          </span>
        ))}
        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
          .slice(0, first.getUTCDay())
          .map((day) => (
            <span key={`blank-${day}`} />
          ))}
        {Array.from({ length: count }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          const rows = days.get(key) ?? [];
          const day = summarizeUnits(rows);
          const hasFinished = rows.some((row) => row.actual !== null);
          const text = !available
            ? "—"
            : day.settled
              ? formatUnits(day.net)
              : hasFinished
                ? "Review"
                : rows.length
                  ? "Pending"
                  : "—";
          const tone =
            available && day.settled
              ? day.net > 0
                ? "positive"
                : day.net < 0
                  ? "negative"
                  : "neutral"
              : "neutral";
          return (
            <button
              type="button"
              key={key}
              className={`unit-day unit-${tone}`}
              aria-label={`${key}: ${text}${day.unresolved ? `; ${day.unresolved} unsettled` : ""}`}
              aria-pressed={date === key}
              disabled={!plays.some((row) => row.date === key)}
              onClick={() => {
                setMonth(month);
                onSelectDate(key);
              }}
              title={`${key} · ${day.wins}W / ${day.losses}L / ${day.pushes}P · ${day.unresolved} unsettled`}
            >
              <span>{i + 1}</span>
              <strong>{text.endsWith("u") ? text.slice(0, -1) : text}</strong>
              {day.unresolved > 0 && <small>+{day.unresolved} open</small>}
            </button>
          );
        })}
      </fieldset>
      <div className="unit-calendar-totals" aria-live="polite">
        <div>
          <span>{date === "all" ? monthLabel : date} · net units</span>
          <strong
            className={
              summary.net > 0
                ? "units-positive"
                : summary.net < 0
                  ? "units-negative"
                  : ""
            }
          >
            {available && summary.settled ? formatUnits(summary.net) : "—"}
          </strong>
        </div>
        <div>
          <span>Settled unit plays · W–L–P</span>
          <strong>
            {available
              ? `${summary.wins}–${summary.losses}–${summary.pushes}`
              : "—"}
          </strong>
        </div>
      </div>
      <p className="unit-calendar-caption">
        {available
          ? `${summary.risk.toFixed(1)}u risked · ${summary.settled} settled plays`
          : "Loading unit results…"}
        {summary.unresolved ? ` · ${summary.unresolved} unsettled` : ""}
      </p>
      <details className="unit-calendar-policy">
        <summary>Unit rules & accounting</summary>
        <p className="inline-note">
          {mode === "historical"
            ? "Simulation only: 1u risked on each original eligible pick before the unit plan began. These were not recorded stakes or confirmed wagers."
            : unitPolicy.description}{" "}
          One unit is the amount risked. Confidence is a model ranking, not a
          win probability.{" "}
          {summary.unresolved > 0
            ? `${summary.unresolved} plays are excluded from net units until results and matching saved odds are available.`
            : ""}
        </p>
      </details>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        onClick={download}
        disabled={!available || !selected.length}
      >
        Download {date === "all" ? "month" : "day"} units CSV ↓
      </button>
    </section>
  );
}
