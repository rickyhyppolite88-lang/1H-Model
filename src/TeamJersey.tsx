import { useId } from "react";
import directory from "./data/team-identities.json";

type Identity = {
  abbreviation: string;
  primaryColor: string | null;
  secondaryColor: string | null;
};
const teams: Record<string, Identity> = directory.teams;

function luminance(color: string) {
  const values = color
    .slice(1)
    .match(/../g)
    ?.map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return values
    ? values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
    : 0;
}

export function jerseyStyle(name: string) {
  const identity = teams[name];
  const primary = identity?.primaryColor ?? "#69717d";
  const lettering = luminance(primary) > 0.179 ? "#000000" : "#ffffff";
  const secondary = identity?.secondaryColor;
  const contrast = secondary
    ? (Math.max(luminance(primary), luminance(secondary)) + 0.05) /
      (Math.min(luminance(primary), luminance(secondary)) + 0.05)
    : 0;
  return {
    primary,
    trim: secondary && contrast >= 1.5 ? secondary : lettering,
    lettering,
    abbreviation:
      identity?.abbreviation ??
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((word) => word[0])
        .join("")
        .toUpperCase(),
    fallback: !identity?.primaryColor,
  };
}

export default function TeamJersey({ name }: { name: string }) {
  const style = jerseyStyle(name);
  const shadeId = useId();
  return (
    <span
      className="team-mark team-jersey-mark"
      aria-hidden="true"
      data-jersey-fallback={style.fallback || undefined}
    >
      <svg
        className="team-jersey"
        viewBox="0 0 40 50"
        focusable="false"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={shadeId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <path
          className="jersey-outline"
          d="M10 3 16 1c0 7 8 7 8 0l6 2c-1 8 1 12 5 14l-3 30H8L5 17c4-2 6-6 5-14Z"
          fill={style.primary}
          strokeWidth="1.2"
        />
        <path
          d="M10 3 16 1c0 7 8 7 8 0l6 2c-1 8 1 12 5 14l-3 30H8L5 17c4-2 6-6 5-14Z"
          fill={`url(#${shadeId})`}
        />
        <path
          d="M16 2c0 7 8 7 8 0M10 4c1 7-1 11-4 14m24-14c-1 7 1 11 4 14M9 44h22"
          fill="none"
          stroke={style.trim}
          strokeWidth="1.8"
        />
        <path
          d="m9 22 1.5 19m20.5-19-1.5 19"
          fill="none"
          stroke={style.trim}
          strokeOpacity="0.8"
          strokeWidth="1.3"
        />
        <text
          x="20"
          y="25"
          textAnchor="middle"
          fill={style.lettering}
          fontSize={style.abbreviation.length > 4 ? "5.5" : "7"}
          fontWeight="800"
          fontFamily="Arial, sans-serif"
        >
          {style.abbreviation.slice(0, 6)}
        </text>
        <path
          d="M16 33h8m-6 3h4"
          fill="none"
          stroke={style.lettering}
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
      </svg>
    </span>
  );
}
