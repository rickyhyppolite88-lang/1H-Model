// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Lab from "./Lab";
import { type LabIndex, labIndexSchema } from "./model/lab";
import { currentLabFixture } from "./model/lab.test-fixture";
import { captureLab } from "./model/labCapture";
import PredictionRecord from "./PredictionRecord";

vi.mock("./ActualPredictionRecord", () => ({
  default: () => <div>Existing actual record</div>,
}));

function uiFixture() {
  const f = currentLabFixture();
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  store.startedAt = "2026-11-02T20:00:00Z";
  const base = store.forecasts.find(
    (row) => row.methodId === "enhanced-baseline-v2",
  );
  if (!base) throw new Error("fixture");
  const finished = {
    ...base,
    id: "finished-v1",
    gameId: "finished",
    awayTeam: "Finished team",
    startsAt: "2026-11-02T21:00:00Z",
    recordedAt: "2026-11-02T20:00:00Z",
  };
  const watch = {
    ...finished,
    id: "watch-v1",
    gameId: "watch",
    awayTeam: "Watch team",
    status: "watch_only" as const,
  };
  store.forecasts.push(finished, watch, {
    ...finished,
    id: "finished-bonus",
    methodId: "bonus-exposure-v1",
    total: null,
    side: null,
    signalStrength: null,
    status: "measurement",
    bonusMinutes: 12,
    bonusBaselineMinutes: 10,
  });
  store.results = [finished, watch].map((row) => ({
    id: `${row.gameId}-result`,
    gameId: row.gameId,
    season: row.season,
    startsAt: row.startsAt,
    observedAt: "2026-11-02T21:45:00Z",
    sourceCapturedAt: "2026-11-02T21:45:00Z",
    source: "https://example.com/results",
    awayPoints: 36,
    homePoints: 36,
  }));
  store.halves = [
    {
      ...f.inputs.halves[0],
      id: "actual-half",
      gameId: "finished",
      startsAt: finished.startsAt,
      observedAt: "2026-11-02T21:45:00Z",
      teams: f.inputs.halves[0].teams.map((team) => ({ ...team, points: 36 })),
    },
  ];
  const index: LabIndex = labIndexSchema.parse({
    schemaVersion: 1,
    startedAt: store.startedAt,
    updatedAt: f.at,
    config: f.config,
    rawCoverage: { games: 238, errors: 0 },
    games: [
      {
        gameId: "game",
        startsAt: base.startsAt,
        status: "Scheduled",
        firstHalfComplete: false,
      },
      {
        gameId: "finished",
        startsAt: finished.startsAt,
        status: "In Progress",
        firstHalfComplete: true,
      },
    ],
    archives: [
      {
        date: "2026-11-02",
        jsonPath: "data/lab/2026-11-02.json",
        csvPath: "data/lab/2026-11-02.csv",
        games: 3,
      },
    ],
  });
  return { store, index };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T22:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("shows upcoming research and explicit method descriptions without probability claims", async () => {
  const { store, index } = uiFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(url.includes("lab-index") ? index : store),
    })),
  );
  render(<Lab />);
  const table = await screen.findByRole("table", { name: "Lab forecasts" });
  expect(within(table).getByText("Team A")).toBeTruthy();
  expect(within(table).queryByText("Finished team")).toBeNull();
  expect(screen.getByText(/1.5 ≤ absolute edge < 8/)).toBeTruthy();
  expect(
    screen.getByText(/signal strength is not a win probability/),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: /Pause \/ resume shared collection/ })
      .getAttribute("href"),
  ).toContain("actions/workflows/pages.yml");
  expect(within(table).queryByText(/48%/)).toBeNull();
  const comparison = screen.getByRole("table", {
    name: "Lab component comparison",
  });
  expect(
    within(comparison).getByRole("rowheader", { name: "Actual core" }),
  ).toBeTruthy();
  expect(
    within(comparison).getByRole("rowheader", {
      name: "Full without crowd effect",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Download component comparison CSV" }),
  ).toBeTruthy();
});

