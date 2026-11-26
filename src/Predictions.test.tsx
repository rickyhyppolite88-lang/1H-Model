// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  buildRecordIndex,
  recordForDate,
  updatePredictionRecord,
} from "./model/predictionRecord";
import type { DailyArchive, PredictionFeed } from "./model/predictions";
import { recordFixture } from "./model/record.test-fixture";
import Predictions from "./Predictions";
import { preferencePrefix } from "./usePreference";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  // Existing market-coverage cases explicitly exercise a selected BetMGM book.
  localStorage.setItem(
    `${preferencePrefix}sportsbook.draftkings-default-v1`,
    JSON.stringify({ savedAt: Date.now(), value: "betmgm" }),
  );
});

function todayFixture() {
  const { feed } = recordFixture();
  const base = feed.predictions[0];
  feed.through = "2026-11-03";
  feed.generatedAt = "2026-11-03T14:00:00Z";
  feed.marketCapturedAt = feed.generatedAt;
  feed.predictions = [
    {
      ...base,
      gameId: "today-early",
      awayTeam: "Early team",
      startsAt: "2026-11-03T23:00:00Z",
    },
    {
      ...base,
      gameId: "today-late",
      awayTeam: "Late team",
      startsAt: "2026-11-04T00:00:00Z",
      projectedFirstHalfTotal: null,
      markets: [],
    },
  ];
  feed.counts = { matchups: 2, predicted: 1, unavailable: 1 };
  return feed;
}

function archiveFixture(): DailyArchive {
  return {
    schemaVersion: 1,
    archives: ["2026-11-03", "2026-11-02"].map((date) => ({
      date,
      generatedAt: `${date}T14:00:00Z`,
      marketCapturedAt: `${date}T14:00:00Z`,
      matchups: 2,
      predicted: 1,
      csvPath: `data/daily/${date}/predictions.csv`,
      jsonPath: `data/daily/${date}/predictions.json`,
      xlsxPath: `data/daily/${date}/predictions.xlsx`,
      teamXlsxPath: `data/daily/${date}/team-comparison.xlsx`,
    })),
  };
}

