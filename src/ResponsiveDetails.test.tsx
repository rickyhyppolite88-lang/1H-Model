// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResponsiveDetails from "./ResponsiveDetails";

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function compactViewport(matches: boolean) {
  let notify = () => {};
  const media = {
    matches,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      notify = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    resize(compact: boolean) {
      act(() => {
        media.matches = compact;
        notify();
      });
    },
  };
}

it("keeps supporting controls expanded on desktop", () => {
  compactViewport(false);
  const { container } = render(
    <ResponsiveDetails summary="Filters & search">
      <label>
        Search teams
        <input />
      </label>
    </ResponsiveDetails>,
  );
  expect(container.querySelector("details")?.open).toBe(true);
  expect(screen.getByRole("textbox", { name: "Search teams" })).toBeTruthy();
});

it("collapses mobile controls and preserves their state when opened and closed", () => {
  compactViewport(true);
  const { container } = render(
    <ResponsiveDetails summary="Filters & search">
      <label>
        Search teams
        <input defaultValue="Duke" />
      </label>
    </ResponsiveDetails>,
  );
  const details = container.querySelector("details");
  if (!details) throw new Error("Missing disclosure");
  expect(details.open).toBe(false);
  act(() => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  const input = screen.getByRole("textbox", {
    name: "Search teams",
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "UConn" } });
  act(() => {
    details.open = false;
    fireEvent(details, new Event("toggle"));
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  expect(input.value).toBe("UConn");
});

it("remembers the disclosure choice through resizing and remounting", () => {
  const viewport = compactViewport(true);
  const { container, unmount } = render(
    <ResponsiveDetails summary="Downloads">Download links</ResponsiveDetails>,
  );
  expect(container.querySelector("details")?.open).toBe(false);
  const details = container.querySelector("details");
  if (!details) throw new Error("Missing disclosure");
  act(() => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  viewport.resize(false);
  expect(container.querySelector("details")?.open).toBe(true);
  viewport.resize(true);
  expect(container.querySelector("details")?.open).toBe(true);
  unmount();
  const restored = render(
    <ResponsiveDetails summary="Downloads">Download links</ResponsiveDetails>,
  );
  expect(restored.container.querySelector("details")?.open).toBe(true);
});
