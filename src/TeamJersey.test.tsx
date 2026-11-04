// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import directory from "./data/team-identities.json";
import TeamJersey, { jerseyStyle } from "./TeamJersey";

afterEach(cleanup);

it("uses exact team identities and a neutral jersey instead of guessing a similar team", () => {
  const known = jerseyStyle("Butler Bulldogs");
  const unknown = jerseyStyle("Butler");
  expect(known.fallback).toBe(false);
  expect(known.abbreviation).toBe("BTLR");
  expect(unknown.fallback).toBe(true);
  expect(unknown.primary).toBe("#69717d");
  expect(unknown.abbreviation).toBe("B");
});

it("keeps jersey lettering readable across every bundled team color", () => {
  function luminance(hex: string) {
    const [r, g, b] = [1, 3, 5].map((start) => {
      const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  for (const name of Object.keys(directory.teams)) {
    const { primary, lettering } = jerseyStyle(name);
    const values = [luminance(primary), luminance(lettering)].sort(
      (a, b) => b - a,
    );
    expect(
      (values[0] + 0.05) / (values[1] + 0.05),
      name,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

it("gives repeated jerseys independent fabric gradients", () => {
  const { container } = render(
    <>
      <TeamJersey name="Butler Bulldogs" />
      <TeamJersey name="Butler Bulldogs" />
    </>,
  );
  const jerseys = [...container.querySelectorAll(".team-jersey")];
  const ids = jerseys.map(
    (jersey) => jersey.querySelector("linearGradient")?.id,
  );
  expect(ids[0]).toBeTruthy();
  expect(ids[0]).not.toBe(ids[1]);
  for (const [index, jersey] of jerseys.entries()) {
    expect(jersey.querySelector(`[fill="url(#${ids[index]})"]`)).toBeTruthy();
    expect(jersey.parentElement?.getAttribute("aria-hidden")).toBe("true");
  }
});
