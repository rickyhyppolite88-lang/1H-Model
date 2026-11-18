// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyAdminEntry } from "./adminEntry";
import ConstructionGate from "./ConstructionGate";

vi.mock("./adminEntry", () => ({ verifyAdminEntry: vi.fn() }));
const entry = `#admin=${"a".repeat(32)}`;
const mount = vi.fn();
function PrivateApp() {
  useEffect(() => {
    mount();
  }, []);
  return (
    <label>
      Admin password
      <input type="password" />
    </label>
  );
}
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  mount.mockClear();
  vi.mocked(verifyAdminEntry).mockImplementation(
    async (fragment) => fragment === entry,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows only construction at the normal link even with a previous session", async () => {
  localStorage.setItem("1h-model-access-v1", JSON.stringify(Date.now()));
  localStorage.setItem("1h-model-admin-access-v2", JSON.stringify(Date.now()));
  render(
    <ConstructionGate>
      <PrivateApp />
    </ConstructionGate>,
  );
  await act(async () => {});
  expect(
    screen.getByRole("heading", { name: "Under construction." }),
  ).toBeTruthy();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /admin|sign in/i })).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(mount).not.toHaveBeenCalled();
});

it("does not reveal the password form from a guessed admin fragment", async () => {
  history.replaceState(null, "", "/#admin=guessed");
  render(
    <ConstructionGate>
      <PrivateApp />
    </ConstructionGate>,
  );
  await act(async () => {});
  expect(
    screen.getByRole("heading", { name: "Under construction." }),
  ).toBeTruthy();
  expect(mount).not.toHaveBeenCalled();
});

it("opens the private entry and unmounts it when returning to the regular link", async () => {
  history.replaceState(null, "", `/${entry}`);
  render(
    <ConstructionGate>
      <PrivateApp />
    </ConstructionGate>,
  );
  expect(await screen.findByLabelText("Admin password")).toBeTruthy();
  await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  history.replaceState(null, "", "/");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await act(async () => {});
  expect(screen.queryByLabelText("Admin password")).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Under construction." }),
  ).toBeTruthy();
});

it("stays public if verification fails or an earlier request resolves after navigation", async () => {
  let resolveEntry: ((value: boolean) => void) | undefined;
  vi.mocked(verifyAdminEntry).mockImplementation((fragment) =>
    fragment === entry
      ? new Promise((resolve) => {
          resolveEntry = resolve;
        })
      : Promise.reject(new Error("Unavailable")),
  );
  history.replaceState(null, "", `/${entry}`);
  render(
    <ConstructionGate>
      <PrivateApp />
    </ConstructionGate>,
  );
  history.replaceState(null, "", "/");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await act(async () => {
    resolveEntry?.(true);
  });
  expect(screen.queryByLabelText("Admin password")).toBeNull();
  expect(mount).not.toHaveBeenCalled();
});
