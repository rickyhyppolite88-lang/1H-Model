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
  recordForDate,
  updatePredictionRecord,
} from "./model/predictionRecord";
import { generatePredictions } from "./model/predictions";
import { recordFixture } from "./model/record.test-fixture";
import PredictionRecord from "./PredictionRecord";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T15:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("defaults to the full history and keeps historical and unavailable games visible in daily drilldown", async () => {
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const base = store.records[0];
  store.records.push(
    {
      ...base,
      id: "historical",
      gameId: "historical",
      state: "historical",
      recordedAt: "2026-11-03T02:00:00Z",
      prediction: {
        ...base.prediction,
        gameId: "historical",
        awayTeam: "Historical team",
      },
    },
    {
      ...base,
      id: "missing",
      gameId: "missing",
      state: "unavailable",
      prediction: {
        ...base.prediction,
        gameId: "missing",
        awayTeam: "Missing stats team",
        projectedFirstHalfTotal: null,
      },
    },
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
    (screen.getByLabelText("Record view") as HTMLSelectElement).value,
  ).toBe("games");
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  expect(within(table).getByText("Missing model inputs")).toBeTruthy();
  expect(within(table).getByText("Historical estimate")).toBeTruthy();
  expect(
    screen
      .getByRole("tab", { name: "Full record" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.queryByLabelText("Game date (ET)")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Record for 2026-11-02" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "View record for 2026-11-02" }),
  );
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  const dailyTable = await screen.findByRole("table", {
    name: "Recorded predictions",
  });
  expect(
    screen.queryByRole("region", { name: "Full record summary" }),
  ).toBeNull();
  expect(within(dailyTable).getAllByRole("row")).toHaveLength(4);
  expect(
    screen
      .getByRole("link", { name: "Download this day’s record CSV ↓" })
      .getAttribute("href"),
  ).toContain("2026-11-02-games.csv");
  expect(screen.getByText(/3 games in this view/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "official" },
  });
  expect(within(dailyTable).getAllByRole("row")).toHaveLength(2);
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
  expect(
    within(
      screen.getByRole("region", { name: "Full record summary" }),
    ).getByText("1 / 0 / 0"),
  ).toBeTruthy();
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "all" },
  });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByText("Win")).toBeTruthy();
  expect(within(table).getByText("Loss")).toBeTruthy();
  expect(
    within(
      screen.getByRole("region", { name: "Full record summary" }),
    ).getByText("1 / 0 / 0"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Running record Excel ↓" })
      .getAttribute("href"),
  ).toContain("prediction-record.xlsx");
  fireEvent.click(screen.getByRole("tab", { name: "By day" }));
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  expect(
    (screen.getByLabelText("Record view") as HTMLSelectElement).value,
  ).toBe("games");
  fireEvent.click(screen.getByText("Source data and downloads"));
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

function multiDayFixture() {
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
      },
    },
    {
      ...first,
      id: "wednesday",
      gameId: "wednesday",
      gameDate: "2026-11-04",
      recordedAt: "2026-11-04T12:00:00Z",
      prediction: {
        ...first.prediction,
        gameId: "wednesday",
        awayTeam: "Wednesday team",
        startsAt: "2026-11-05T00:00:00Z",
      },
    },
  );
  store.results = [
    {
      id: "monday-win",
      season: first.season,
      gameId: first.gameId,
      observedAt: "2026-11-03T03:00:00Z",
      sourceCapturedAt: "2026-11-03T03:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    },
    {
      id: "tuesday-loss",
      season: first.season,
      gameId: "tuesday",
      observedAt: "2026-11-04T03:00:00Z",
      sourceCapturedAt: "2026-11-04T03:00:00Z",
      awayPoints: 33,
      homePoints: 33,
      source: "https://example.com/results",
    },
  ];
  return { store, index: buildRecordIndex(store) };
}

