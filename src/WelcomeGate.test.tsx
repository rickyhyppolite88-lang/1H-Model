// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WelcomeGate, {
  isThanksgivingWelcome,
  welcomeSessionKey,
} from "./WelcomeGate";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("uses the turkey shirt for Thanksgiving in Eastern Time, then restores the regular theme", () => {
  expect(isThanksgivingWelcome(Date.parse("2026-11-26T04:59:59Z"))).toBe(false);
  expect(isThanksgivingWelcome(Date.parse("2026-11-26T05:00:00Z"))).toBe(true);
  expect(isThanksgivingWelcome(Date.parse("2026-11-27T04:59:59Z"))).toBe(true);
  expect(isThanksgivingWelcome(Date.parse("2026-11-27T05:00:00Z"))).toBe(false);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T04:59:59Z"));
  const { container } = render(
    <WelcomeGate>
      <p>App</p>
    </WelcomeGate>,
  );
  expect(screen.getByText("HAPPY THANKSGIVING")).toBeTruthy();
  expect(container.querySelector(".welcome-turkey")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  expect(container.querySelector(".welcome-thanksgiving")).toBeNull();
  expect(container.querySelector(".welcome-turkey")).toBeNull();
  expect(screen.getByText("BACK ON THE COURT")).toBeTruthy();
});

it("lets the visitor enter immediately and remembers the introduction for this tab", () => {
  const first = render(
    <WelcomeGate>
      <p>Sign-in content</p>
    </WelcomeGate>,
  );
  expect(
    screen.getByRole("heading", { name: "Welcome back. We missed you." }),
  ).toBeTruthy();
  expect(screen.getByRole("img", { name: /One more shot\./ })).toBeTruthy();
  expect(screen.queryByText("Sign-in content")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enter 1H Model" }));
  expect(screen.getByText("Sign-in content")).toBeTruthy();
  expect(sessionStorage.getItem(welcomeSessionKey)).toBe("seen");
  first.unmount();
  render(
    <WelcomeGate>
      <p>Sign-in content</p>
    </WelcomeGate>,
  );
  expect(screen.queryByRole("button", { name: "Enter 1H Model" })).toBeNull();
});

it("preserves the saved theme and sportsbook preferences", () => {
  localStorage.setItem("1h-model-theme", "light");
  const preference = JSON.stringify({ value: "betmgm", savedAt: Date.now() });
  localStorage.setItem("1h-model-view-v1:predictions.book", preference);
  render(
    <WelcomeGate>
      <p>Sign-in content</p>
    </WelcomeGate>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Enter 1H Model" }));
  expect(localStorage.getItem("1h-model-theme")).toBe("light");
  expect(localStorage.getItem("1h-model-view-v1:predictions.book")).toBe(
    preference,
  );
});

it("still opens when tab storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  render(
    <WelcomeGate>
      <p>Sign-in content</p>
    </WelcomeGate>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Enter 1H Model" }));
  expect(screen.getByText("Sign-in content")).toBeTruthy();
});
