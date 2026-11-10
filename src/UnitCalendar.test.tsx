// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { UnitPlay } from "./model/units";
import UnitCalendar from "./UnitCalendar";

afterEach(cleanup);
const plays: UnitPlay[] = [
  {
    id: "win",
    source: "actual",
    season: "2026-27",
    method: "season-bridge-v1",
    sportsbook: "betmgm",
    basis: "latest",
    assignedAt: "2026-11-02T20:00:00Z",
    policy: "confidence-units-v1",
    date: "2026-11-02",
    away: "Away",
    home: "Home",
    side: "OVER",
    line: 70,
    price: -110,
    score: 80,
    units: 1.5,
    actual: 72,
    grade: "Win",
    net: (1.5 * 100) / 110,
    mode: "tracked",
  },
  {
    id: "loss",
    source: "actual",
    season: "2026-27",
    method: "season-bridge-v1",
    sportsbook: "betmgm",
    basis: "latest",
    assignedAt: "2026-11-03T20:00:00Z",
    policy: "confidence-units-v1",
    date: "2026-11-03",
    away: "Away",
    home: "Home",
    side: "UNDER",
    line: 70,
    price: -110,
    score: 65,
    units: 1,
    actual: 72,
    grade: "Loss",
    net: -1,
    mode: "tracked",
  },
];
it("shows green and red daily net units and selects a day without mixing historical accounting", () => {
  const onSelectDate = vi.fn();
  render(
    <UnitCalendar
      plays={[
        ...plays,
        {
          ...plays[0],
          id: "old",
          date: "2026-11-01",
          units: 1,
          net: 100 / 110,
          mode: "historical",
        },
      ]}
      date="all"
      onSelectDate={onSelectDate}
      available
    />,
  );
  const calendar = screen.getByRole("region", {
    name: "Actual units calendar",
  });
  expect(
    within(calendar).getByRole("button", { name: "2026-11-02: +1.36u" })
      .className,
  ).toContain("unit-positive");
  expect(
    within(calendar).getByRole("button", { name: "2026-11-03: -1.00u" })
      .className,
  ).toContain("unit-negative");
  expect(within(calendar).getByText("+0.36u")).toBeTruthy();
  fireEvent.click(
    within(calendar).getByRole("button", { name: "2026-11-03: -1.00u" }),
  );
  expect(onSelectDate).toHaveBeenCalledWith("2026-11-03");
  fireEvent.change(screen.getByLabelText("Unit accounting"), {
    target: { value: "historical" },
  });
  expect(
    within(calendar).getByRole("button", { name: "2026-11-01: +0.91u" }),
  ).toBeTruthy();
  expect(within(calendar).queryByText("+0.36u")).toBeNull();
});
it("preserves month alignment and marks missing odds or reviews instead of treating them as zero-profit plays", () => {
  render(
    <UnitCalendar
      plays={[{ ...plays[0], net: null, price: null }]}
      date="2026-11-02"
      onSelectDate={vi.fn()}
      available
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "2026-11-02: Review; 1 unsettled" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByText(/1 plays are excluded/)).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "2026-11-01: —" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
