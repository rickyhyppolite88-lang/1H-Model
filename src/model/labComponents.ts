import {
  canonicalLabForecasts,
  gradeLab,
  type LabForecast,
  type LabStore,
} from "./lab";
import { csvCell } from "./predictions";

const clampContext = (value: number) => Math.max(-4, Math.min(4, value));
export const componentNames = {
  baseline: "Actual core",
  defense: "Core + 1H defense",
  context: "Defense + venue/context",
  foul: "Defense + foul/FT",
  full: "Full Lab v2",
  noHomeAway: "Full without home/away",
  noNeutral: "Full without neutral-site effect",
  noMatchup: "Full without game-type effect",
  noCrowd: "Full without crowd effect",
};
type Component = keyof typeof componentNames;

/** Replay frozen numerical components only. No refitting or new qualifications. */
export function savedLabComponents(row: LabForecast) {
  const defense = row.inputs.defenseAdjustedTotal;
  const context = row.context;
  const foul = row.foulExposure;
  if (
    row.methodId !== "enhanced-baseline-v2" ||
    row.baselineTotal === null ||
    row.total === null ||
    typeof defense !== "number" ||
    !context ||
    !foul ||
    Math.abs(defense + context.adjustment + foul.pointsAdjustment - row.total) >
      1e-6
  )
    return null;
  const parts = [
    context.homeAwayAdjustment,
    context.neutralAdjustment,
    context.matchupAdjustment,
    context.crowdAdjustment,
  ];
  const contextSum = parts.reduce((sum, value) => sum + value, 0);
  if (Math.abs(clampContext(contextSum) - context.adjustment) > 1e-6)
    return null;
  const without = (value: number) =>
    defense + clampContext(contextSum - value) + foul.pointsAdjustment;
  return {
    baseline: row.baselineTotal,
    defense,
    context: defense + context.adjustment,
    foul: defense + foul.pointsAdjustment,
    full: row.total,
    noHomeAway: without(context.homeAwayAdjustment),
    noNeutral: without(context.neutralAdjustment),
    noMatchup: without(context.matchupAdjustment),
    noCrowd: without(context.crowdAdjustment),
  } satisfies Record<Component, number>;
}

export function labComponentComparison(
  forecasts: LabForecast[],
  store: LabStore,
) {
  const cohort = canonicalLabForecasts(forecasts, store.entryPolicy).flatMap(
    (row) => {
      const totals = savedLabComponents(row);
      const result = gradeLab(row, store);
      return totals && result.error !== null && result.actual !== null
        ? [{ row, totals, actual: result.actual }]
        : [];
    },
  );
  const baselineMae = cohort.length
    ? cohort.reduce(
        (sum, entry) => sum + Math.abs(entry.totals.baseline - entry.actual),
        0,
      ) / cohort.length
    : null;
  return (Object.keys(componentNames) as Component[]).map((key) => {
    let wins = 0,
      losses = 0,
      pushes = 0,
      noLean = 0;
    for (const entry of cohort) {
      if (
        !["qualified", "control"].includes(entry.row.status) ||
        entry.row.line === null
      )
        continue;
      const line = entry.row.line;
      const total = entry.totals[key];
      if (total === line) noLean++;
      else if (entry.actual === line) pushes++;
      else if (total > line === entry.actual > line) wins++;
      else losses++;
    }
    const mae = cohort.length
      ? cohort.reduce(
          (sum, entry) => sum + Math.abs(entry.totals[key] - entry.actual),
          0,
        ) / cohort.length
      : null;
    return {
      key,
      name: componentNames[key],
      games: cohort.length,
      mae,
      delta: mae !== null && baselineMae !== null ? mae - baselineMae : null,
      wins,
      losses,
      pushes,
      noLean,
      winRate: wins + losses ? wins / (wins + losses) : null,
    };
  });
}

export function labComponentsToCsv(forecasts: LabForecast[], store: LabStore) {
  return `${[
    [
      "component",
      "completed_matching_games",
      "point_mae",
      "mae_minus_actual_core",
      "same_lab_selected_cohort_wins",
      "same_lab_selected_cohort_losses",
      "pushes",
      "no_lean",
      "observed_hit_rate_NOT_probability",
    ],
    ...labComponentComparison(forecasts, store).map((r) => [
      r.name,
      r.games,
      r.mae,
      r.delta,
      r.wins,
      r.losses,
      r.pushes,
      r.noLean,
      r.winRate,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}
