import type { LabForecast } from "./lab";
import { isStakedLabStatus } from "./labVersions";
import { marketStatus } from "./marketCoverage";
import type { LineBasis, PredictionRow } from "./predictions";
import { tipoffState } from "./time";

export type PlayDecision = { yes: boolean; reason: string };
const no = (reason: string): PlayDecision => ({ yes: false, reason });
const fresh = (time: string | null | undefined, at: number) => {
  const age = at - Date.parse(time ?? "");
  return Number.isFinite(age) && age >= 0 && age <= 45 * 60_000;
};

/** A display decision using existing eligibility rules; no confidence tiers or probability claim. */
export function predictionDecision(
  row: PredictionRow,
  book: string,
  basis: LineBasis,
  at: number,
): PlayDecision {
  if (tipoffState(row, at) !== "upcoming" || at >= Date.parse(row.startsAt))
    return no("Tipoff has passed. This is not a new play.");
  if (
    row.featureKind !== "captured_pregame" ||
    row.projectedFirstHalfTotal === null ||
    row.simpleTotal === null ||
    row.paceAdjustedTotal === null
  )
    return no("Pregame model inputs are missing.");
  if (row.featureCapturedAt && Date.parse(row.featureCapturedAt) > at)
    return no("The model inputs are not yet available.");
  const market = row.markets.find((m) => m.sportsbook === book);
  const line = basis === "latest" ? market?.latestLine : market?.openingLine;
  if (
    line == null ||
    (basis === "latest" && marketStatus(row, book) !== "available")
  )
    return no("The selected sportsbook line is unavailable.");
  if (
    !fresh(market?.capturedAt, at) ||
    (row.marketCoverage && !fresh(row.marketCoverage.checkedAt, at))
  )
    return no("Waiting for a fresh sportsbook line check.");
  if (row.projectedFirstHalfTotal === line)
    return no("The model has no over/under lean at this line.");
  if (Math.abs(row.projectedFirstHalfTotal - line) >= 8)
    return no("An 8+ point gap requires review.");
  return {
    yes: true,
    reason:
      "Pregame model inputs and a fresh line support a play. The saved record freezes the verified pre-tip entry.",
  };
}

export function labDecision(row: LabForecast, at: number): PlayDecision {
  if (at >= Date.parse(row.startsAt))
    return no("Tipoff has passed. See the saved record.");
  if (
    !isStakedLabStatus(row.status) ||
    row.line === null ||
    (row.side !== "OVER" && row.side !== "UNDER")
  )
    return no(row.reason);
  if (
    !fresh(
      typeof row.inputs.entryQuoteCapturedAt === "string"
        ? row.inputs.entryQuoteCapturedAt
        : typeof row.inputs.quoteCapturedAt === "string"
          ? row.inputs.quoteCapturedAt
          : null,
      at,
    )
  )
    return no("Waiting for a fresh sportsbook line check.");
  return { yes: true, reason: row.reason };
}
