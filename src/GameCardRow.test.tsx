// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import GameCardRow from "./GameCardRow";

afterEach(cleanup);

it("expands and collapses a card without changing its values", () => {
  render(
    <table>
      <tbody>
        <GameCardRow label="Duke at Kansas">
          <td>Predicted 74.25</td>
          <td>Saved line 72.50</td>
          <td className="card-detail">Recorded OVER, actual 75, Win</td>
        </GameCardRow>
      </tbody>
    </table>,
  );
  const button = screen.getByRole("button", {
    name: "Expand details for Duke at Kansas",
  });
  const row = button.closest("tr");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-controls")).toBe(row?.id);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe(
    "Collapse details for Duke at Kansas",
  );
  expect(screen.getByText("Recorded OVER, actual 75, Win")).toBeTruthy();
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText("Predicted 74.25")).toBeTruthy();
  expect(screen.getByText("Saved line 72.50")).toBeTruthy();
});

it("keeps each game's expansion independent and retains actions inside the full card", () => {
  let dayOpened = false;
  render(
    <table>
      <tbody>
        <GameCardRow label="First game" kind="record">
          <td>
            <button
              type="button"
              onClick={() => {
                dayOpened = true;
              }}
            >
              View day
            </button>
          </td>
        </GameCardRow>
        <GameCardRow label="Second game">
          <td>Another matchup</td>
        </GameCardRow>
      </tbody>
    </table>,
  );
  const first = screen.getByRole("button", {
    name: "Expand details for First game",
  });
  const second = screen.getByRole("button", {
    name: "Expand details for Second game",
  });
  expect(first.getAttribute("aria-controls")).not.toBe(
    second.getAttribute("aria-controls"),
  );
  fireEvent.click(first);
  fireEvent.click(screen.getByRole("button", { name: "View day" }));
  expect(dayOpened).toBe(true);
  expect(first.getAttribute("aria-expanded")).toBe("true");
  expect(second.getAttribute("aria-expanded")).toBe("false");
});