it("shows all dates on the page and drills down without retaining another day's filters or totals", async () => {
  const { store, index } = multiDayFixture();
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      structuredClone(
        url.includes("index")
          ? index
          : recordForDate(store, url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""),
      ),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<PredictionRecord />);
  const full = await screen.findByRole("table", {
    name: "Recorded predictions",
  });
  expect(within(full).getAllByRole("row")).toHaveLength(4);
  expect(within(full).getByText("Monday team")).toBeTruthy();
  expect(within(full).getByText("Tuesday team")).toBeTruthy();
  expect(within(full).getByText("Wednesday team")).toBeTruthy();
  expect(
    within(
      screen.getByRole("region", { name: "Full record summary" }),
    ).getByText("1 / 1 / 0"),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search recorded matchups"), {
    target: { value: "Monday" },
  });
  fireEvent.change(screen.getByLabelText("Record view"), {
    target: { value: "settled" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "View record for 2026-11-03" }),
  );
  await screen.findByRole("region", { name: "Record for 2026-11-03" });
  const day = await screen.findByRole("table", {
    name: "Recorded predictions",
  });
  expect(within(day).getAllByRole("row")).toHaveLength(2);
  expect(within(day).queryByText("Monday team")).toBeNull();
  expect(within(day).getByText("Tuesday team")).toBeTruthy();
  expect(
    within(
      screen.getByRole("region", { name: "Record for 2026-11-03" }),
    ).getByText("0 / 1 / 0"),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Daily breakdown" })).toBeNull();
  expect(
    (screen.getByLabelText("Search recorded matchups") as HTMLInputElement)
      .value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Record view") as HTMLSelectElement).value,
  ).toBe("games");
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  expect(
    (screen.getByRole("button", { name: "Previous day" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  await screen.findByRole("region", { name: "Record for 2026-11-03" });
  fireEvent.click(screen.getByRole("button", { name: /Back to full record/ }));
  const again = await screen.findByRole("table", {
    name: "Recorded predictions",
  });
  expect(within(again).getAllByRole("row")).toHaveLength(4);
  fireEvent.click(
    screen.getByRole("button", { name: /View day 2026-11-02 for Monday/ }),
  );
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  expect(
    fetcher.mock.calls.filter(([url]) => url.includes("prediction-record/"))
      .length,
  ).toBe(3);
});

it("does not show a partial full history when an archive fails and allows recovery or another day", async () => {
  const { store, index } = multiDayFixture();
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: !(fail && url.includes("2026-11-02.json")),
      json: async () =>
        structuredClone(
          url.includes("index")
            ? index
            : recordForDate(store, url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""),
        ),
    })),
  );
  render(<PredictionRecord />);
  await screen.findByText(
    "The full record could not load all dates. No partial history is shown.",
  );
  expect(
    screen.queryByRole("table", { name: "Recorded predictions" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "By day" }));
  await screen.findByRole("region", { name: "Record for 2026-11-04" });
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-02" },
  });
  await screen.findByText("The selected day’s record could not be loaded.");
  expect(
    screen.queryByRole("region", { name: "Record for 2026-11-04" }),
  ).toBeNull();
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading records" }),
  );
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
});

it("ignores slow responses after switching from full history to another day", async () => {
  const { store, index } = multiDayFixture();
  const finish: Array<() => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("index")
          ? structuredClone(index)
          : url.includes("2026-11-04.json")
            ? new Promise((resolve) => {
                finish.push(() =>
                  resolve(structuredClone(recordForDate(store, "2026-11-04"))),
                );
              })
            : structuredClone(
                recordForDate(store, url.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""),
              ),
    })),
  );
  render(<PredictionRecord />);
  await screen.findByRole("region", { name: "Full record summary" });
  await vi.waitFor(() => expect(finish.length).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "By day" }));
  await vi.waitFor(() => expect(finish.length).toBe(2));
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-02" },
  });
  await screen.findByRole("region", { name: "Record for 2026-11-02" });
  await act(async () => {
    for (const resolve of finish) resolve();
  });
  expect(
    screen.queryByRole("region", { name: "Record for 2026-11-04" }),
  ).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Full record summary" }),
  ).toBeNull();
  const table = screen.getByRole("table", { name: "Recorded predictions" });
  expect(within(table).getByText("Monday team")).toBeTruthy();
  expect(within(table).queryByText("Wednesday team")).toBeNull();
});
