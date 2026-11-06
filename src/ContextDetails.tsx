import { type ContextForecast, matchupNames } from "./model/gameContext";

const points = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
export default function ContextDetails({
  context,
}: {
  context: ContextForecast | undefined;
}) {
  if (!context) return null;
  return (
    <div className="context-details">
      <p>
        <strong>Venue & matchup research</strong>
      </p>
      <p>
        {context.context.venueName ?? "Venue unknown"} ·{" "}
        {context.context.neutralSite === true
          ? "Neutral site"
          : context.context.neutralSite === false
            ? "Home / away"
            : "Site status unknown"}{" "}
        · {matchupNames[context.context.matchupType]}
      </p>
      {context.context.eventLabel && <p>{context.context.eventLabel}</p>}
      <p>
        Home/away {points(context.homeAwayAdjustment)} · neutral site{" "}
        {points(context.neutralAdjustment)} · matchup{" "}
        {points(context.matchupAdjustment)} · crowd{" "}
        {points(context.crowdAdjustment)}. Combined adjustment:{" "}
        {points(context.adjustment)} points.
      </p>
      {Math.abs(context.unboundedAdjustment - context.adjustment) >
        0.000001 && (
        <p>
          Combined context adjustment capped at {points(context.adjustment)}{" "}
          points.
        </p>
      )}
      <p>
        {context.expectedAttendance === null
          ? "Attendance proxy unavailable."
          : `Earlier venue attendance: about ${Math.round(context.expectedAttendance).toLocaleString()} across ${context.attendanceSamples} games.`}{" "}
        {context.crowdReason}
      </p>
      <p>
        Location history: home team {context.homeLocationGames} home games ·
        away team {context.awayLocationGames} away games. Effects are estimates
        from {context.trainingGames.toLocaleString()} earlier D1 halves,
        adjusted for opponent strength and shrunk for sample size.
      </p>
      {context.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      <a
        href={`${import.meta.env.BASE_URL}${context.modelPath}`}
        target="_blank"
        rel="noreferrer"
      >
        Saved context model & sources ↗
      </a>
    </div>
  );
}