it("lists qualified Lab research before watch-only forecasts and earlier data gaps", async () => {
  const { store, index } = uiFixture();
  const base = store.forecasts.find(
    (row) => row.methodId === "enhanced-baseline-v2",
  );
  if (!base) throw new Error("fixture");
  const extras = [
    {
      ...base,
      id: "gap",
      gameId: "gap",
      awayTeam: "Gap team",
      startsAt: "2026-11-02T22:30:00Z",
      status: "data_gap" as const,
      total: null,
      side: null,
    },
    {
      ...base,
      id: "watch-upcoming",
      gameId: "watch-upcoming",
      awayTeam: "Upcoming watch",
      startsAt: "2026-11-02T23:00:00Z",
      status: "watch_only" as const,
    },
  ];
  store.forecasts.push(...extras);
  index.games.push(
    ...extras.map((row) => ({
      gameId: row.gameId,
      startsAt: row.startsAt,
      status: "Scheduled",
      firstHalfComplete: false,
    })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(url.includes("lab-index") ? index : store),
    })),
  );
  render(<Lab />);
  const table = await screen.findByRole("table", { name: "Lab forecasts" });
  const names = [...table.querySelectorAll(".card-matchup")].map(
    (cell) => cell.textContent,
  );
  expect(names).toHaveLength(3);
  expect(names[0]).toContain("Team A");
  expect(names[1]).toContain("Upcoming watch");
  expect(names[2]).toContain("Gap team");
});

it("records completed first halves, actual totals and watch-only decisions without counting upcoming games", async () => {
  const { store, index } = uiFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(url.includes("lab-index") ? index : store),
    })),
  );
  render(<Lab recordOnly />);
  const table = await screen.findByRole("table", { name: "Lab forecasts" });
  expect(within(table).getByText("Finished team")).toBeTruthy();
  expect(within(table).getByText("Watch team")).toBeTruthy();
  expect(within(table).queryByText("Team A")).toBeNull();
  expect(
    [...table.querySelectorAll(".card-actual")].map((cell) => cell.textContent),
  ).toEqual(["72", "72"]);
  const summary = screen.getByRole("region", { name: "Lab record summary" });
  expect(within(summary).getByText("1 / 0 / 0")).toBeTruthy();
  expect(screen.getByLabelText("Lab daily breakdown (ET)")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Lab version"), {
    target: { value: "bonus-exposure-v1" },
  });
  expect(screen.getByText("Bonus timing MAE")).toBeTruthy();
  expect(screen.getByText("2.00 min")).toBeTruthy();
  expect(screen.getByText(/1H total: 72/)).toBeTruthy();
  expect(screen.queryByText("Observed hit rate")).toBeNull();
});

it("retains paused-method history and separates the Actual and Lab record tabs", async () => {
  const { store, index } = uiFixture();
  const method = index.config.methods.find(
    (entry) => entry.id === "enhanced-baseline-v2",
  );
  if (method) method.enabled = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(url.includes("lab-index") ? index : store),
    })),
  );
  render(<PredictionRecord />);
  const source = screen.getByRole("group", {
    name: "Prediction record source",
  });
  expect(screen.getByText("Existing actual record")).toBeTruthy();
  fireEvent.click(within(source).getByRole("button", { name: "Lab" }));
  await screen.findByText("Finished team");
  expect(screen.getByText("Collection paused")).toBeTruthy();
  expect(screen.queryByText("Existing actual record")).toBeNull();
  fireEvent.click(within(source).getByRole("button", { name: "Actual" }));
  expect(screen.getByText("Existing actual record")).toBeTruthy();
});

it("does not display a partial Lab record if an archive fails", async () => {
  const { store, index } = uiFixture();
  index.archives.push({
    ...index.archives[0],
    date: "2026-11-01",
    jsonPath: "data/lab/2026-11-01.json",
    csvPath: "data/lab/2026-11-01.csv",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: !url.includes("2026-11-01"),
      json: async () =>
        structuredClone(url.includes("lab-index") ? index : store),
    })),
  );
  render(<Lab recordOnly />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText(/No partial record is shown/)).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Lab forecasts" })).toBeNull();
});
