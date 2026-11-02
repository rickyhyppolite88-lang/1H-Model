// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SeasonAudit from "./SeasonAudit";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows actual first-half market comparisons and changes the fixed benchmark book", async () => {
  const ledger = JSON.parse(
    readFileSync("public/data/season-games.json", "utf8"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => structuredClone(ledger),
    })),
  );
  render(<SeasonAudit />);
  await screen.findByRole("heading", {
    name: "This season, against the line.",
  });
  expect(screen.getByRole("columnheader", { name: "1H opener" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Actual 1H" })).toBeTruthy();
  expect(screen.getByText("not a verified closing line")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Benchmark sportsbook"), {
    target: { value: "draftkings" },
  });
  expect(screen.getByText("DraftKings opener · MAE")).toBeTruthy();
});
