import { useEffect, useState } from "react";
import { z } from "zod";

export const preferencePrefix = "1h-model-view-v1:";
export const preferenceLifetime = 7 * 24 * 60 * 60 * 1000;
const resetEvent = "1h-model-reset-views";
const envelope = z.object({ savedAt: z.number().finite(), value: z.unknown() });
export const preferenceText = z.string().max(200);
export const preferenceFlag = z.boolean();
export const preferencePage = z.number().int().min(0).max(10000);
export const preferenceLineDate: z.ZodType<string> = z.union([
  z.literal("today"),
  z.iso.date(),
]);
export const preferenceRecordDate: z.ZodType<string> = z.union([
  z.literal("all"),
  z.iso.date(),
]);
export const preferenceSportsbook = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/);
export const preferenceSection: z.ZodType<string> = z.enum([
  "predictions",
  "record",
  "audit",
  "evaluation",
  "data",
  "tracker",
  "method",
  "settings",
]);
export const preferenceTiming: z.ZodType<string> = z.enum([
  "all",
  "started",
  "upcoming",
]);
export const preferenceCoverage: z.ZodType<string> = z.enum([
  "all",
  "available",
  "unavailable",
  "completed",
]);
export const preferenceGroup: z.ZodType<string> = z.enum([
  "all",
  "top25",
  "conference",
]);
export const preferenceSort: z.ZodType<string> = z.enum(["signal", "time"]);
export const preferenceRecordView: z.ZodType<string> = z.enum([
  "games",
  "official",
  "all",
]);

export function readPreference<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(`${preferencePrefix}${key}`);
    if (!raw) return fallback;
    const stored = envelope.parse(JSON.parse(raw));
    const age = Date.now() - stored.savedAt;
    if (age < 0 || age >= preferenceLifetime) return fallback;
    const result = schema.safeParse(stored.value);
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

export function resetViewPreferences() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(preferencePrefix)) localStorage.removeItem(key);
    }
  } catch {
    // Reset the current view even when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(resetEvent));
}

/** View choices survive refreshes; forecast and session data use separate storage. */
export function usePreference<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
) {
  const [value, setValue] = useState(() =>
    readPreference(key, schema, fallback),
  );
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(
          `${preferencePrefix}${key}`,
          JSON.stringify({ savedAt: Date.now(), value }),
        );
      } catch {
        /* The app remains usable with in-memory preferences. */
      }
    };
    save();
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [key, value]);
  useEffect(() => {
    const reset = () => setValue(fallback);
    window.addEventListener(resetEvent, reset);
    return () => window.removeEventListener(resetEvent, reset);
  }, [fallback]);
  return [value, setValue] as const;
}
