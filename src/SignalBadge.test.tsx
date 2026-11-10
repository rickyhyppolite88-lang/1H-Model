// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { updatePredictionRecord } from "./model/predictionRecord";
import { predictionRating, recordRating } from "./model/ratingDisplay";
import { recordFixture } from "./model/record.test-fixture";
import RecordTable from "./RecordTable";
import SignalBadge from "./SignalBadge";

afterEach(cleanup);
it("renders Review rather than an empty confidence value for an outlier lean", () => {
  const f = recordFixture();
  const row = { ...f.feed.predictions[0], projectedFirstHalfTotal: 85 };
  render(<SignalBadge {...predictionRating(row, "betmgm", "latest", f.at)} />);
  expect(screen.getByText("Review")).toBeTruthy();
  expect(screen.queryByText("—")).toBeNull();
  expect(screen.queryByText("100%")).toBeNull();
  expect(screen.getByTitle(/8\+ point model\/line gap/)).toBeTruthy();
});
it("shows an older record's derived percentage and visible provenance without changing its stored score", () => {
  const f = recordFixture();
  const record = updatePredictionRecord(f.store, f.feed, f.ledger, f.at)
    .records[0];
  record.signal = {
    ...record.signal,
    label: "Closed",
    score: null,
    fill: null,
  };
  const score = recordRating(record).signal.score;
  render(
    <RecordTable
      records={[record]}
      results={[]}
      canonicalIds={[record.id]}
      showVersions={false}
    />,
  );
  const table = screen.getByRole("table", { name: "Recorded predictions" });
  expect(within(table).getByText(`${score}%`)).toBeTruthy();
  expect(within(table).getByText("Derived confidence")).toBeTruthy();
  expect(within(table).getByText("Calculated later")).toBeTruthy();
  expect(record.signal.score).toBeNull();
});
