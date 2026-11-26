// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { updatePredictionRecord } from "./model/predictionRecord";
import { predictionRating } from "./model/ratingDisplay";
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
it("shows a binary decision without changing an older record's stored score", () => {
  const f = recordFixture();
  const record = updatePredictionRecord(f.store, f.feed, f.ledger, f.at)
    .records[0];
  record.signal = {
    ...record.signal,
    label: "Closed",
    score: null,
    fill: null,
  };
  render(
    <RecordTable
      records={[record]}
      results={[]}
      canonicalIds={[record.id]}
      showVersions={false}
    />,
  );
  const table = screen.getByRole("table", { name: "Recorded predictions" });
  expect(within(table).queryByText(/\d+%/)).toBeNull();
  expect(within(table).getByText("NO BET")).toBeTruthy();
  expect(record.signal.score).toBeNull();
});
