// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Predictions from "./Predictions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    vi.advanceTimersByTime(5 * 60 * 1000);
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
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
