// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordFixture } from "./model/record.test-fixture";
import Predictions from "./Predictions";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
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

function archiveFixture() {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("orders stronger research signals first and fades the row color without showing a hit probability", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T22:00:00Z"));
  const { feed } = recordFixture();
  const base = feed.predictions[0];
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
        url.includes("archive")
          ? { schemaVersion: 1, archives: [] }
          : structuredClone(feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  const rows = screen.getAllByRole("row");
  expect(rows[1].textContent).toContain("Strong signal");
  expect(rows[2].textContent).toContain("Weak signal");
  expect(rows[1].style.backgroundColor).not.toBe(rows[2].style.backgroundColor);
  expect(screen.getByText(/Green is a research ranking/)).toBeTruthy();
  expect(screen.getByText("75/100")).toBeTruthy();
});

it("provides dated downloads and automatically checks for updated predictions", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
  const feed = todayFixture();
  const archive = archiveFixture();
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      structuredClone(url.includes("prediction-archive") ? archive : feed),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  const latest = archive.archives[0];
  expect(
    screen.getByRole("link", { name: "Daily CSV ↓" }).getAttribute("href"),
  ).toContain(latest.csvPath);
  expect(
    screen.getByRole("link", { name: "Daily JSON ↓" }).getAttribute("href"),
  ).toContain(latest.jsonPath);
  expect(
    screen
      .getByRole("link", { name: "Daily team review Excel ↓" })
      .getAttribute("href"),
  ).toContain(latest.teamXlsxPath);
  expect(
    screen.getByRole("link", { name: "Daily Excel ↓" }).getAttribute("href"),
  ).toContain(latest.xlsxPath);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    vi.advanceTimersByTime(5 * 60 * 1000);
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("combines Top 25 with a conference and exports matching rows beyond the first page", async () => {
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
      json: async () =>
        url.includes("prediction-archive")
          ? archiveFixture()
          : structuredClone(feed),
    })),
  );
  let exported: NodeBlob | undefined;
  const revoke = vi.fn();
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob | MediaSource) {
        exported = blob as unknown as NodeBlob;
        return "blob:test";
      }
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
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
  fireEvent.click(
    screen.getByRole("button", { name: /Download filtered 30 rows/ }),
  );
  const csv = await exported?.text();
  expect(csv?.trim().split("\r\n")).toHaveLength(31);
  expect(csv).toContain("ranked-29");
  expect(csv).not.toContain("unranked");
  expect(revoke).toHaveBeenCalledWith("blob:test");
  expect(
    screen.getByRole("link", { name: "Excel workbook ↓" }).getAttribute("href"),
  ).toContain("data/daily/2026-11-03/predictions.xlsx");
});

it("lists projections, provides code/feed links, and keeps the complete CSV available while filtering", async () => {
  const feed = todayFixture();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        structuredClone(url.includes("archive") ? archiveFixture() : feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "First-half lines & predictions",
  });
  expect(
    screen
      .getByRole("link", { name: /Projection formula/ })
      .getAttribute("href"),
  ).toBe(feed.source.projectionCode);
  expect(
    screen.getByRole("link", { name: /JSON feed/ }).getAttribute("href"),
  ).toContain("predictions.json");
  fireEvent.change(screen.getByLabelText("Projection coverage"), {
    target: { value: "unavailable" },
  });
  expect(
    screen.getByRole("button", {
      name: `Download ${feed.counts.matchups} games for 2026-11-03 · CSV ↓`,
    }),
  ).toBeTruthy();
  expect(
    screen.getByText(new RegExp(`of ${feed.counts.unavailable} matches`)),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Compare with"), {
    target: { value: "opening" },
  });
  expect(
    screen.getByRole("columnheader", { name: "Opening 1H line BetMGM" }),
  ).toBeTruthy();
});

it("defaults to today's Eastern slate and changes the table and downloads together", async () => {
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
      json: async () =>
        structuredClone(url.includes("archive") ? archiveFixture() : feed),
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
  expect(
    screen.getByRole("link", { name: "Daily Excel ↓" }).getAttribute("href"),
  ).toContain("/2026-11-03/");
  fireEvent.change(screen.getByLabelText("Game date (ET)"), {
    target: { value: "2026-11-02" },
  });
  expect(
    screen.getByRole("heading", { name: "Archived 1H lines" }),
  ).toBeTruthy();
  expect(screen.getByText("Yesterday team")).toBeTruthy();
  expect(screen.queryByText("Early team")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Daily Excel ↓" }).getAttribute("href"),
  ).toContain("/2026-11-02/");
  expect(
    screen.getByRole("link", { name: "Excel workbook ↓" }).getAttribute("href"),
  ).toContain("/2026-11-02/");
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("Early team")).toBeTruthy();
  expect(screen.queryByText("Yesterday team")).toBeNull();
});

it("toggles tipoff groups and exports only the selected date and group", async () => {
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
      json: async () =>
        structuredClone(url.includes("archive") ? archiveFixture() : feed),
    })),
  );
  let exported: NodeBlob | undefined;
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob | MediaSource) {
        exported = blob as unknown as NodeBlob;
        return "blob:test";
      }
      static revokeObjectURL() {}
    },
  );
  let filename: string | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download;
  });
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  expect(screen.getByRole("button", { name: "All games 3" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not tipped off 1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tipped off 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Not tipped off 1" }));
  expect(screen.getByText("Late team")).toBeTruthy();
  expect(screen.getByText("Not posted")).toBeTruthy();
  expect(screen.queryByText("Early team")).toBeNull();
  expect(screen.queryByText("Postponed team")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: /Download filtered 1 rows/ }),
  );
  const csv = await exported?.text();
  expect(csv).toContain("today-late");
  expect(csv).not.toContain("today-early");
  expect(filename).toContain("2026-11-03-upcoming");
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
      json: async () =>
        structuredClone(url.includes("archive") ? archiveFixture() : feed),
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
      json: async () =>
        structuredClone(url.includes("archive") ? archiveFixture() : feed),
    })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", { name: "Today’s 1H lines" });
  expect(screen.getByText("Early team")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(60 * 1000);
  });
  expect(screen.queryByText("Early team")).toBeNull();
  expect(screen.queryByRole("link", { name: "Daily Excel ↓" })).toBeNull();
  expect(
    screen.getByText(/No dated downloads are available for 2026-11-04/),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain(
    "Today’s schedule has not been published yet",
  );
  expect(
    screen.getByRole("button", {
      name: "Download 0 games for 2026-11-04 · CSV ↓",
    }),
  ).toBeTruthy();
});
