// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildRecordIndex,
  canonicalRecords,
  recordForDate,
  updatePredictionRecord,
} from "./model/predictionRecord";
import { recordFixture } from "./model/record.test-fixture";
import { actualUnitPlay, type UnitLedger } from "./model/units";
import PredictionRecord from "./PredictionRecord";

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixture() {
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const first = store.records[0];
  first.prediction.awayTeam = "Monday team";
  store.updatedAt = "2026-11-04T14:00:00Z";
  store.records.push(
    {
      ...first,
      id: "tuesday",
      gameId: "tuesday",
      gameDate: "2026-11-03",
      recordedAt: "2026-11-03T22:00:00Z",
      prediction: {
        ...first.prediction,
        gameId: "tuesday",
        awayTeam: "Tuesday team",
        startsAt: "2026-11-04T00:00:00Z",
        projectedFirstHalfTotal: 68,
      },
      comparison: { ...first.comparison, lean: "UNDER" },
    },
    {
      ...first,
      id: "upcoming",
      gameId: "upcoming",
      gameDate: "2026-11-04",
      recordedAt: "2026-11-04T12:00:00Z",
      prediction: {
        ...first.prediction,
        gameId: "upcoming",
        awayTeam: "Upcoming team",
        startsAt: "2026-11-05T00:00:00Z",
      },
    },
    {
      ...first,
      id: "later",
      version: 2,
      recordedAt: "2026-11-02T22:10:00Z",
      comparison: { ...first.comparison, line: 73 },
    },
  );
  store.results = [first.gameId, "tuesday"].map((gameId) => ({
    id: `${gameId}-result`,
    season: first.season,
    gameId,
    observedAt: "2026-11-04T03:00:00Z",
    sourceCapturedAt: "2026-11-04T03:00:00Z",
    awayPoints: 36,
    homePoints: 36,
    source: "https://example.com/results",
  }));
  return { store, index: buildRecordIndex(store) };
}

function mockArchives(failDate = "") {
  const { store, index } = fixture();
  const ledger: UnitLedger = {
    schemaVersion: 1,
    startedAt: index.updatedAt,
    updatedAt: index.updatedAt,
    assignments: [],
  };
  const unitResults = {
    schemaVersion: 1,
    updatedAt: index.updatedAt,
    plays: canonicalRecords(store.records).map((row) =>
      actualUnitPlay(row, store.results, ledger),
    ),
  };
  const fetcher = vi.fn(async (url: string) => ({
    ok: !failDate || !url.includes(`${failDate}.json`),
    json: async () =>
      structuredClone(
        url.includes("unit-ledger")
          ? ledger
          : url.includes("unit-results")
            ? unitResults
            : url.includes("index")
              ? index
              : recordForDate(store, url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""),
      ),
  }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const table = () => screen.getByRole("table", { name: "Recorded predictions" });
const summary = () =>
  screen.getByRole("region", { name: "Full record summary" });
function selectDate(date: string) {
  fireEvent.change(screen.getByLabelText("Daily breakdown (ET)"), {
    target: { value: date },
  });
}

it("shows finished first halves and updates the same summary box from the daily dropdown", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  const box = summary();
  expect(within(box).getByText("1 / 1 / 0")).toBeTruthy();
  expect(within(box).getByText("50.0%")).toBeTruthy();
  expect(within(table()).getAllByRole("row")).toHaveLength(3);
  expect(within(table()).queryByText("Upcoming team")).toBeNull();
  expect(within(table()).getByText("UNDER").className).toContain("lean-under");
  expect(within(table()).getByText("OVER").className).toContain("lean-over");
  expect(screen.queryByRole("tab", { name: "By day" })).toBeNull();
  expect(screen.queryByRole("button", { name: /View record for/ })).toBeNull();
  selectDate("2026-11-03");
  await screen.findByText("0 / 1 / 0");
  expect(summary()).toBe(box);
  expect(within(table()).getByText("Tuesday team")).toBeTruthy();
  expect(within(table()).queryByText("Monday team")).toBeNull();
  selectDate("all");
  await screen.findByText("1 / 1 / 0");
});

it("excludes upcoming games in every view and clears filters when selecting an unfinished day", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  for (const value of ["all", "official", "games"]) {
    fireEvent.change(screen.getByLabelText("Record view"), {
      target: { value },
    });
    expect(within(table()).queryByText("Upcoming team")).toBeNull();
  }
  fireEvent.change(screen.getByLabelText("Search recorded matchups"), {
    target: { value: "Monday" },
  });
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "all" },
  });
  selectDate("2026-11-04");
  await screen.findByText(
    /No finished first-half results are recorded for 2026-11-04 yet/,
  );
  expect(within(summary()).getByText("0 / 0 / 0")).toBeTruthy();
  expect(
    (screen.getByLabelText("Search recorded matchups") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Record view") as HTMLSelectElement).value,
  ).toBe("games");
  expect(within(table()).getAllByRole("row")).toHaveLength(1);
});

