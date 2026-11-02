// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const prior = JSON.parse(readFileSync("public/data/prior-season.json", "utf8"));
const current = JSON.parse(
  readFileSync("public/data/current-season.json", "utf8"),
);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("prior-season")
          ? structuredClone(prior)
          : structuredClone(current),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillMatchup() {
  await screen.findByText("365 teams");
  fireEvent.change(screen.getByLabelText("Team A"), {
    target: { value: "Alabama" },
  });
  fireEvent.change(screen.getByLabelText("Team B"), {
    target: { value: "Michigan" },
  });
  fireEvent.change(screen.getByLabelText("Matchup date"), {
    target: { value: current.asOf },
  });
  fireEvent.change(screen.getByLabelText("First-half O/U line"), {
    target: { value: "70.5" },
  });
}

describe("calculator workflow", () => {
  it("loads the real datasets, analyzes, saves a frozen record, and restores it", async () => {
    const view = render(<App />);
    await fillMatchup();
    expect(screen.getByText("RESEARCH ONLY")).toBeTruthy();
    expect(screen.getByText("not calibrated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save analysis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pick tracker/ }));
    expect(screen.getByLabelText("Actual 1H total")).toBeTruthy();
    const stored = JSON.parse(
      localStorage.getItem("1h-model-analyses-v1") ?? "[]",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      teamA: "Alabama",
      teamB: "Michigan",
      line: 70.5,
      purpose: "research",
      currentAsOf: current.asOf,
      priorAsOf: prior.asOf,
    });
    expect(Number.isFinite(stored[0].projection)).toBe(true);
    fireEvent.change(screen.getByLabelText("Actual 1H total"), {
      target: { value: "69" },
    });
    expect(
      JSON.parse(localStorage.getItem("1h-model-analyses-v1") ?? "[]")[0]
        .actualTotal,
    ).toBe(69);
    view.unmount();
    render(<App />);
    await screen.findByText("365 teams");
    fireEvent.click(screen.getByRole("button", { name: /Pick tracker/ }));
    expect(
      (screen.getByLabelText("Actual 1H total") as HTMLInputElement).value,
    ).toBe("69");
  });

  it("blocks earlier dates instead of showing a prediction from future snapshots", async () => {
    render(<App />);
    await fillMatchup();
    fireEvent.change(screen.getByLabelText("Matchup date"), {
      target: { value: "2026-11-01" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("newer than"),
    );
    expect(screen.queryByRole("button", { name: /Save analysis/ })).toBeNull();
  });

  it("rejects same-team matchups", async () => {
    render(<App />);
    await fillMatchup();
    fireEvent.change(screen.getByLabelText("Team B"), {
      target: { value: "Alabama" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "two different teams",
    );
  });
});
