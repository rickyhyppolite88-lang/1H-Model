import { z } from "zod";
import { marketStatus } from "./marketCoverage";
import type { LineBasis, PredictionRow } from "./predictions";
import { compareTotal } from "./predictor";

export const signalSchema = z.object({
  method: z.literal("model-signal-v1"),
  score: z.number().int().min(0).max(100).nullable(),
  label: z.enum([
    "Aligned",
    "Mixed",
    "Outlier review",
    "No lean",
    "Unavailable",
    "Closed",
    "Reconstructed",
  ]),
  reason: z.string(),
  fill: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
});
export type ModelSignal = z.infer<typeof signalSchema>;

export function signalFill(score: number) {
  const t = Math.max(0, Math.min(100, score)) / 100;
  return `#${[245, 250, 240]
    .map((start, i) =>
      Math.round(start + ([172, 212, 150][i] - start) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A transparent research ranking; never a fitted hit probability. */
export function predictionSignal(
  row: PredictionRow,
  book: string,
  basis: LineBasis,
  at: string,
): ModelSignal {
  const neutral = (
    label: ModelSignal["label"],
    reason: string,
  ): ModelSignal => ({
    method: "model-signal-v1",
    score: null,
    label,
    reason,
    fill: null,
  });
  if (
    Date.parse(at) >= Date.parse(row.startsAt) ||
    row.actualFirstHalfTotal !== null
  )
    return neutral(
      "Closed",
      "Tipoff has passed; current games are not ranked as upcoming picks.",
    );
  if (row.featureKind === "reconstructed_season_debut")
    return neutral(
      "Reconstructed",
      "Reconstructed estimates are excluded from the upcoming signal ranking.",
    );
  const market = row.markets.find((m) => m.sportsbook === book);
  const line =
    basis === "latest" && marketStatus(row, book) !== "available"
      ? null
      : ((basis === "opening" ? market?.openingLine : market?.latestLine) ??
        null);
  if (
    (market && Date.parse(market.capturedAt) > Date.parse(at)) ||
    (row.featureCapturedAt &&
      Date.parse(row.featureCapturedAt) > Date.parse(at))
  )
    return neutral(
      "Unavailable",
      "The inputs or quote were not available at this ranking time.",
    );
  if (
    row.featureKind !== "captured_pregame" ||
    row.projectedFirstHalfTotal === null ||
    row.simpleTotal === null ||
    row.paceAdjustedTotal === null ||
    line === null
  )
    return neutral(
      "Unavailable",
      "A pregame projection, both components, and the selected line are required.",
    );
  const { edge, modelLean } = compareTotal(row.projectedFirstHalfTotal, line);
  if (modelLean === "PUSH")
    return neutral("No lean", "The projection equals the line.");
  if (edge >= 8)
    return neutral(
      "Outlier review",
      "An 8+ point model/line gap needs review; it is not automatically a stronger signal.",
    );
  const aligned =
    compareTotal(row.simpleTotal, line).modelLean === modelLean &&
    compareTotal(row.paceAdjustedTotal, line).modelLean === modelLean;
  const score = Math.round((edge / 8) * 100 * (aligned ? 1 : 0.5));
  return {
    method: "model-signal-v1",
    score,
    label: aligned ? "Aligned" : "Mixed",
    fill: signalFill(score),
    reason: `${edge.toFixed(2)}-point gap; ${aligned ? "scoring and pace components agree" : "components do not both agree"}. Research score, not a hit percentage.`,
  };
}
