// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AccessGate, {
  accessPasswordDigest,
  accessSessionKey,
  idleTimeout,
  sessionIsActive,
  useAppLock,
} from "./AccessGate";

const testPassword = "fixture-password";
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-04T17:00:00Z"));
  // Test the gate without publishing the real shared password in test sources.
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(async (_algorithm: string, data: Uint8Array) => {
        return new TextDecoder().decode(data) === testPassword
          ? Uint8Array.from(accessPasswordDigest.match(/../g) ?? [], (hex) =>
              Number.parseInt(hex, 16),
            ).buffer
          : new Uint8Array(32).buffer;
      }),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const load = vi.fn();
function PrivateView() {
  const lock = useAppLock();
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <p>Model contents</p>
      <button type="button" onClick={lock}>
        Lock app
      </button>
    </>
  );
}
async function signIn(password = testPassword) {
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  // Flush the digest-driven state update and the session listeners before a
  // test advances its fake clock; observing DOM content alone can race effects.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });
  await screen.findByText(
    password === testPassword
      ? "Model contents"
      : "Incorrect password. Try again.",
  );
}
it("shows the password screen before mounting the app and rejects a wrong password", async () => {
  load.mockClear();
  render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  expect(screen.queryByText("Model contents")).toBeNull();
  expect(load).not.toHaveBeenCalled();
  await signIn("wrong");
  expect(load).not.toHaveBeenCalled();
  expect(localStorage.getItem(accessSessionKey)).toBeNull();
  await signIn();
  expect(load).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(accessSessionKey)).not.toContain(testPassword);
});
it("keeps an active session through refresh but locks after inactivity", async () => {
  let view = render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  await signIn();
  view.unmount();
  vi.setSystemTime(Date.now() + 1000);
  view = render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  expect(screen.getByText("Model contents")).toBeTruthy();
  act(() => vi.advanceTimersByTime(idleTimeout + 15000));
  expect(screen.queryByText("Model contents")).toBeNull();
  expect(screen.getByText(/timed out after 30 minutes/)).toBeTruthy();
  expect(localStorage.getItem(accessSessionKey)).toBeNull();
  view.unmount();
});
it("extends a live session for activity and locks when a sleeping tab resumes after expiry", async () => {
  render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  await signIn();
  act(() => vi.advanceTimersByTime(29 * 60 * 1000));
  fireEvent.pointerDown(window);
  act(() => vi.advanceTimersByTime(2 * 60 * 1000));
  expect(screen.getByText("Model contents")).toBeTruthy();
  vi.setSystemTime(Date.now() + idleTimeout);
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });
  expect(screen.queryByText("Model contents")).toBeNull();
});
it("locks immediately on request and when another tab clears its session", async () => {
  render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  await signIn();
  fireEvent.click(screen.getByRole("button", { name: "Lock app" }));
  expect(screen.getByLabelText("Password")).toBeTruthy();
  await signIn();
  localStorage.removeItem(accessSessionKey);
  fireEvent(
    window,
    new StorageEvent("storage", { key: accessSessionKey, newValue: null }),
  );
  expect(screen.queryByText("Model contents")).toBeNull();
});
it("supports the current tab when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  await signIn();
  expect(screen.getByText("Model contents")).toBeTruthy();
});
it("rejects expired, invalid, and future session timestamps", () => {
  const now = Date.now();
  for (const value of [null, NaN, Infinity, now + 1, now - idleTimeout])
    expect(sessionIsActive(value, now)).toBe(false);
  expect(sessionIsActive(now - idleTimeout + 1, now)).toBe(true);
  localStorage.setItem(accessSessionKey, JSON.stringify(now - idleTimeout));
  render(
    <AccessGate>
      <PrivateView />
    </AccessGate>,
  );
  expect(screen.getByLabelText("Password")).toBeTruthy();
});
