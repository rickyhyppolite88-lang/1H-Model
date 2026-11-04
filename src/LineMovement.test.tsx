// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import LineMovement from "./LineMovement";
import { recordFixture } from "./model/record.test-fixture";

afterEach(cleanup);

it("shows the current line and signed movement, with a tooltip available by hover, keyboard, or tap", () => {
  const row = recordFixture().feed.predictions[0];
  row.markets[0].openingLine = 70;
  row.markets[0].latestLine = 72;
  render(
    <LineMovement
      row={row}
      sportsbook="betmgm"
      recorded={{ line: 70, side: "OVER", actual: 71, grade: "Win" }}
      recordAvailability="ready"
      at={Date.parse("2026-11-02T22:00:00Z")}
    />,
  );
  expect(screen.getByText("72.00")).toBeTruthy();
  const button = screen.getByRole("button", {
    name: /Line movement.*up 2.0 points/,
  });
  expect(button.textContent).toBe("+2.0");
  expect(button.classList.contains("line-move-up")).toBe(true);
  fireEvent.mouseEnter(button);
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.textContent).toContain("Opening 70.0 → current 72.0");
  expect(tooltip.textContent).toContain("would be Loss");
  expect(tooltip.textContent).toContain("Official result remains Win");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(button);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(button);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.blur(button);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("shows decreases in red and explains missing opener or current data", () => {
  const row = recordFixture().feed.predictions[0];
  row.markets[0].openingLine = 72;
  row.markets[0].latestLine = 70;
  const view = render(
    <LineMovement
      row={row}
      sportsbook="betmgm"
      recordAvailability="ready"
      at={Date.parse("2026-11-03T01:00:00Z")}
    />,
  );
  expect(screen.getByText("−2.0").classList.contains("line-move-down")).toBe(
    true,
  );
  row.markets[0].openingLine = null;
  view.rerender(
    <LineMovement
      row={row}
      sportsbook="betmgm"
      recordAvailability="ready"
      at={Date.parse("2026-11-03T01:00:00Z")}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Line movement.*unavailable/ }),
  );
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Opening line unavailable",
  );
  expect(screen.getByRole("tooltip").textContent).toContain("Game has started");
  row.markets[0].latestLine = null;
  view.rerender(
    <LineMovement
      row={row}
      sportsbook="betmgm"
      recordAvailability="ready"
      at={Date.parse("2026-11-03T01:00:00Z")}
    />,
  );
  expect(screen.getByText("Not posted")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).toContain(
    "Current line unavailable",
  );
});
