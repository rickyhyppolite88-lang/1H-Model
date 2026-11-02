import { z } from "zod";

const isoDate = z.iso.date();
const nullableStat = (min: number, max: number) =>
  z.number().min(min).max(max).nullable();

export const teamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  gamesPlayed: z.number().int().min(0).max(60),
  firstHalfPoints: nullableStat(0, 100),
  firstHalfAllowed: nullableStat(0, 100).optional(),
  pace: nullableStat(30, 120),
  offensiveEfficiency: nullableStat(0.3, 2),
  defensiveEfficiency: nullableStat(0.3, 2),
  strengthOfSchedule: nullableStat(-100, 100),
});

export const datasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    season: z.string().regex(/^\d{4}-\d{2}$/),
    asOf: isoDate,
    retrievedAt: z.iso.datetime(),
    source: z.object({
      name: z.string(),
      urls: z.record(z.string(), z.url({ protocol: /^https$/ })),
    }),
    teams: z.array(teamSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const year = Number(data.season.slice(0, 4));
    if (data.season !== `${year}-${String(year + 1).slice(-2)}`) {
      ctx.addIssue({
        code: "custom",
        message: "Season must span consecutive years",
      });
    }
    if (data.asOf < `${year}-07-01` || data.asOf > `${year + 1}-06-30`) {
      ctx.addIssue({
        code: "custom",
        message: "Snapshot date does not belong to its season",
      });
    }
    const ids = new Set<string>();
    for (const team of data.teams) {
      if (ids.has(team.id))
        ctx.addIssue({ code: "custom", message: `Duplicate team: ${team.id}` });
      ids.add(team.id);
    }
  });

export type TeamStats = z.infer<typeof teamSchema>;
export type SeasonDataset = z.infer<typeof datasetSchema>;
export type Metrics = Pick<
  TeamStats,
  "firstHalfPoints" | "pace" | "offensiveEfficiency" | "defensiveEfficiency"
>;
export type CompleteMetrics = { [K in keyof Metrics]: number };

export function hasMetrics(team: Metrics): team is Metrics & CompleteMetrics {
  return Object.values(team).every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

export const metricKeys = [
  "firstHalfPoints",
  "pace",
  "offensiveEfficiency",
  "defensiveEfficiency",
] as const;

export function completeMetrics(team: TeamStats): CompleteMetrics | null {
  const metrics = Object.fromEntries(
    metricKeys.map((key) => [key, team[key]]),
  ) as Metrics;
  return hasMetrics(metrics) ? metrics : null;
}
