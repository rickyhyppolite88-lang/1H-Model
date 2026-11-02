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
