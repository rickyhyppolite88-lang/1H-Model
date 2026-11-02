// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recordFixture } from "./model/record.test-fixture";
import Predictions from "./Predictions";

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
    name: "Every matchup. Every model total.",
  });
  const rows = screen.getAllByRole("row");
  expect(rows[1].textContent).toContain("Strong signal");
  expect(rows[2].textContent).toContain("Weak signal");
  expect(rows[1].style.backgroundColor).not.toBe(rows[2].style.backgroundColor);
  expect(screen.getByText(/Green is a research ranking/)).toBeTruthy();
  expect(screen.getByText("75/100")).toBeTruthy();
});

it("provides dated downloads and automatically checks for updated predictions", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const feed = JSON.parse(readFileSync("public/data/predictions.json", "utf8"));
  const archive = JSON.parse(
    readFileSync("public/data/prediction-archive.json", "utf8"),
  );
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      structuredClone(url.includes("prediction-archive") ? archive : feed),
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "Every matchup. Every model total.",
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
  const feed = JSON.parse(readFileSync("public/data/predictions.json", "utf8"));
  const base = feed.predictions[0];
  feed.predictions = Array.from({ length: 30 }, (_, index) => ({
    ...base,
    gameId: `ranked-${index}`,
    startsAt: "2026-11-03T00:00:00Z",
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
          ? { schemaVersion: 1, archives: [] }
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
    name: "Every matchup. Every model total.",
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
  ).toBe("2026-11-03T00:00:00Z");
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
  ).toContain("data/predictions.xlsx");
});

it("lists projections, provides code/feed links, and keeps the complete CSV available while filtering", async () => {
  const feed = JSON.parse(readFileSync("public/data/predictions.json", "utf8"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(feed) })),
  );
  render(<Predictions />);
  await screen.findByRole("heading", {
    name: "Every matchup. Every model total.",
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
      name: `Download all ${feed.counts.matchups} rows · CSV ↓`,
    }),
  ).toBeTruthy();
  expect(
    screen.getByText(new RegExp(`of ${feed.counts.unavailable} matches`)),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Compare with"), {
    target: { value: "opening" },
  });
  expect(
    screen.getByRole("columnheader", { name: "Opening line" }),
  ).toBeTruthy();
});
