const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

/** Calendar date and clock time in Eastern Time, independent of the viewer's zone. */
export function easternTipoff(timestamp: string) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid game timestamp.");
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")} ${part("dayPeriod")}`,
    zone: part("timeZoneName"),
  };
}

/** Use reported status when known, otherwise the scheduled tipoff time. */
export function tipoffState(
  game: {
    startsAt: string;
    status: string;
    actualFirstHalfTotal: number | null;
  },
  now: number,
): "upcoming" | "started" | "inactive" {
  if (/cancel|postpon/i.test(game.status)) return "inactive";
  if (
    game.actualFirstHalfTotal !== null ||
    /in progress|halftime|final|end of|suspended|overtime/i.test(game.status)
  )
    return "started";
  if (/delay/i.test(game.status)) return "upcoming";
  return Date.parse(game.startsAt) <= now ? "started" : "upcoming";
}