function responseFor(
  url: string,
  feed: PredictionFeed,
  archive: DailyArchive = archiveFixture(),
) {
  return structuredClone(
    url.includes("prediction-record-index")
      ? {
          schemaVersion: 1,
          updatedAt: feed.generatedAt,
          canonicalIds: [],
          summary: [],
          archives: [],
        }
      : url.includes("prediction-archive")
        ? archive
        : feed,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("filters missing selected-book lines without losing the model projection or other book coverage", async () => {
  const feed = todayFixture();
  feed.predictions[1] = {
    ...feed.predictions[0],
    gameId: "other-book",
    awayTeam: "Other book team",
    markets: [{ ...feed.predictions[0].markets[0], sportsbook: "draftkings" }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  fireEvent.change(screen.getByLabelText("Projection coverage"), {
    target: { value: "line_missing" },
  });
  const table = screen.getByRole("table", { name: "Matchup predictions" });
  expect(within(table).getByText("Other book team")).toBeTruthy();
  expect(within(table).queryByText("Early team")).toBeNull();
  expect(within(table).getByText("No feed line")).toBeTruthy();
});

it.each(["signal", "time"])(
  "keeps usable upcoming picks ahead of earlier data gaps and regroups for the selected book (%s)",
  async (sort) => {
    const feed = todayFixture();
    const base = feed.predictions[0];
    base.markets = base.markets.map((m) => ({
      ...m,
      capturedAt: new Date().toISOString(),
    }));
    const game = (id: string, startsAt: string) => ({
      ...structuredClone(base),
      gameId: id,
      awayTeam: id,
      startsAt,
    });
    feed.predictions = [
      {
        ...game("Missing inputs", "2026-11-03T16:00:00Z"),
        projectedFirstHalfTotal: null,
      },
      { ...game("Missing line", "2026-11-03T17:00:00Z"), markets: [] },
      {
        ...game("Book-specific pick", "2026-11-03T18:00:00Z"),
        markets: [{ ...base.markets[0], sportsbook: "draftkings" }],
      },
      game("Later priced pick", "2026-11-03T20:00:00Z"),
      game("Earlier priced pick", "2026-11-03T19:00:00Z"),
    ];
    feed.counts = { matchups: 5, predicted: 4, unavailable: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => responseFor(url, feed),
      })),
    );
    render(<Predictions />);
    const table = await screen.findByRole("table", {
      name: "Matchup predictions",
    });
    fireEvent.change(screen.getByLabelText("Sort games"), {
      target: { value: sort },
    });
    const names = () =>
      [...table.querySelectorAll(".card-matchup")].map(
        (cell) => cell.textContent,
      );
    expect(names()[0]).toContain("Earlier priced pick");
    expect(names()[1]).toContain("Later priced pick");
    expect(names().slice(2).join(" ")).toContain("Missing inputs");
    expect(names().slice(2).join(" ")).toContain("Missing line");
    fireEvent.change(screen.getByLabelText("Sportsbook"), {
      target: { value: "draftkings" },
    });
    expect(names()[0]).toContain("Book-specific pick");
    expect(names()).toHaveLength(5);
  },
);

it("orders actionable plays by edge and presents binary decisions without percentages", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T22:00:00Z"));
  localStorage.setItem(
    `${preferencePrefix}sportsbook.draftkings-default-v1`,
    JSON.stringify({ savedAt: Date.now(), value: "betmgm" }),
  );
  const { feed } = recordFixture();
  const base = feed.predictions[0];
  base.markets = base.markets.map((m) => ({
    ...m,
    capturedAt: new Date().toISOString(),
  }));
  feed.predictions = [
    {
      ...base,
      gameId: "weak",
      awayTeam: "Weak signal",
      projectedFirstHalfTotal: 72,
      simpleTotal: 72,
      paceAdjustedTotal: 72,
    },
    {
      ...base,
      gameId: "strong",
      awayTeam: "Strong signal",
      projectedFirstHalfTotal: 76,
      simpleTotal: 76,
      paceAdjustedTotal: 76,
    },
  ];
  feed.counts = { matchups: 2, predicted: 2, unavailable: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        responseFor(url, feed, { schemaVersion: 1, archives: [] }),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  const rows = screen.getAllByRole("row");
  expect(rows[1].textContent).toContain("Strong signal");
  expect(rows[2].textContent).toContain("Weak signal");
  expect(within(rows[1]).getByText("YES BET")).toBeTruthy();
  expect(within(rows[2]).getByText("YES BET")).toBeTruthy();
  expect(within(rows[1]).getByText("1u")).toBeTruthy();
  expect(document.querySelector(".signal-badge")).toBeNull();
  expect(rows[1].textContent).not.toContain("%");
});

it("starts with DraftKings even with an old default stored, then preserves the user's new book choice", async () => {
  localStorage.removeItem(
    `${preferencePrefix}sportsbook.draftkings-default-v1`,
  );
  localStorage.setItem(
    `${preferencePrefix}sportsbook`,
    JSON.stringify({ savedAt: Date.now(), value: "betmgm" }),
  );
  const feed = todayFixture();
  feed.predictions = feed.predictions.map((row) => ({
    ...row,
    markets: row.markets.flatMap((market) => [
      { ...market, sportsbook: "draftkings" },
      { ...market, sportsbook: "fanduel" },
    ]),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  const first = render(<Predictions />);
  await screen.findByRole("table", { name: "Matchup predictions" });
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "draftkings",
  );
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "fanduel" },
  });
  first.unmount();
  render(<Predictions />);
  await screen.findByRole("table", { name: "Matchup predictions" });
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "fanduel",
  );
});

