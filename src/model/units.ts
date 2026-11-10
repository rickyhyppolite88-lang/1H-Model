import { z } from "zod";
import {
  canonicalLabForecasts,
  gradeLab,
  type LabForecast,
  type LabStore,
} from "./lab";
import {
  canonicalRecords,
  type ForecastRecord,
  type RecordStore,
  recordGrade,
} from "./predictionRecord";
import { csvCell } from "./predictions";

export const unitSizes = [0.5, 1, 1.5, 2] as const;
export const unitPolicy = {
  id: "confidence-units-v1",
  // Ranking thresholds, not estimated probabilities of winning.
  twoUnitMinimum: 90,
  description:
    "0.5u below 60; 1u at 60–74; 1.5u at 75–89; 2u at 90+. Review / missing scores: no stake.",
} as const;

export function unitsForScore(score: number | null) {
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100)
    return null;
  return score >= unitPolicy.twoUnitMinimum
    ? 2
    : score >= 75
      ? 1.5
      : score >= 60
        ? 1
        : 0.5;
}

export const unitAssignmentSchema = z
  .object({
    id: z.string(),
    source: z.enum(["actual", "lab"]),
    recordId: z.string(),
    season: z.string(),
    method: z.string(),
    gameId: z.string(),
    gameDate: z.iso.date(),
    assignedAt: z.iso.datetime(),
    startsAt: z.iso.datetime(),
    policy: z.literal("confidence-units-v1"),
    score: z.number().min(0).max(100),
    units: z.union([
      z.literal(0.5),
      z.literal(1),
      z.literal(1.5),
      z.literal(2),
    ]),
    sportsbook: z.string(),
    basis: z.enum(["opening", "latest"]),
    side: z.enum(["OVER", "UNDER"]),
    line: z.number().positive(),
    price: z.number().nullable(),
  })
  .refine(
    (row) => Date.parse(row.assignedAt) < Date.parse(row.startsAt),
    "Stakes must be assigned before tipoff",
  );
export const unitLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    assignments: z.array(unitAssignmentSchema),
  })
  .superRefine((ledger, context) => {
    const ids = new Set<string>();
    const selections = new Set<string>();
    if (Date.parse(ledger.startedAt) > Date.parse(ledger.updatedAt))
      context.addIssue({
        code: "custom",
        message: "Unit ledger cannot precede its launch",
      });
    for (const row of ledger.assignments) {
      const selection = stakeSelection(row);
      if (
        ids.has(row.id) ||
        selections.has(selection) ||
        Date.parse(row.assignedAt) < Date.parse(ledger.startedAt) ||
        Date.parse(row.assignedAt) > Date.parse(ledger.updatedAt)
      )
        context.addIssue({
          code: "custom",
          message: "Duplicate or backdated stake assignment",
        });
      ids.add(row.id);
      selections.add(selection);
    }
  });
export type UnitLedger = z.infer<typeof unitLedgerSchema>;
export type UnitAssignment = z.infer<typeof unitAssignmentSchema>;
const stakeSelection = (
  row: Pick<
    UnitAssignment,
    "source" | "season" | "method" | "sportsbook" | "basis" | "gameId"
  >,
) =>
  `${row.source}:${row.season}:${row.method}:${row.sportsbook}:${row.basis}:${row.gameId}`;
export type UnitMode = "tracked" | "historical";
export const unitPlaySchema = z.object({
  id: z.string(),
  source: z.enum(["actual", "lab"]),
  season: z.string(),
  method: z.string(),
  sportsbook: z.string(),
  basis: z.enum(["opening", "latest"]),
  assignedAt: z.iso.datetime().nullable(),
  policy: z.string().nullable(),
  date: z.iso.date(),
  away: z.string(),
  home: z.string(),
  side: z.string().nullable(),
  line: z.number().nullable(),
  price: z.number().nullable(),
  score: z.number().nullable(),
  units: z.number().positive().nullable(),
  grade: z.string(),
  actual: z.number().nullable(),
  net: z.number().nullable(),
  mode: z.enum(["tracked", "historical"]).nullable(),
});
export const unitResultsSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  plays: z.array(unitPlaySchema),
});
export type UnitPlay = z.infer<typeof unitPlaySchema>;

