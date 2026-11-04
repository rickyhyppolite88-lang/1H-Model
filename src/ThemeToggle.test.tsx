// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

it("starts in dark mode and remembers the selected light theme across visits", () => {
  const view = render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("1h-model-theme")).toBe("light");
  view.unmount();
  render(<ThemeToggle />);
  expect(
    screen.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(localStorage.getItem("1h-model-theme")).toBe("dark");
});

it("ignores an invalid saved preference", () => {
  localStorage.setItem("1h-model-theme", "unknown");
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("still switches themes when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});
