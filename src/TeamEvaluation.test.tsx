// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TeamEvaluation from "./TeamEvaluation";

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows both seasons' offense and defense, accuracy origins, filters and downloads", async () => {
  const report = JSON.parse(
    readFileSync("public/data/team-evaluation.json", "utf8"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => structuredClone(report),
    })),
  );
  render(<TeamEvaluation />);
  await screen.findByRole("heading", {
    name: "Offense, defense, and the season transition",
  });
  expect(
    screen.getByRole("table", { name: "Team offense and defense comparison" }),
  ).toBeTruthy();
  expect(screen.getByText("1H points allowed / game")).toBeTruthy();
  expect(screen.getByText("Offense: points / 100 possessions")).toBeTruthy();
  expect(
    screen.getByText("Defense: points allowed / 100 possessions"),
  ).toBeTruthy();
  expect(screen.getByText("Reconstructed season debuts")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Team comparison Excel ↓" })
      .getAttribute("href"),
  ).toContain("team-comparison.xlsx");
  fireEvent.change(screen.getByLabelText("Find a team"), {
    target: { value: "Alabama" },
  });
  expect(
    (screen.getByLabelText("Compare team") as HTMLSelectElement).options.length,
  ).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Find a team"), {
    target: { value: "no-such-team" },
  });
  expect(screen.getByText("No teams match these filters.")).toBeTruthy();
});