it.each([false, true])(
  "marks a future stake provisional until the final quote check is verified: %s",
  async (fresh) => {
    vi.setSystemTime(new Date("2026-11-02T23:57:00Z"));
    localStorage.removeItem(
      `${preferencePrefix}sportsbook.draftkings-default-v1`,
    );
    const { feed } = recordFixture();
    feed.generatedAt = "2026-11-02T23:57:00Z";
    feed.defaultSportsbook = "draftkings";
    feed.entryPolicy = {
      method: "last-pretip-v1",
      startedAt: "2026-11-02T23:40:00Z",
      maxQuoteAgeMinutes: 15,
    };
    feed.predictions[0].markets = feed.predictions[0].markets.map((row) => ({
      ...row,
      sportsbook: "draftkings",
      capturedAt: fresh ? feed.generatedAt : "2026-11-02T22:00:00Z",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => responseFor(url, feed),
      })),
    );
    render(<Predictions />);
    const table = await screen.findByRole("table", {
      name: "Matchup predictions",
    });
    expect(within(table).getByText(fresh ? "YES BET" : "NO BET")).toBeTruthy();
    expect(within(table).queryByText("Awaiting pre-tip check") !== null).toBe(
      false,
    );
  },
);

it.each([
  [95, 1],
  [88, 1],
  [65, 1],
])(
  "shows a binary 1u play regardless of the old score %s (%su)",
  async (score, units) => {
    vi.setSystemTime(new Date("2026-11-02T23:57:00Z"));
    localStorage.removeItem(
      `${preferencePrefix}sportsbook.draftkings-default-v1`,
    );
    const { feed } = recordFixture();
    feed.generatedAt = "2026-11-02T23:57:00Z";
    feed.defaultSportsbook = "draftkings";
    feed.entryPolicy = {
      method: "last-pretip-v1",
      startedAt: "2026-11-02T23:40:00Z",
      maxQuoteAgeMinutes: 15,
    };
    const row = feed.predictions[0];
    row.markets = row.markets.map((market) => ({
      ...market,
      sportsbook: "draftkings",
      capturedAt: "2026-11-02T23:30:00Z",
    }));
    const total = (row.markets[0].latestLine ?? 70) + (score * 8) / 100;
    row.projectedFirstHalfTotal = total;
    row.simpleTotal = total;
    row.paceAdjustedTotal = total;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => responseFor(url, feed),
      })),
    );
    render(<Predictions />);
    const table = await screen.findByRole("table", {
      name: "Matchup predictions",
    });
    expect(within(table).getByText("YES BET")).toBeTruthy();
    expect(within(table).getByText(`${units}u`)).toBeTruthy();
    expect(within(table).queryByText(/\d+%/)).toBeNull();
    expect(within(table).getByText("Awaiting pre-tip check")).toBeTruthy();
  },
);

