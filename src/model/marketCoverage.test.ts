import { expect, it } from "vitest";
import { describeLineMovement } from "./lineMovement";
import { marketStatus, marketStatusLabel } from "./marketCoverage";
import { buildRecordIndex, updatePredictionRecord } from "./predictionRecord";
import {
  generatePredictions,
  predictionComparison,
  predictionsToCsv,
} from "./predictions";
import { recordFixture } from "./record.test-fixture";
import { predictionSignal } from "./signals";

it.each(["no_current_line", "not_in_feed", "not_matched"] as const)(
  "retains history but suppresses a quote no longer in the current feed: %s",
  (status) => {
    const { ledger, at } = recordFixture();
    ledger.games[0].marketCoverage = {
      checkedAt: at,
      source: "https://example.com/odds",
      status: status === "not_matched" ? "not_matched" : "matched",
      books:
        status === "no_current_line" ? [{ sportsbook: "betmgm", status }] : [],
    };
    const feed = generatePredictions(ledger, at);
    const row = feed.predictions[0];
    expect(ledger.games[0].quotes[0].latest?.total).toBe(70);
    expect(row.markets[0].openingLine).toBe(70);
    expect(row.markets[0].latestLine).toBeNull();
    expect(marketStatus(row, "betmgm")).toBe(status);
    expect(predictionComparison(row, "betmgm", "latest").lean).toBeNull();
    expect(predictionSignal(row, "betmgm", "latest", at).score).toBeNull();
    expect(describeLineMovement(row, "betmgm").current).toBeNull();
    expect(predictionsToCsv([row])).toContain(marketStatusLabel(row, "betmgm"));
  },
);

it("does not label a legacy missing quote as proof it was never posted", () => {
  const row = recordFixture().feed.predictions[0];
  row.markets = [];
  expect(marketStatus(row, "betmgm")).toBe("not_checked");
  expect(marketStatusLabel(row, "betmgm")).toContain("unknown");
});

it("records a usable line returning at the same total, without counting an old retained quote", () => {
  const { ledger, store, at } = recordFixture();
  ledger.games[0].marketCoverage = {
    checkedAt: at,
    source: "https://example.com/odds",
    status: "matched",
    books: [],
  };
  const first = updatePredictionRecord(
    store,
    generatePredictions(ledger, at),
    ledger,
    at,
  );
  expect(first.records[0].comparison.line).toBeNull();
  expect(buildRecordIndex(first).canonicalIds).toHaveLength(0);
  const later = "2026-11-02T22:30:00Z";
  ledger.games[0].marketCoverage = {
    ...ledger.games[0].marketCoverage,
    checkedAt: later,
    books: [{ sportsbook: "betmgm", status: "available" }],
  };
  const next = updatePredictionRecord(
    first,
    generatePredictions(ledger, later),
    ledger,
    later,
  );
  expect(next.records).toHaveLength(2);
  expect(next.records[1].comparison.line).toBe(70);
  expect(buildRecordIndex(next).canonicalIds).toEqual([next.records[1].id]);
  const checkedAgain = "2026-11-02T22:40:00Z";
  ledger.games[0].marketCoverage.checkedAt = checkedAgain;
  expect(
    updatePredictionRecord(
      next,
      generatePredictions(ledger, checkedAgain),
      ledger,
      checkedAgain,
    ).records,
  ).toHaveLength(2);
});
