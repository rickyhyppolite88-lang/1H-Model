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
import {
  accessPasswordDigest,
  accessSessionKey,
  supportNoticeKey,
} from "./AccessGate";
import AppEntry from "./AppEntry";
import { welcomeSessionKey } from "./WelcomeGate";

const { mounted } = vi.hoisted(() => ({ mounted: vi.fn() }));
vi.mock("./App", () => ({
  default: function Model() {
    useEffect(() => {
      mounted();
    }, []);
    return <p>Authenticated model</p>;
  },
}));
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mounted.mockClear();
  history.replaceState(null, "", "/");
  vi.stubGlobal("crypto", {
    subtle: {
      digest: vi.fn(async (_algorithm: string, data: Uint8Array) =>
        new TextDecoder().decode(data) === "fixture-password"
          ? Uint8Array.from(accessPasswordDigest.match(/../g) ?? [], (hex) =>
              Number.parseInt(hex, 16),
            ).buffer
          : new Uint8Array(32).buffer,
      ),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores the regular URL through welcome, password and support without mounting data early", async () => {
  render(<AppEntry />);
  expect(
    screen.queryByRole("heading", { name: "Under construction." }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enter 1H Model" }));
  expect(screen.getByLabelText("Password")).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "wrong" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });
  expect(
    await screen.findByText("Incorrect password. Try again."),
  ).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "fixture-password" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  });
  expect(
    await screen.findByRole("heading", {
      name: "Support is here if you need it.",
    }),
  ).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText("Authenticated model")).toBeTruthy();
  expect(mounted).toHaveBeenCalledTimes(1);
});

it("keeps existing bookmarks usable without requiring the retired admin fragment", () => {
  history.replaceState(null, "", "/#admin=old-bookmark");
  render(<AppEntry />);
  fireEvent.click(screen.getByRole("button", { name: "Enter 1H Model" }));
  expect(screen.getByLabelText("Password")).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Under construction." }),
  ).toBeNull();
});

it("retains an active session and skips the introduction on refresh", async () => {
  sessionStorage.setItem(welcomeSessionKey, "seen");
  sessionStorage.setItem(supportNoticeKey, "acknowledged");
  localStorage.setItem(accessSessionKey, JSON.stringify(Date.now()));
  render(<AppEntry />);
  expect(await screen.findByText("Authenticated model")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enter 1H Model" })).toBeNull();
  expect(screen.queryByLabelText("Password")).toBeNull();
});