it("keeps downloads out of the page and automatically checks for updated predictions", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  const feed = todayFixture();
  const archive = archiveFixture();
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => responseFor(url, feed, archive),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  expect(screen.queryByRole("link", { name: /CSV|JSON/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Excel|CSV|Download/ })).toBeNull();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await act(async () => {
    vi.advanceTimersByTime(30 * 1000);
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
});

it("ranks only YES BET Top 10 edges, updates for the book and restores the view", async () => {
  const feed = todayFixture();
  const base = {
    ...feed.predictions[0],
    markets: feed.predictions[0].markets.map((m) => ({
      ...m,
      capturedAt: new Date().toISOString(),
    })),
  };
  feed.predictions = Array.from({ length: 12 }, (_, index) => {
    const total = 70 + (index % 2 ? -1 : 1) * ((index + 1) / 2);
    return {
      ...base,
      gameId: `edge-${index + 1}`,
      awayTeam: `Edge ${index + 1}`,
      awayConference: index < 6 ? "SEC" : "ACC",
      homeConference: "Big East",
      projectedFirstHalfTotal: total,
      markets: [
        ...base.markets,
        {
          ...base.markets[0],
          sportsbook: "draftkings",
          latestLine: total - (13 - index) / 2,
        },
      ],
    };
  });
  feed.predictions.push(
    {
      ...base,
      gameId: "started",
      awayTeam: "Started outlier",
      startsAt: "2026-11-03T14:00:00Z",
      projectedFirstHalfTotal: 100,
    },
    {
      ...base,
      gameId: "wrong-day",
      awayTeam: "Wrong day",
      startsAt: "2026-11-02T23:00:00Z",
      projectedFirstHalfTotal: 120,
    },
    { ...base, gameId: "no-line", awayTeam: "No line", markets: [] },
    {
      ...base,
      gameId: "review",
      awayTeam: "Review outlier",
      projectedFirstHalfTotal: 100,
    },
    {
      ...base,
      gameId: "stale",
      awayTeam: "Stale quote",
      markets: base.markets.map((m) => ({
        ...m,
        capturedAt: "2026-11-03T14:00:00Z",
      })),
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  const view = render(<Predictions />);
  let table = await screen.findByRole("table", { name: "Matchup predictions" });
  const names = () =>
    [...table.querySelectorAll(".card-matchup")].map(
      (cell) => cell.textContent,
    );
  fireEvent.click(screen.getByRole("tab", { name: "Top 10 edges" }));
  expect(names()).toHaveLength(10);
  expect(names()[0]).toContain("Edge 12");
  expect(within(table).queryByText("Started outlier")).toBeNull();
  expect(within(table).queryByText("Review outlier")).toBeNull();
  expect(within(table).queryByText("Stale quote")).toBeNull();
  expect(within(table).queryByText("NO BET")).toBeNull();
  expect(within(table).queryByText("Wrong day")).toBeNull();
  expect(within(table).queryByText("No line")).toBeNull();
  expect(
    (screen.getByLabelText("Sort games") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Not tipped off 10" }));
  expect(names()).toHaveLength(10);
  expect(names()[0]).toContain("Edge 12");
  expect(within(table).getByText("Edge 3")).toBeTruthy();
  expect(within(table).queryByText("Started outlier")).toBeNull();
  expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "draftkings" },
  });
  expect(names()[0]).toContain("Edge 1");
  expect(within(table).queryByText("Edge 12")).toBeNull();
  fireEvent.change(screen.getByLabelText("Conference"), {
    target: { value: "SEC" },
  });
  expect(names()).toHaveLength(6);
  expect(
    screen
      .getByRole("tab", { name: "Top 10 edges" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  view.unmount();
  render(<Predictions />);
  table = await screen.findByRole("table", { name: "Matchup predictions" });
  expect(
    screen
      .getByRole("tab", { name: "Top 10 edges" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(names()).toHaveLength(6);
  expect(names()[0]).toContain("Edge 1");
  fireEvent.click(screen.getByRole("tab", { name: "All games" }));
  expect(
    (screen.getByLabelText("Sort games") as HTMLSelectElement).disabled,
  ).toBe(false);
});

it("combines Top 25 with a conference and preserves the daily workbook", async () => {
  const feed = todayFixture();
  const base = feed.predictions[0];
  feed.predictions = Array.from({ length: 30 }, (_, index) => ({
    ...base,
    gameId: `ranked-${index}`,
    startsAt: "2026-11-04T00:00:00Z",
    awayTeam: `Ranked team ${index}`,
    homeTeam: "Opponent",
    awayConference: "SEC",
    homeConference: "ACC",
    awayRank: 25,
    homeRank: null,
  }));
  feed.predictions.push({
    ...base,
    gameId: "unranked",
    awayTeam: "Unranked team",
    awayConference: "SEC",
    homeConference: "SEC",
    awayRank: null,
    homeRank: null,
  });
  feed.counts.matchups = 31;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  fireEvent.change(screen.getByLabelText("Conference"), {
    target: { value: "SEC" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Top 25" }));
  expect(
    screen.getByRole("tab", { name: "Top 25" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.queryByText("Unranked team")).toBeNull();
  expect(screen.queryByText("Ranked team 29")).toBeNull();
  expect(
    screen.getByRole("columnheader", { name: "Tipoff (ET)" }),
  ).toBeTruthy();
  expect(screen.getAllByText("7:00 PM ET")).toHaveLength(25);
  expect(
    screen.getAllByTitle("Eastern Time (EST)")[0].getAttribute("datetime"),
  ).toBe("2026-11-04T00:00:00Z");
  expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Excel|CSV|Download/ })).toBeNull();
});

it("keeps projection filters available without raw feed and CSV controls", async () => {
  const feed = todayFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  expect(
    screen.queryByRole("link", { name: /Projection formula|JSON feed/ }),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Projection coverage"), {
    target: { value: "unavailable" },
  });
  expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  expect(
    screen.getByText(new RegExp(`of ${feed.counts.unavailable} matches`)),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Compare with")).toBeNull();
  expect(
    screen.getByRole("columnheader", { name: "Current 1H line BetMGM" }),
  ).toBeTruthy();
});

it("defaults to today's Eastern slate and changes the table with the selected date", async () => {
  const feed = todayFixture();
  const base = feed.predictions[0];
  feed.predictions.push(
    {
      ...base,
      gameId: "yesterday",
      startsAt: "2026-11-03T00:00:00Z",
      awayTeam: "Yesterday team",
    },
    {
      ...base,
      gameId: "tomorrow",
      startsAt: "2026-11-04T05:00:00Z",
      awayTeam: "Tomorrow team",
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  expect(screen.getByText("Early team")).toBeTruthy();
  expect(screen.getByText("Late team")).toBeTruthy();
  expect(screen.queryByText("Yesterday team")).toBeNull();
  expect(screen.queryByText("Tomorrow team")).toBeNull();
  expect(
    (screen.getByLabelText("Game date (ET)") as HTMLSelectElement).value,
  ).toBe("today");
  expect(screen.queryByRole("link", { name: /Excel|CSV|Download/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-02" },
  });
  expect(
    screen.getByRole("heading", { name: "Archived 1H lines" }),
  ).toBeTruthy();
  expect(screen.getByText("Yesterday team")).toBeTruthy();
  expect(screen.queryByText("Early team")).toBeNull();
  expect(screen.queryByRole("link", { name: /Excel|CSV|Download/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Excel|CSV|Download/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("Early team")).toBeTruthy();
  expect(screen.queryByText("Yesterday team")).toBeNull();
});

it("toggles tipoff groups without redundant export controls", async () => {
  vi.setSystemTime(new Date("2026-11-03T23:30:00Z"));
  const feed = todayFixture();
  feed.predictions.push({
    ...feed.predictions[0],
    gameId: "postponed",
    awayTeam: "Postponed team",
    status: "Postponed",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  expect(screen.getByRole("button", { name: "All games 3" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not tipped off 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tipped off 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Not tipped off 1" }));
  expect(screen.getByText("Late team")).toBeTruthy();
  expect(screen.getByText("No feed line")).toBeTruthy();
  expect(screen.queryByText("Early team")).toBeNull();
  expect(screen.queryByText("Postponed team")).toBeNull();
  expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tipped off 1" }));
  expect(screen.getByText("Early team")).toBeTruthy();
  expect(screen.queryByText("Late team")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All games 3" }));
  expect(screen.getByText("Postponed team")).toBeTruthy();
});

it("moves games between tipoff filters without reloading the page", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-03T23:59:30Z"));
  const feed = todayFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  fireEvent.click(screen.getByRole("button", { name: "Not tipped off 1" }));
  expect(screen.getByText("Late team")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(60 * 1000);
  });
  expect(screen.queryByText("Late team")).toBeNull();
  expect(screen.getByRole("button", { name: "Tipped off 2" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tipped off 2" }));
  expect(screen.getByText("Late team")).toBeTruthy();
});

it("follows Eastern midnight and never falls back to an earlier day's games or files", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-04T04:59:30Z"));
  const feed = todayFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  expect(screen.getByText("Early team")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(60 * 1000);
  });
  expect(screen.queryByText("Early team")).toBeNull();
  expect(screen.queryByRole("link", { name: "Excel workbook ↓" })).toBeNull();
  expect(screen.queryByText(/No dated downloads/)).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "Today’s schedule has not been published yet",
  );
  expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
});

it("changes the displayed record with the game date and explains data gaps", async () => {
  const feed = todayFixture();
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const original = store.records[0];
  store.records.push({
    ...original,
    id: "next-day",
    gameId: "today-early",
    gameDate: "2026-11-03",
    recordedAt: "2026-11-03T22:00:00Z",
    prediction: { ...feed.predictions[0] },
  });
  store.results = [
    {
      id: "old-win",
      season: original.season,
      gameId: original.gameId,
      observedAt: "2026-11-03T03:00:00Z",
      sourceCapturedAt: "2026-11-03T03:00:00Z",
      awayPoints: 36,
      homePoints: 36,
      source: "https://example.com/results",
    },
    {
      id: "new-loss",
      season: original.season,
      gameId: "today-early",
      observedAt: "2026-11-04T03:00:00Z",
      sourceCapturedAt: "2026-11-04T03:00:00Z",
      awayPoints: 33,
      homePoints: 33,
      source: "https://example.com/results",
    },
  ];
  const index = buildRecordIndex(store);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("prediction-record-index")
          ? structuredClone(index)
          : url.includes("prediction-record/")
            ? structuredClone(
                recordForDate(
                  store,
                  url.includes("2026-11-02") ? "2026-11-02" : "2026-11-03",
                ),
              )
            : responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByText("0 / 1 / 0");
  expect(
    within(
      screen.getByRole("region", { name: "Record for 2026-11-03" }),
    ).getByText("0 / 1 / 0"),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-02" },
  });
  await screen.findByText("1 / 0 / 0");
  expect(
    within(
      screen.getByRole("region", { name: "Record for 2026-11-02" }),
    ).getByText("1 / 0 / 0"),
  ).toBeTruthy();
  expect(screen.queryByText("0 / 1 / 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("0 / 1 / 0");
  const help = screen.getByRole("complementary", {
    name: "Understanding unavailable games",
  });
  expect(
    within(help).getByText("Missing inputs mean a data gap."),
  ).toBeTruthy();
  fireEvent.click(
    within(help).getByText("What is missing, and what can the model tell me?"),
  );
  expect(
    within(help).getByText(
      /No model total or qualified model pick is available/,
    ),
  ).toBeTruthy();
  expect(screen.getByText("Unrated · data gap")).toBeTruthy();
});

it("shows current-line movement against the actual recorded pick and never borrows another book's pick", async () => {
  vi.setSystemTime(new Date("2026-11-04T15:00:00Z"));
  const feed = todayFixture();
  feed.predictions[0].markets[0].openingLine = 70;
  feed.predictions[0].markets[0].latestLine = 72;
  feed.predictions[0].markets.push({
    ...feed.predictions[0].markets[0],
    sportsbook: "fanduel",
    openingLine: 70,
    latestLine: 69,
  });
  const f = recordFixture();
  const store = updatePredictionRecord(f.store, f.feed, f.ledger, f.at);
  const original = store.records[0];
  original.id = "saved-today-early";
  original.gameId = "today-early";
  original.gameDate = "2026-11-03";
  original.recordedAt = "2026-11-03T22:00:00Z";
  original.prediction = { ...feed.predictions[0] };
  store.results = [
    {
      id: "saved-win",
      season: original.season,
      gameId: original.gameId,
      observedAt: "2026-11-04T03:00:00Z",
      sourceCapturedAt: "2026-11-04T03:00:00Z",
      awayPoints: 35,
      homePoints: 36,
      source: "https://example.com/results",
    },
  ];
  const index = buildRecordIndex(store);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("prediction-record-index")
          ? structuredClone(index)
          : url.includes("prediction-record/")
            ? structuredClone(store)
            : responseFor(url, feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-03" },
  });
  await screen.findByText("1 / 0 / 0");
  fireEvent.click(
    screen.getByRole("button", {
      name: /Line movement for Early team.*up 2.0 points/,
    }),
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Recorded OVER 70.0: Win",
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "current 72.0 would be Loss",
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Official result remains Win",
  );
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "fanduel" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: /Line movement for Early team.*down 1.0 points/,
    }),
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "No counted pregame pick is saved for this sportsbook",
  );
  expect(store.records[0].comparison.line).toBe(70);
  expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
});