it("preserves saved versions and full archive downloads without inflating the official record", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  selectDate("2026-11-02");
  await screen.findByText("1 / 0 / 0");
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "all" },
  });
  expect(within(table()).getAllByRole("row")).toHaveLength(3);
  expect(within(table()).getByText("Win")).toBeTruthy();
  expect(within(table()).getByText("Loss")).toBeTruthy();
  expect(within(summary()).getByText("1 / 0 / 0")).toBeTruthy();
  fireEvent.click(screen.getByText("Source data and downloads"));
  expect(
    screen
      .getByRole("link", { name: "Full dated inputs JSON ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record/2026-11-02.json");
  expect(
    screen
      .getByRole("link", { name: "Running record Excel ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record.xlsx");
});

it("never shows partial totals when an archive fails and can retry", async () => {
  mockArchives("2026-11-02");
  render(<PredictionRecord />);
  await screen.findByText(
    "The full record could not load all dates. No partial history is shown.",
  );
  expect(
    screen.queryByRole("table", { name: "Recorded predictions" }),
  ).toBeNull();
  expect(within(summary()).queryByText("1 / 1 / 0")).toBeNull();
  mockArchives();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading records" }),
  );
  await screen.findByText("1 / 1 / 0");
  expect(within(table()).getByText("Monday team")).toBeTruthy();
});

it("ignores slow full-history responses after selecting another day", async () => {
  const { store, index } = fixture();
  let finish: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("index")
          ? structuredClone(index)
          : url.includes("2026-11-03.json")
            ? new Promise((resolve) => {
                finish = () =>
                  resolve(structuredClone(recordForDate(store, "2026-11-03")));
              })
            : structuredClone(
                recordForDate(store, url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""),
              ),
    })),
  );
  render(<PredictionRecord />);
  await screen.findByLabelText("Daily breakdown (ET)");
  await vi.waitFor(() => expect(finish).toBeDefined());
  selectDate("2026-11-02");
  await screen.findByText("1 / 0 / 0");
  await act(async () => finish?.());
  expect(within(summary()).getByText("1 / 0 / 0")).toBeTruthy();
  expect(within(table()).getByText("Monday team")).toBeTruthy();
  expect(within(table()).queryByText("Tuesday team")).toBeNull();
});

it("opens a calendar day with that day's original graded picks, saved odds, stake and net units", async () => {
  mockArchives();
  render(<PredictionRecord />);
  fireEvent.click(
    await screen.findByRole("button", { name: "2026-11-03: -0.50u" }),
  );
  await screen.findByText("0 / 1 / 0");
  expect(
    (screen.getByLabelText("Record view") as HTMLSelectElement).value,
  ).toBe("official");
  expect(within(table()).getByText("Tuesday team")).toBeTruthy();
  expect(within(table()).queryByText("Monday team")).toBeNull();
  expect(within(table()).getByText("-0.50u")).toBeTruthy();
  expect(within(table()).getByText(/-105/)).toBeTruthy();
});
