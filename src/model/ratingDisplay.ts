import type { LabForecast } from "./lab";
import { marketStatus } from "./marketCoverage";
import type { ForecastRecord } from "./predictionRecord";
import type { LineBasis, PredictionRow } from "./predictions";
import {
  type ModelSignal,
  predictionSignal,
  projectionSignal,
} from "./signals";

export type RatingDisplay = {
  signal: ModelSignal;
  source:
    | "live"
    | "saved"
    | "derived_saved_inputs"
    | "displayed_line_after_tip"
    | "historical_estimate";
  label: string;
  provenance?: string;
};

export function ratingFallback(signal: ModelSignal) {
  return {
    "Outlier review": "Review",
    Closed: "Closed",
    Reconstructed: "Historical",
    "No lean": "No lean",
    Unavailable: "Needs inputs",
    Aligned: "Review",
    Mixed: "Review",
  }[signal.label];
}

export function predictionRating(
  row: PredictionRow,
  book: string,
  basis: LineBasis,
  at: string,
): RatingDisplay {
  const signal = predictionSignal(row, book, basis, at);
  if (signal.label !== "Closed" && signal.label !== "Reconstructed")
    return { signal, source: "live", label: "Confidence" };
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
    return {
      signal: {
        ...signal,
        score: null,
        label: "Unavailable",
        reason:
          "The quote or model inputs were not yet observed at this display time.",
      },
      source: "live",
      label: "Confidence",
    };
  const calculated = projectionSignal(row, line);
  if (calculated.label === "Unavailable" || calculated.label === "No lean")
    return { signal: calculated, source: "live", label: "Confidence" };
  const historical = row.featureKind !== "captured_pregame";
  return {
    signal: {
      ...calculated,
      reason: `${historical ? "Historical estimate" : "Calculated after tipoff"} using only the displayed projection, its components and the displayed line. This is not a saved pregame confidence. ${calculated.reason}`,
    },
    source: historical ? "historical_estimate" : "displayed_line_after_tip",
    label: historical ? "Historical score" : "Shown-line score",
    provenance: historical ? "Historical estimate" : "After tip · shown line",
  };
}

export function recordRating(record: ForecastRecord): RatingDisplay {
  if (record.replay)
    return {
      signal: projectionSignal(record.prediction, record.comparison.line),
      source: "derived_saved_inputs",
      label: "Replay confidence",
      provenance: "Calculated later · DraftKings replay",
    };
  if (record.signal.score !== null || record.signal.label === "Outlier review")
    return {
      signal: record.signal,
      source: "saved",
      label: "Saved confidence",
    };
  const calculated = projectionSignal(
    record.prediction,
    record.comparison.line,
  );
  if (calculated.label === "Unavailable" || calculated.label === "No lean")
    return { signal: calculated, source: "saved", label: "Confidence" };
  const pregame =
    record.state === "pregame" &&
    record.prediction.featureKind === "captured_pregame" &&
    Date.parse(record.recordedAt) < Date.parse(record.prediction.startsAt);
  return {
    signal: {
      ...calculated,
      reason: `${pregame ? "Calculated later from the original frozen pregame projection, components and saved entry line" : "Calculated from the historical estimate and its saved line"}. The original stored confidence remains unchanged; no outcome or current line is used. ${calculated.reason}`,
    },
    source: pregame ? "derived_saved_inputs" : "historical_estimate",
    label: pregame ? "Derived confidence" : "Historical score",
    provenance: pregame ? "Calculated later" : "Historical estimate",
  };
}

export function labRating(row: LabForecast): RatingDisplay {
  const calculated = projectionSignal(
    {
      projectedFirstHalfTotal: row.total,
      simpleTotal: row.simpleTotal,
      paceAdjustedTotal: row.paceTotal,
    },
    row.line,
  );
  if (
    row.signalStrength === null &&
    (calculated.label === "Unavailable" || calculated.label === "No lean")
  )
    return { signal: calculated, source: "saved", label: "Strength / 100" };
  if (row.signalStrength !== null)
    return {
      signal: {
        ...calculated,
        score: row.signalStrength,
        reason: `Original saved Lab strength. ${row.reason}`,
      },
      source: "saved",
      label: "Saved strength / 100",
    };
  if (calculated.label === "Outlier review")
    return { signal: calculated, source: "saved", label: "Strength / 100" };
  return {
    signal: {
      ...calculated,
      reason: `Calculated later using only the frozen Lab total, components and entry line; the stored strength is unchanged. ${calculated.reason}`,
    },
    source: "derived_saved_inputs",
    label: "Derived strength / 100",
    provenance: "Calculated later",
  };
}
