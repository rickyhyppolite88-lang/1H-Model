// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import {
  buildRecordIndex,
  updatePredictionRecord,
} from "./model/predictionRecord";
import { recordFixture } from "./model/record.test-fixture";
import { actualUnitPlay, type UnitLedger } from "./model/units";

const load = (name: string) =>
  JSON.parse(readFileSync(`public/data/${name}.json`, "utf8"));
const prior = load("prior-season");
const current = load("current-season");
const predictions = load("predictions");
const teamEvaluation = load("team-evaluation");
const fixture = recordFixture();
const record = updatePredictionRecord(
  fixture.store,
  fixture.feed,
  fixture.ledger,
  fixture.at,
);
record.results = [
  {
    id: "finished",
    season: record.records[0].season,
    gameId: record.records[0].gameId,
    observedAt: "2026-11-03T02:00:00Z",
    sourceCapturedAt: "2026-11-03T02:00:00Z",
    awayPoints: 36,
    homePoints: 36,
    source: "https://example.com/results",
  },
];
record.updatedAt = "2026-11-03T02:00:00Z";
const recordIndex = buildRecordIndex(record);
const unitLedger: UnitLedger = {
  schemaVersion: 1,
  startedAt: record.updatedAt,
  updatedAt: recordIndex.updatedAt,
  assignments: [],
};
const unitResults = {
  schemaVersion: 1,
  updatedAt: unitLedger.updatedAt,
  plays: record.records.map((row) =>
    actualUnitPlay(row, record.results, unitLedger),
  ),
};
const dialogClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(
          url.includes("unit-ledger")
            ? unitLedger
            : url.includes("unit-results")
              ? unitResults
              : url.includes("prediction-record-index")
                ? recordIndex
                : url.includes("prediction-record/")
                  ? record
                  : url.includes("team-evaluation.json")
                    ? teamEvaluation
                    : url.includes("predictions.json")
                      ? predictions
                      : url.includes("prior-season")
                        ? prior
                        : current,
        ),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (dialogClose)
    Object.defineProperty(HTMLDialogElement.prototype, "close", dialogClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

it("opens the full record and date dropdown from the phone shortcut", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Full record" }));
  expect(
    await screen.findByRole("heading", { name: "Running prediction record" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Full prediction record" }),
  ).toBeTruthy();
  expect(screen.getByLabelText("Daily breakdown (ET)")).toBeTruthy();
  expect(
    await screen.findByRole("table", { name: "Recorded predictions" }),
  ).toBeTruthy();
});

it("removes Matchup Lab while retaining the other section controls", async () => {
  render(<App />);
  await screen.findByText("365 teams");
  expect(screen.queryByRole("button", { name: /Matchup lab/i })).toBeNull();
  expect(screen.queryByRole("option", { name: /Matchup lab/i })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "View" }), {
    target: { value: "record" },
  });
  expect(
    await screen.findByRole("heading", { name: "Running prediction record" }),
  ).toBeTruthy();
});

it("retains the offense and defense comparison", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Team comparison" }));
  expect(
    await screen.findByRole("table", {
      name: "Team offense and defense comparison",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("table", { name: "Season total accuracy" }),
  ).toBeTruthy();
});

it("preserves existing browser-local tracker entries and result edits", async () => {
  const saved = {
    id: "legacy",
    savedAt: "2026-11-02T20:00:00Z",
    teamA: "Alabama",
    teamB: "Michigan",
    date: "2026-11-02",
    line: 70.5,
    projection: 74,
    pick: "OVER",
    tier: "Research",
    priorAsOf: prior.asOf,
    currentAsOf: current.asOf,
    phase: "regular",
    priorEquivalentGames: 8,
    leagueRegression: 0.35,
    actualTotal: null,
    purpose: "research",
  };
  localStorage.setItem("1h-model-analyses-v1", JSON.stringify([saved]));
  const view = render(<App />);
  await screen.findByText("365 teams");
  fireEvent.click(screen.getByRole("button", { name: /Pick tracker/ }));
  fireEvent.change(screen.getByLabelText("Actual 1H total"), {
    target: { value: "69" },
  });
  expect(
    JSON.parse(localStorage.getItem("1h-model-analyses-v1") ?? "[]"),
  ).toEqual([{ ...saved, actualTotal: 69 }]);
  view.unmount();
  render(<App />);
  await screen.findByText("365 teams");
  fireEvent.click(screen.getByRole("button", { name: /Pick tracker/ }));
  expect(
    (screen.getByLabelText("Actual 1H total") as HTMLInputElement).value,
  ).toBe("69");
});
