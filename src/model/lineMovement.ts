import { marketStatus } from "./marketCoverage";
import type { PredictionRow } from "./predictions";
import { compareTotal, type Side } from "./predictor";

export type RecordedLinePick = {
  line: number;
  side: Side;
  actual: number | null;
  grade: string;
};
export type RecordAvailability = "loading" | "ready" | "missing" | "error";
export const linePoints = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

/** Point-total movement at one book, keeping recorded picks on their original line. */
export function describeLineMovement(
  row: PredictionRow,
  sportsbook: string,
  recorded?: RecordedLinePick,
  recordAvailability: RecordAvailability = "ready",
) {
  const market = row.markets.find((quote) => quote.sportsbook === sportsbook);
  const opening = market?.openingLine ?? null;
  const current =
    marketStatus(row, sportsbook) === "available"
      ? (market?.latestLine ?? null)
      : null;
  const delta =
    opening !== null && current !== null
      ? Number((current - opening).toFixed(4))
      : null;
  const direction =
    delta === null
      ? "unknown"
      : delta > 0
        ? "up"
        : delta < 0
          ? "down"
          : "unchanged";
  const movement =
    delta === null
      ? current === null
        ? "Current line unavailable; movement cannot be calculated."
        : "Opening line unavailable; movement cannot be calculated."
      : `Opening ${linePoints(opening as number)} → current ${linePoints(current as number)}. ${delta === 0 ? "No movement." : `Total moved ${delta > 0 ? "up" : "down"} ${linePoints(Math.abs(delta))} points.`}`;
  const total = row.projectedFirstHalfTotal;
  let modelImpact: string;
  if (total === null)
    modelImpact =
      "No valid model projection; the move’s effect on a model pick cannot be rated.";
  else if (current === null)
    modelImpact =
      "Current line unavailable; there is no current model lean or edge to compare.";
  else {
    const now = compareTotal(total, current);
    const currentText =
      now.modelLean === "PUSH"
        ? "The model equals the current line; no model lean."
        : `Current ${now.modelLean} edge: ${linePoints(now.edge)} points.`;
    if (opening === null)
      modelImpact = `${currentText} No opener is available for comparison.`;
    else {
      const before = compareTotal(total, opening);
      if (now.modelLean !== before.modelLean) {
        modelImpact =
          now.modelLean === "PUSH"
            ? `Move removes the opening ${before.modelLean} lean. ${currentText}`
            : before.modelLean === "PUSH"
              ? `Move creates an ${now.modelLean} lean; the opener matched the model. ${currentText}`
              : `Model lean flips ${before.modelLean} → ${now.modelLean}. ${currentText}`;
      } else {
        const change = Number((now.edge - before.edge).toFixed(4));
        modelImpact =
          change === 0
            ? `Model lean and edge are unchanged. ${currentText}`
            : `${now.modelLean} edge ${change > 0 ? "grew" : "shrank"} by ${linePoints(Math.abs(change))} points (${linePoints(before.edge)} → ${linePoints(now.edge)}).`;
      }
    }
  }
  let hypotheticalGrade: "Win" | "Loss" | "Push" | null = null;
  let recordedImpact: string;
  if (!recorded) {
    recordedImpact =
      recordAvailability === "loading"
        ? "Loading the recorded pick…"
        : recordAvailability === "error"
          ? "Recorded-pick data is unavailable; saved-pick impact cannot be checked."
          : "No counted pregame pick is saved for this sportsbook. No official result is changed.";
  } else {
    const saved = `Recorded ${recorded.side} ${linePoints(recorded.line)}`;
    if (current === null)
      recordedImpact = `${saved} keeps its original line. A current entry cannot be compared without a current quote.`;
    else if (
      recorded.actual !== null &&
      ["Win", "Loss", "Push"].includes(recorded.grade)
    ) {
      hypotheticalGrade =
        recorded.actual === current
          ? "Push"
          : recorded.actual > current === (recorded.side === "OVER")
            ? "Win"
            : "Loss";
      recordedImpact = `${saved}: ${recorded.grade}. The same side at current ${linePoints(current)} would be ${hypotheticalGrade}. Official result remains ${recorded.grade} at the saved line.`;
    } else {
      const advantage =
        recorded.side === "OVER"
          ? recorded.line - current
          : current - recorded.line;
      recordedImpact = `${saved} keeps its original line and ${recorded.grade.toLowerCase()} status. ${advantage === 0 ? "Current quote is the same line." : `A new ${recorded.side} at ${linePoints(current)} is ${linePoints(Math.abs(advantage))} points ${advantage > 0 ? "more" : "less"} favorable than the recorded line.`}`;
    }
  }
  return {
    opening,
    current,
    delta,
    direction,
    movement,
    modelImpact,
    recordedImpact,
    hypotheticalGrade,
    capturedAt: market?.capturedAt ?? null,
    capturedMinutesBeforeTipoff: market
      ? Math.round(
          (Date.parse(row.startsAt) - Date.parse(market.capturedAt)) / 60_000,
        )
      : null,
  };
}
