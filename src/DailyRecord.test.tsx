// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DailyRecord from "./DailyRecord";
import {
  buildRecordIndex,
  type RecordStore,
  recordForDate,
  updatePredictionRecord,
} from "./model/predictionRecord";
import { recordFixture } from "./model/record.test-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture() {
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const base = store.records[0];
  store.records.push({
    ...base,
    id: "next-day",
    gameId: "next-day",
    gameDate: "2026-11-03",
    recordedAt: "2026-11-03T22:00:00Z",
    prediction: {
      ...base.prediction,
      gameId: "next-day",
      startsAt: "2026-11-04T00:00:00Z",
    },
  });
  store.results = [
    {
      id: "win",
      season: base.season,
      gameId: base.gameId,
      observedAt: "2026-11-03T03:00:00Z",
      sourceCapturedAt: "2026-11-03T03:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    },
    {
      id: "loss",
      season: base.season,
      gameId: "next-day",
      observedAt: "2026-11-04T03:00:00Z",
      sourceCapturedAt: "2026-11-04T03:00:00Z",
      awayPoints: 33,
      homePoints: 33,
      source: "https://example.com/results",
    },
  ];
  return {
    store,
    index: buildRecordIndex(store),
    scope: {
      season: base.season,
      modelVersion: base.modelVersion,
      sportsbook: base.sportsbook,
      basis: base.basis,
    },
  };
}

it("clears the previous day's numbers immediately and loads the new day's original-line record", async () => {
  const { store, index, scope } = fixture();
  let complete: ((store: RecordStore) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("index")
          ? structuredClone(index)
          : url.includes("2026-11-03.json")
            ? new Promise<RecordStore>((resolve) => {
                complete = resolve;
              })
            : structuredClone(recordForDate(store, "2026-11-02")),
    })),
  );
  const { rerender } = render(<DailyRecord date="2026-11-02" {...scope} />);
  await screen.findByText("1 / 0 / 0");
  const first = screen.getByRole("region", { name: "Record for 2026-11-02" });
  expect(within(first).getByText("100.0%")).toBeTruthy();
  rerender(<DailyRecord date="2026-11-03" {...scope} />);
  const next = screen.getByRole("region", { name: "Record for 2026-11-03" });
  expect(within(next).queryByText("1 / 0 / 0")).toBeNull();
  expect(within(next).getByText("Loading this day’s record…")).toBeTruthy();
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  complete?.(recordForDate(store, "2026-11-03"));
  await screen.findByText("0 / 1 / 0");
  const completed = screen.getByRole("region", {
    name: "Record for 2026-11-03",
  });
  expect(within(completed).getByText("0.0%")).toBeTruthy();
  expect(
    within(completed)
      .getByRole("link", { name: /Download this day’s record CSV/ })
      .getAttribute("href"),
  ).toContain("2026-11-03-games.csv");
});

it("shows an absent archive and a failed request explicitly rather than displaying zero losses", async () => {
  const { index, scope } = fixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(index) })),
  );
  const { rerender } = render(<DailyRecord date="2026-11-04" {...scope} />);
  await screen.findByText("No saved record is available for this date yet.");
  expect(screen.queryByText("0 / 0 / 0")).toBeNull();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  rerender(<DailyRecord date="2026-11-05" {...scope} />);
  await screen.findByText(
    "The daily record could not be loaded. Try refreshing the page.",
  );
  expect(screen.queryByText("0 / 0 / 0")).toBeNull();
});
