// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  preferenceLifetime,
  preferenceLineDate,
  preferencePrefix,
  preferenceSportsbook,
  readPreference,
  resetViewPreferences,
  usePreference,
} from "./usePreference";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T17:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function Control() {
  const [book, setBook] = usePreference(
    "sportsbook",
    preferenceSportsbook,
    "betmgm",
  );
  return (
    <>
      <label>
        Sportsbook
        <select value={book} onChange={(e) => setBook(e.target.value)}>
          <option value="betmgm">BetMGM</option>
          <option value="draftkings">DraftKings</option>
        </select>
      </label>
      <button type="button" onClick={resetViewPreferences}>
        Reset views
      </button>
    </>
  );
}
it("restores a sportsbook after refresh and expires old preferences after seven days", () => {
  let view = render(<Control />);
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "draftkings" },
  });
  view.unmount();
  vi.setSystemTime(Date.now() + 1000);
  view = render(<Control />);
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "draftkings",
  );
  view.unmount();
  vi.setSystemTime(Date.now() + preferenceLifetime);
  render(<Control />);
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "betmgm",
  );
});
it("rejects corrupt, invalid, and future-dated stored values", () => {
  const key = `${preferencePrefix}sportsbook`;
  for (const raw of [
    "bad-json",
    JSON.stringify({ savedAt: Date.now(), value: 123 }),
    JSON.stringify({ savedAt: Date.now() + 1, value: "draftkings" }),
  ]) {
    localStorage.setItem(key, raw);
    expect(readPreference("sportsbook", preferenceSportsbook, "betmgm")).toBe(
      "betmgm",
    );
  }
  expect(preferenceLineDate.safeParse("2026-02-30").success).toBe(false);
  expect(preferenceLineDate.safeParse("all").success).toBe(false);
});
it("renews an unchanged choice when the page closes", () => {
  const view = render(<Control />);
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "draftkings" },
  });
  vi.setSystemTime(Date.now() + preferenceLifetime - 1000);
  act(() => window.dispatchEvent(new Event("pagehide")));
  view.unmount();
  vi.setSystemTime(Date.now() + 2000);
  render(<Control />);
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "draftkings",
  );
});
it("resets view choices while preserving forecasts, theme, and the unlock session", () => {
  for (const key of [
    "1h-model-analyses-v1",
    "1h-model-theme",
    "1h-model-access-v1",
  ])
    localStorage.setItem(key, "preserved");
  render(<Control />);
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "draftkings" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset views" }));
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "betmgm",
  );
  for (const key of [
    "1h-model-analyses-v1",
    "1h-model-theme",
    "1h-model-access-v1",
  ])
    expect(localStorage.getItem(key)).toBe("preserved");
});
it("keeps controls usable when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<Control />);
  fireEvent.change(screen.getByLabelText("Sportsbook"), {
    target: { value: "draftkings" },
  });
  expect((screen.getByLabelText("Sportsbook") as HTMLSelectElement).value).toBe(
    "draftkings",
  );
});
