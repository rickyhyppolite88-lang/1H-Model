// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchPublishedUpdates } from "./publishedUpdates";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("refreshes every 30 seconds, pauses hidden tabs, resumes immediately and cleans up", () => {
  let visibility: DocumentVisibilityState = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  const refresh = vi.fn();
  const stop = watchPublishedUpdates(refresh);
  vi.advanceTimersByTime(29_999);
  expect(refresh).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  visibility = "hidden";
  vi.advanceTimersByTime(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(3);
  stop();
  vi.advanceTimersByTime(30_000);
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(3);
});