export function savedRecordPrice(record: ForecastRecord) {
  const quote = record.quotes.find(
    (row) => row.sportsbook === record.sportsbook,
  )?.[record.basis];
  if (!quote || quote.total !== record.comparison.line) return null;
  return record.comparison.lean === "OVER"
    ? quote.overPrice
    : record.comparison.lean === "UNDER"
      ? quote.underPrice
      : null;
}
export function validAmericanPrice(price: number | null): price is number {
  return price !== null && Number.isFinite(price) && Math.abs(price) >= 100;
}
/** One unit is the amount risked; returned stake is excluded from net profit. */
export function settleUnits(
  units: number | null,
  price: number | null,
  grade: string,
) {
  if (units === null || units <= 0 || !validAmericanPrice(price)) return null;
  if (grade === "Push") return 0;
  if (grade === "Loss") return -units;
  if (grade === "Win") return units * (price > 0 ? price / 100 : 100 / -price);
  return null;
}
export const formatUnits = (value: number | null) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}u`;
export const formatPrice = (value: number | null) =>
  validAmericanPrice(value)
    ? `${value > 0 ? "+" : ""}${value}`
    : "Odds unavailable";

/** Append stakes on the first eligible capture after launch; never resize or backfill a finished play. */
export function updateUnitLedger(
  previous: UnitLedger | null,
  actual: RecordStore,
  lab: LabStore,
  at: string,
): UnitLedger {
  if (previous && Date.parse(at) < Date.parse(previous.updatedAt))
    throw new Error("Cannot backdate the unit ledger");
  const assignments = [...(previous?.assignments ?? [])];
  const known = new Set(assignments.map(stakeSelection));
  const add = (
    row: Omit<UnitAssignment, "assignedAt" | "policy" | "units">,
  ) => {
    const units = unitsForScore(row.score);
    if (
      known.has(stakeSelection(row)) ||
      units === null ||
      Date.parse(at) >= Date.parse(row.startsAt)
    )
      return;
    assignments.push(
      unitAssignmentSchema.parse({
        ...row,
        assignedAt: at,
        policy: unitPolicy.id,
        units,
      }),
    );
    known.add(stakeSelection(row));
  };
  for (const row of canonicalRecords(actual.records)) {
    const side = row.comparison.lean;
    if (
      (side !== "OVER" && side !== "UNDER") ||
      row.comparison.line === null ||
      row.signal.score === null ||
      row.signal.label === "Outlier review" ||
      Date.parse(row.recordedAt) > Date.parse(at) ||
      actual.results.some(
        (r) => r.season === row.season && r.gameId === row.gameId,
      )
    )
      continue;
    if (
      actual.records.some(
        (version) =>
          version.season === row.season &&
          version.gameId === row.gameId &&
          Date.parse(version.prediction.startsAt) <= Date.parse(at),
      )
    )
      continue;
    add({
      id: `actual:${row.id}`,
      source: "actual",
      recordId: row.id,
      season: row.season,
      method: row.modelVersion,
      gameId: row.gameId,
      gameDate: row.gameDate,
      startsAt: row.prediction.startsAt,
      score: row.signal.score,
      sportsbook: row.sportsbook,
      basis: row.basis,
      side,
      line: row.comparison.line,
      price: savedRecordPrice(row),
    });
  }
  for (const row of canonicalLabForecasts(lab.forecasts)) {
    if (
      row.status !== "qualified" ||
      (row.side !== "OVER" && row.side !== "UNDER") ||
      row.line === null ||
      row.signalStrength === null ||
      Date.parse(row.recordedAt) > Date.parse(at) ||
      lab.results.some(
        (r) => r.season === row.season && r.gameId === row.gameId,
      )
    )
      continue;
    if (
      lab.forecasts.some(
        (version) =>
          version.season === row.season &&
          version.gameId === row.gameId &&
          Date.parse(version.startsAt) <= Date.parse(at),
      )
    )
      continue;
    add({
      id: `lab:${row.id}`,
      source: "lab",
      recordId: row.id,
      season: row.season,
      method: row.methodId,
      gameId: row.gameId,
      gameDate: row.gameDate,
      startsAt: row.startsAt,
      score: row.signalStrength,
      sportsbook: row.sportsbook,
      basis: "latest",
      side: row.side,
      line: row.line,
      price: row.side === "OVER" ? row.overPrice : row.underPrice,
    });
  }
  return unitLedgerSchema.parse({
    schemaVersion: 1,
    startedAt: previous?.startedAt ?? at,
    updatedAt: at,
    assignments,
  });
}

function accounting(
  ledger: UnitLedger | null,
  source: "actual" | "lab",
  id: string,
  startsAt: string,
) {
  const saved = ledger?.assignments.find((row) => row.id === `${source}:${id}`);
  if (saved) return { units: saved.units, mode: "tracked" as const, saved };
  // A retrospective flat-stake comparison, explicitly separate from recorded stakes.
  if (ledger && Date.parse(startsAt) <= Date.parse(ledger.startedAt))
    return { units: 1, mode: "historical" as const, saved: null };
  return { units: null, mode: null, saved: null };
}

export function actualUnitPlay(
  record: ForecastRecord,
  results: RecordStore["results"],
  ledger: UnitLedger | null,
): UnitPlay {
  const { grade, actual } = recordGrade(record, results);
  const stake = accounting(
    ledger,
    "actual",
    record.id,
    record.prediction.startsAt,
  );
  const price = stake.saved?.price ?? savedRecordPrice(record);
  return {
    id: record.id,
    source: "actual",
    season: record.season,
    method: record.modelVersion,
    sportsbook: record.sportsbook,
    basis: record.basis,
    assignedAt: stake.saved?.assignedAt ?? null,
    policy: stake.saved?.policy ?? null,
    date: record.gameDate,
    away: record.prediction.awayTeam,
    home: record.prediction.homeTeam,
    side: record.comparison.lean,
    line: record.comparison.line,
    price,
    score: stake.saved?.score ?? record.signal.score,
    units: stake.units,
    grade,
    actual,
    net: settleUnits(stake.units, price, grade),
    mode: stake.mode,
  };
}
export function labUnitPlay(
  row: LabForecast,
  store: LabStore,
  ledger: UnitLedger | null,
): UnitPlay {
  const result = gradeLab(row, store);
  const stake =
    row.status === "qualified"
      ? accounting(ledger, "lab", row.id, row.startsAt)
      : { units: null, mode: null, saved: null };
  const price =
    stake.saved?.price ??
    (row.side === "OVER"
      ? row.overPrice
      : row.side === "UNDER"
        ? row.underPrice
        : null);
  return {
    id: row.id,
    source: "lab",
    season: row.season,
    method: row.methodId,
    sportsbook: row.sportsbook,
    basis: "latest",
    assignedAt: stake.saved?.assignedAt ?? null,
    policy: stake.saved?.policy ?? null,
    date: row.gameDate,
    away: row.awayTeam,
    home: row.homeTeam,
    side: row.side,
    line: row.line,
    price,
    score: stake.saved?.score ?? row.signalStrength,
    units: stake.units,
    grade: result.grade,
    actual: result.actual,
    net: settleUnits(stake.units, price, result.grade),
    mode: stake.mode,
  };
}
export function summarizeUnits(plays: UnitPlay[]) {
  const settled = plays.filter((row) => row.net !== null);
  return {
    net: settled.reduce((sum, row) => sum + (row.net ?? 0), 0),
    risk: settled.reduce((sum, row) => sum + (row.units ?? 0), 0),
    settled: settled.length,
    unresolved: plays.filter((row) => row.units !== null && row.net === null)
      .length,
    wins: settled.filter((row) => row.grade === "Win").length,
    losses: settled.filter((row) => row.grade === "Loss").length,
    pushes: settled.filter((row) => row.grade === "Push").length,
  };
}
export function unitPlaysCsv(plays: UnitPlay[]) {
  return [
    [
      "date_et",
      "away",
      "home",
      "side",
      "line",
      "american_odds",
      "saved_score",
      "units_risked",
      "actual_1h",
      "result",
      "net_units",
      "accounting",
      "record_id",
      "method",
      "sportsbook",
      "line_basis",
      "stake_assigned_at",
      "stake_policy",
      "source",
      "season",
    ],
    ...plays.map((row) => [
      row.date,
      row.away,
      row.home,
      row.side,
      row.line,
      row.price,
      row.score,
      row.units,
      row.actual,
      row.grade,
      row.net === null ? null : Number(row.net.toFixed(6)),
      row.mode === "historical"
        ? "historical_1u_simulation"
        : row.mode === "tracked"
          ? "recorded_model_stake"
          : "no_stake",
      row.id,
      row.method,
      row.sportsbook,
      row.basis,
      row.assignedAt,
      row.policy,
      row.source,
      row.season,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}
