import { formatPrice, formatUnits, type UnitPlay } from "./model/units";

export default function UnitResult({ play }: { play?: UnitPlay }) {
  if (!play || play.units === null)
    return <span className="unit-result">No recorded stake</span>;
  return (
    <span
      className="unit-result"
      title={
        play.mode === "historical"
          ? "Retrospective 1-unit simulation, not a pregame stake"
          : "Model stake locked before tipoff; not a confirmed wager"
      }
    >
      <strong>
        {play.units}u{" "}
        <span
          className={
            play.net !== null && play.net > 0
              ? "units-positive"
              : play.net !== null && play.net < 0
                ? "units-negative"
                : ""
          }
        >
          {formatUnits(play.net)}
        </span>
      </strong>
      <small>
        {formatPrice(play.price)} ·{" "}
        {play.mode === "historical" ? "Simulated" : "Recorded"}
      </small>
    </span>
  );
}
