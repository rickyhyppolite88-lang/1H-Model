// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MobileNavigation from "./MobileNavigation";

const prototype = HTMLDialogElement.prototype;
const originalShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(prototype, "close");
const sections = [
  ["predictions", "Today’s lines"],
  ["audit", "Season lines & audit"],
];

beforeEach(() => {
  Object.defineProperties(prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    },
  });
});
afterEach(() => {
  cleanup();
  if (originalShow) Object.defineProperty(prototype, "showModal", originalShow);
  else Reflect.deleteProperty(prototype, "showModal");
  if (originalClose) Object.defineProperty(prototype, "close", originalClose);
  else Reflect.deleteProperty(prototype, "close");
});

it("opens the record from the quick navigation", () => {
  const select = vi.fn();
  render(
    <MobileNavigation
      active="predictions"
      sections={sections}
      onSelect={select}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Lines" }).getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "Full record" }));
  expect(select).toHaveBeenCalledWith("record");
});

it("opens all model sections in a modal and closes it after navigation", () => {
  const select = vi.fn();
  render(
    <MobileNavigation active="audit" sections={sections} onSelect={select} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByRole("dialog", { name: "Model sections" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Season lines & audit" }));
  expect(select).toHaveBeenCalledWith("audit");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("button", { name: "More" }).getAttribute("aria-expanded"),
  ).toBe("false");
});
