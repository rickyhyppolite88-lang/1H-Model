// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildRecordIndex,
  updatePredictionRecord,
} from "./model/predictionRecord";
import { generatePredictions } from "./model/predictions";
import { recordFixture } from "./model/record.test-fixture";
import PredictionRecord from "./PredictionRecord";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the shared win/loss record and exposes later versions without double counting", async () => {
  const f = recordFixture();
  let store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const quote = f.ledger.games[0].quotes[0].latest;
  if (!quote) throw new Error("fixture");
  quote.total = 73;
  store = updatePredictionRecord(
    store,
    generatePredictions(f.ledger, "2026-11-02T22:10:00Z"),
    f.ledger,
    "2026-11-02T22:10:00Z",
  );
  f.ledger.games[0].firstHalfComplete = true;
  f.ledger.games[0].away.firstHalfPoints = 36;
  f.ledger.games[0].home.firstHalfPoints = 36;
  store = updatePredictionRecord(
    store,
    generatePredictions(f.ledger, "2026-11-03T02:00:00Z"),
    f.ledger,
    "2026-11-03T02:00:00Z",
  );
  const index = buildRecordIndex(store);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => structuredClone(url.includes("index") ? index : store),
    })),
  );
  render(<PredictionRecord />);
  const table = await screen.findByRole("table", {
    name: "Recorded predictions",
  });
  expect(
    screen.getByRole("heading", { name: "Running prediction record" }),
  ).toBeTruthy();
  expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "all" },
  });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByText("Win")).toBeTruthy();
  expect(within(table).getByText("Loss")).toBeTruthy();
  expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Running record Excel ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record.xlsx");
  expect(
    screen
      .getByRole("link", { name: "Full dated inputs JSON ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record/2026-11-02.json");
  fireEvent.change(screen.getByLabelText("Search recorded matchups"), {
    target: { value: "not-these-teams" },
  });
  expect(
    screen.getByText("No recorded forecasts match these filters."),
  ).toBeTruthy();
});
