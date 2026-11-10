import { describe, expect, it } from "vitest";
import { labFixture } from "./lab.test-fixture";
import { captureLab } from "./labCapture";
import { recordToCsv, updatePredictionRecord } from "./predictionRecord";
import { predictionsToCsv } from "./predictions";
import {
  labRating,
  predictionRating,
  ratingFallback,
  recordRating,
} from "./ratingDisplay";
import { recordFixture } from "./record.test-fixture";
import { predictionSignal, projectionSignal } from "./signals";

describe("explicit ratings and provenance", () => {
  it("preserves an original saved confidence and its frozen record", () => {
    const f = recordFixture();
    const record = updatePredictionRecord(f.store, f.feed, f.ledger, f.at)
      .records[0];
    const before = JSON.stringify(record);
    expect(recordRating(record)).toMatchObject({
      source: "saved",
      signal: record.signal,
    });
    expect(JSON.stringify(record)).toBe(before);
  });
  it("derives a missing older score from frozen components and the original line, never outcomes or current quotes", () => {
    const f = recordFixture();
    const record = updatePredictionRecord(f.store, f.feed, f.ledger, f.at)
      .records[0];
    record.signal = {
      ...record.signal,
      score: null,
      fill: null,
      label: "Closed",
      reason: "Scored after import.",
    };
    const expected = projectionSignal(
      record.prediction,
      record.comparison.line,
    );
    record.prediction.markets[0].latestLine = 90;
    record.prediction.actualFirstHalfTotal = 99;
    const before = JSON.stringify(record);
    const rating = recordRating(record);
    expect(rating).toMatchObject({
      source: "derived_saved_inputs",
      provenance: "Calculated later",
      signal: { score: expected.score },
    });
    expect(rating.signal.reason).toContain("original frozen pregame");
    expect(JSON.stringify(record)).toBe(before);
    expect(
      recordRating({
        ...record,
        prediction: { ...record.prediction, actualFirstHalfTotal: 45 },
      }),
    ).toEqual(rating);
    expect(record.signal.score).toBeNull();
    const csv = recordToCsv({ ...f.store, records: [record] }, [record.id]);
    expect(csv).toContain("display_score_source");
    expect(csv).toContain("derived_saved_inputs");
  });
  it("shows a review rating for extreme gaps without inventing a 100% score", () => {
    const f = recordFixture();
    const row = { ...f.feed.predictions[0], projectedFirstHalfTotal: 85 };
    const rating = predictionRating(row, "betmgm", "latest", f.at);
    expect(rating.signal).toMatchObject({
      label: "Outlier review",
      score: null,
    });
    expect(ratingFallback(rating.signal)).toBe("Review");
  });
  it("rates the displayed line after tipoff while keeping the original live ranking closed", () => {
    const f = recordFixture();
    const row = { ...f.feed.predictions[0], actualFirstHalfTotal: 80 };
    const at = "2026-11-03T02:00:00Z";
    expect(predictionSignal(row, "betmgm", "latest", at)).toMatchObject({
      label: "Closed",
      score: null,
    });
    const rating = predictionRating(row, "betmgm", "latest", at);
    expect(rating).toMatchObject({
      source: "displayed_line_after_tip",
      label: "Shown-line score",
    });
    expect(rating.signal.score).not.toBeNull();
    expect(
      predictionRating(
        { ...row, actualFirstHalfTotal: 50 },
        "betmgm",
        "latest",
        at,
      ),
    ).toEqual(rating);
    expect(predictionsToCsv([row], "betmgm", "latest", at)).toContain(
      "displayed_line_after_tip",
    );
  });
  it("keeps historical estimates explicit and missing/future inputs unavailable", () => {
    const f = recordFixture();
    const row = f.feed.predictions[0];
    expect(
      predictionRating(
        { ...row, featureKind: "reconstructed_season_debut" },
        "betmgm",
        "latest",
        f.at,
      ),
    ).toMatchObject({
      source: "historical_estimate",
      label: "Historical score",
    });
    expect(
      predictionRating({ ...row, markets: [] }, "betmgm", "latest", f.at).signal
        .score,
    ).toBeNull();
    expect(
      predictionRating(
        {
          ...row,
          actualFirstHalfTotal: 50,
          markets: [{ ...row.markets[0], capturedAt: "2026-11-03T03:00:00Z" }],
        },
        "betmgm",
        "latest",
        "2026-11-03T02:00:00Z",
      ).signal,
    ).toMatchObject({ score: null, label: "Unavailable" });
    expect(
      projectionSignal({ ...row, paceAdjustedTotal: null }, 70).score,
    ).toBeNull();
  });
  it("gives older Lab leans a derived rating while preserving their original stored strength", () => {
    const f = labFixture();
    const row = captureLab(
      f.empty,
      f.config,
      f.feed,
      f.ledger,
      f.inputs,
      f.at,
    ).forecasts.find((r) => r.methodId === "baseline-control-v1");
    if (!row) throw new Error("fixture");
    row.signalStrength = null;
    const before = JSON.stringify(row);
    expect(labRating(row).signal.score).not.toBeNull();
    expect(labRating(row).source).toBe("derived_saved_inputs");
    expect(JSON.stringify(row)).toBe(before);
    expect(labRating({ ...row, total: 90 }).signal).toMatchObject({
      label: "Outlier review",
      score: null,
    });
  });
});
