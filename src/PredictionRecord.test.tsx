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
  first.sportsbook = "draftkings";
  first.quotes = first.quotes.map((quote) => ({
    ...quote,
    sportsbook: "draftkings",
  }));
  first.prediction.markets = first.prediction.markets.map((market) => ({
    ...market,
    sportsbook: "draftkings",
  }));
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
  for (const [id, name] of [
    ["unpriced", "Unpriced team"],
    ["gap", "Missing inputs team"],
    ["review", "Unstaked review team"],
  ]) {
    store.records.push({
      ...first,
      id,
      gameId: id,
      prediction: {
        ...first.prediction,
        gameId: id,
        awayTeam: name,
        projectedFirstHalfTotal:
          id === "gap" ? null : first.prediction.projectedFirstHalfTotal,
      },
      state: id === "gap" ? "unavailable" : "pregame",
      comparison:
        id === "unpriced"
          ? { line: null, signedEdge: null, lean: null }
          : first.comparison,
      signal: {
        ...first.signal,
        score: null,
        label: id === "review" ? "Outlier review" : "Unavailable",
      },
    });
  }
  store.results = [first.gameId, "tuesday", "unpriced", "gap", "review"].map(
    (gameId) => ({
      id: `${gameId}-result`,
      season: first.season,
      gameId,
      observedAt: "2026-11-04T03:00:00Z",
      sourceCapturedAt: "2026-11-04T03:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    }),
  );
  return { store, index: buildRecordIndex(store) };
}

function unitFixture({ store, index }: ReturnType<typeof fixture>) {
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
  return { ledger, unitResults };
}
function mockArchives(failDate = "", source = fixture()) {
  const { store, index } = source;
  const { ledger, unitResults } = unitFixture({ store, index });
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

it("excludes upcoming games and clears search when selecting an unfinished day", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  expect(within(table()).queryByText("Upcoming team")).toBeNull();
  expect(screen.queryByLabelText("Record view")).toBeNull();
  fireEvent.change(screen.getByLabelText("Search recorded matchups"), {
    target: { value: "Monday" },
  });
  selectDate("2026-11-04");
  await screen.findByText(
    /No finished staked plays are recorded for 2026-11-04 yet/,
  );
  expect(within(summary()).getByText("0 / 0 / 0")).toBeTruthy();
  expect(
    (screen.getByLabelText("Search recorded matchups") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(within(table()).getAllByRole("row")).toHaveLength(1);
});

it("preserves saved versions and full archive downloads without inflating the official record", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  selectDate("2026-11-02");
  await screen.findByText("1 / 0 / 0");
  expect(within(table()).getAllByRole("row")).toHaveLength(2);
  expect(within(table()).getByText("Win")).toBeTruthy();
  expect(within(table()).queryByText("Loss")).toBeNull();
  expect(within(summary()).getByText("1 / 0 / 0")).toBeTruthy();
  fireEvent.click(screen.getByText("Source data and downloads"));
  expect(
    screen
      .getByRole("link", { name: "Full dated inputs JSON ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record/2026-11-02.json");
  expect(
    screen
      .getByRole("link", { name: "Complete forecast archive Excel ↓" })
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
  const { ledger, unitResults } = unitFixture({ store, index });
  let finish: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("unit-ledger")
          ? ledger
          : url.includes("unit-results")
            ? unitResults
            : url.includes("index")
              ? structuredClone(index)
              : url.includes("2026-11-03.json")
                ? new Promise((resolve) => {
                    finish = () =>
                      resolve(
                        structuredClone(recordForDate(store, "2026-11-03")),
                      );
                  })
                : structuredClone(
                    recordForDate(
                      store,
                      url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "",
                    ),
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
  expect(screen.queryByLabelText("Record view")).toBeNull();
  expect(within(table()).getByText("Tuesday team")).toBeTruthy();
  expect(within(table()).queryByText("Monday team")).toBeNull();
  expect(within(table()).getByText("-0.50u")).toBeTruthy();
  expect(within(table()).getByText(/-105/)).toBeTruthy();
});

it("shows only staked original plays in both the record table and its summary, including when an old all-versions preference was saved", async () => {
  localStorage.setItem(
    "1h-model-view-v1:record.view",
    JSON.stringify({ savedAt: Date.now(), value: "all" }),
  );
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  expect(within(table()).getAllByRole("row")).toHaveLength(3);
  for (const name of [
    "Unpriced team",
    "Missing inputs team",
    "Unstaked review team",
  ])
    expect(within(table()).queryByText(name)).toBeNull();
  expect(within(summary()).getByText("1 / 1 / 0")).toBeTruthy();
  expect(within(summary()).getAllByText("2")).toHaveLength(2);
  expect(screen.queryByLabelText("Record view")).toBeNull();
});

it("keeps the full record unavailable if stakes fail to load instead of showing unfiltered games", async () => {
  const fetcher = mockArchives();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("unit-")
        ? { ok: false, json: async () => ({}) }
        : fetcher(url),
    ),
  );
  render(<PredictionRecord />);
  await screen.findByText(/Unit stakes could not be refreshed/);
  expect(
    screen.queryByRole("table", { name: "Recorded predictions" }),
  ).toBeNull();
  expect(within(summary()).queryByText("1 / 1 / 0")).toBeNull();
});

it("shows the single DraftKings timeline and ignores the old sportsbook view preference", async () => {
  const source = fixture();
  const tuesday = source.store.records.find((row) => row.id === "tuesday");
  if (!tuesday) throw new Error("Missing Tuesday fixture");
  tuesday.sportsbook = "draftkings";
  tuesday.quotes = tuesday.quotes.map((quote) => ({
    ...quote,
    sportsbook: "draftkings",
  }));
  source.index = buildRecordIndex(source.store);
  localStorage.setItem(
    "1h-model-view-v1:record.group.original-books-v1",
    JSON.stringify({
      savedAt: Date.now(),
      value: "2026-27:season-bridge-v1:betmgm:latest",
    }),
  );
  mockArchives("", source);
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  expect(screen.queryByLabelText("Record season / model")).toBeNull();
  expect(within(summary()).getByText("1 / 1 / 0")).toBeTruthy();
  expect(within(table()).getAllByText("DraftKings")).toHaveLength(2);
});

it("dismisses a selected day from blank space without dismissing clicks on plays or controls", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  selectDate("2026-11-03");
  await screen.findByText("0 / 1 / 0");
  fireEvent.click(within(table()).getByText("Tuesday team"));
  fireEvent.click(screen.getByLabelText("Search recorded matchups"));
  expect(
    (screen.getByLabelText("Daily breakdown (ET)") as HTMLSelectElement).value,
  ).toBe("2026-11-03");
  fireEvent.click(document.body);
  await screen.findByText("1 / 1 / 0");
  expect(
    (screen.getByLabelText("Daily breakdown (ET)") as HTMLSelectElement).value,
  ).toBe("all");
  expect(within(table()).getByText("Monday team")).toBeTruthy();
  selectDate("2026-11-02");
  await screen.findByText("1 / 0 / 0");
  fireEvent.click(
    screen.getByRole("button", { name: /2026-11-01: .*no plays/ }),
  );
  await screen.findByText("1 / 1 / 0");
});

it("can dismiss a daily record with Escape", async () => {
  mockArchives();
  render(<PredictionRecord />);
  await screen.findByRole("table", { name: "Recorded predictions" });
  selectDate("2026-11-02");
  await screen.findByText("1 / 0 / 0");
  fireEvent.keyDown(document, { key: "Escape" });
  await screen.findByText("1 / 1 / 0");
});

it("never falls back to another book if the DraftKings calendar feed is unavailable or mismatched", async () => {
  const fetcher = mockArchives();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const response = await fetcher(url);
      if (!url.includes("unit-results-draftkings")) return response;
      const result = await response.json();
      return {
        ok: true,
        json: async () => ({
          ...result,
          plays: [
            {
              ...(result as { plays: object[] }).plays[0],
              sportsbook: "betmgm",
            },
          ],
        }),
      };
    }),
  );
  render(<PredictionRecord />);
  await screen.findByText(/Unit stakes could not be refreshed/);
  expect(
    screen.queryByRole("table", { name: "Recorded predictions" }),
  ).toBeNull();
});
