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
import { labFixture } from "./model/lab.test-fixture";
import { captureLab } from "./model/labCapture";
import PredictionRecord from "./PredictionRecord";

vi.mock("./ActualPredictionRecord", () => ({
  default: () => <div>Existing actual record</div>,
}));

function uiFixture() {
  const f = labFixture();
  const store = captureLab(f.empty, f.config, f.feed, f.ledger, f.inputs, f.at);
  store.startedAt = "2026-11-02T20:00:00Z";
  const base = store.forecasts.find(
    (row) => row.methodId === "qualified-baseline-v1",
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
  expect(within(table).getAllByText("72")).toHaveLength(2);
  const summary = screen.getByRole("region", { name: "Lab record summary" });
  expect(within(summary).getByText("1 / 0 / 0")).toBeTruthy();
  expect(screen.getByLabelText("Lab daily breakdown (ET)")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Research method"), {
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
    (entry) => entry.id === "qualified-baseline-v1",
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
