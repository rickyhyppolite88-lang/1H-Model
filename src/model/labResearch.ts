import { z } from "zod";
import type { SeasonGame, SeasonLedger } from "./audit";
import type { LabForecast, LabHalf } from "./lab";
import { marketStatus } from "./marketCoverage";
import { type RecordStore, recordGrade } from "./predictionRecord";
import type { PredictionFeed, PredictionRow } from "./predictions";
import {
  pregameCrew,
  type RefereeStore,
  refereeProfileSchema,
  summarizeReferees,
} from "./referees";
import { easternTipoff } from "./time";

export const researchForecastSchema = z.object({
  modelPath: z.string().nullable(),
  fittedAt: z.iso.datetime().nullable(),
  trainingGames: z.number().int(),
  probability: z.number().min(0).max(1).nullable(),
  marketProbability: z.number().min(0).max(1).nullable(),
  expectedReturn: z.number().nullable(),
  paperUnits: z.union([z.literal(0), z.literal(1)]),
  crewAssignmentId: z.string().nullable(),
  crewObservedAt: z.iso.datetime().nullable(),
  crew: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pricedGames: z.number().int(),
      pointsAssociation: z.number(),
    }),
  ),
  refereePointsEquivalent: z.number().nullable(),
  refereeBaselineProbability: z.number().min(0).max(1).nullable(),
});
export const researchModelSchema = z.object({
  schemaVersion: z.literal(1),
  method: z.literal("market-core-v3+referee-core-v4"),
  date: z.iso.date(),
  fittedAt: z.iso.datetime(),
  trainingGames: z.number().int(),
  trainingIds: z.array(z.string()),
  latestOutcomeAt: z.iso.datetime().nullable(),
  sigma: z.number().positive(),
  scales: z.array(z.number().positive()).length(2),
  coefficients: z.array(z.number()).length(2),
  sourceHash: z.string(),
  refereeSourceHash: z.string(),
  refereeProfiles: z.array(refereeProfileSchema),
  refereeTrainingGames: z.number().int(),
  rules: z.object({
    minimumTrainingGames: z.literal(80),
    ridge: z.literal(20),
    expectedReturn: z.literal(0.05),
    refPseudoGames: z.literal(20),
    refMinimumGames: z.literal(3),
    refMinimumPricedHalves: z.literal(20),
    refPointCap: z.literal(2),
  }),
});
export type ResearchModel = z.infer<typeof researchModelSchema>;

const isoBefore = (a: string, b: string) => Date.parse(a) <= Date.parse(b);
const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
export const sigmoid = (value: number) =>
  1 / (1 + Math.exp(-clamp(value, -30, 30)));
const logit = (value: number) => Math.log(value / (1 - value));
export function impliedProbability(price: number | null) {
  return price !== null && Number.isFinite(price) && Math.abs(price) >= 100
    ? price > 0
      ? 100 / (100 + price)
      : -price / (100 - price)
    : null;
}
export function fairOverProbability(
  overPrice: number | null,
  underPrice: number | null,
) {
  const over = impliedProbability(overPrice),
    under = impliedProbability(underPrice);
  return over !== null && under !== null ? over / (over + under) : null;
}
export function returnPerUnit(probability: number, price: number | null) {
  return impliedProbability(price) !== null && price !== null
    ? probability * (price > 0 ? price / 100 : 100 / -price) - (1 - probability)
    : null;
}

function observedHalves(halves: LabHalf[], at: string, exclude: string) {
  const latest = new Map<string, LabHalf>();
  for (const half of halves)
    if (
      half.bothD1 &&
      half.gameId !== exclude &&
      isoBefore(half.observedAt, at) &&
      Date.parse(half.startsAt) < Date.parse(at)
    ) {
      const old = latest.get(half.gameId);
      if (!old || half.observedAt > old.observedAt)
        latest.set(half.gameId, half);
    }
  return [...latest.values()];
}
const possessions = (half: LabHalf) =>
  half.teams.reduce(
    (n, team) =>
      n + team.fga - team.offensiveRebounds + team.turnovers + 0.475 * team.fta,
    0,
  ) / 2;
export function shotOpportunity(
  gameId: string,
  awayId: string,
  homeId: string,
  expectedPossessions: number,
  halves: LabHalf[],
  at: string,
) {
  const history = observedHalves(halves, at, gameId).filter(
    (h) => possessions(h) >= 15 && possessions(h) <= 60,
  );
  if (history.length < 20) return null;
  const teams = history.flatMap((half) =>
    half.teams.map((team) => {
      const opponent = half.teams.find((t) => t.espnId !== team.espnId);
      return {
        id: team.espnId,
        poss: possessions(half),
        net: team.offensiveRebounds - team.turnovers,
        allowed:
          (opponent?.offensiveRebounds ?? 0) - (opponent?.turnovers ?? 0),
      };
    }),
  );
  const leaguePoss = average(teams.map((t) => t.poss)),
    leagueNet = average(teams.map((t) => t.net));
  const rates = [awayId, homeId].map((id) => {
    const own = teams.filter((t) => t.id === id);
    if (!own.length) return null;
    const denominator = own.reduce((n, t) => n + t.poss, 0) + 4 * leaguePoss;
    return {
      offense:
        (own.reduce((n, t) => n + t.net, 0) + 4 * leagueNet) / denominator,
      defense:
        (own.reduce((n, t) => n + t.allowed, 0) + 4 * leagueNet) / denominator,
    };
  });
  if (rates[0] === null || rates[1] === null) return null;
  return (
    expectedPossessions *
    ((rates[0].offense + rates[1].defense) / 2 +
      (rates[1].offense + rates[0].defense) / 2 -
      (2 * leagueNet) / leaguePoss)
  );
}

type TrainingRow = {
  id: string;
  gameId: string;
  startsAt: string;
  awayId: string;
  homeId: string;
  actual: number;
  line: number;
  total: number;
  shot: number;
  market: number;
  observedAt: string;
};
export function researchTrainingRows(
  record: RecordStore,
  ledger: SeasonLedger,
  halves: LabHalf[],
  at: string,
): TrainingRow[] {
  const today = easternTipoff(at).date;
  const results = record.results.filter((r) => isoBefore(r.observedAt, at));
  const games = new Map(ledger.games.map((g) => [g.id, g]));
  const selected = new Map<string, TrainingRow>();
  for (const row of [...record.records].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  )) {
    if (
      row.state !== "pregame" ||
      row.gameDate >= today ||
      !isoBefore(row.recordedAt, at) ||
      Date.parse(row.recordedAt) >= Date.parse(row.prediction.startsAt) ||
      row.prediction.featureKind !== "captured_pregame"
    )
      continue;
    const q = row.quotes.find((quote) => quote.sportsbook === "draftkings");
    const line = q?.latest?.total ?? null;
    if (
      !q ||
      line === null ||
      !q.latest ||
      !isoBefore(q.latestCapturedAt, row.recordedAt) ||
      Date.parse(q.latestCapturedAt) >= Date.parse(row.prediction.startsAt)
    )
      continue;
    if (
      row.prediction.marketCoverage &&
      marketStatus(row.prediction, "draftkings") !== "available"
    )
      continue;
    const market = fairOverProbability(
      q.latest.overPrice ?? null,
      q.latest.underPrice ?? null,
    );
    const grade = recordGrade(row, results);
    const game = games.get(row.gameId);
    const features = row.features;
    if (
      !features ||
      !isoBefore(features.capturedAt, row.recordedAt) ||
      (features.statsRetrievedAt &&
        !isoBefore(features.statsRetrievedAt, row.recordedAt))
    )
      continue;
    if (
      market === null ||
      grade.actual === null ||
      grade.error === null ||
      !game ||
      !features ||
      row.prediction.projectedFirstHalfTotal === null ||
      grade.actual === line
    )
      continue;
    const awayId =
      row.participants?.away.espnId ??
      (features.away.id === game.away.modelId ? game.away.espnId : null);
    const homeId =
      row.participants?.home.espnId ??
      (features.home.id === game.home.modelId ? game.home.espnId : null);
    if (!awayId || !homeId) continue;
    const shot = shotOpportunity(
      row.gameId,
      awayId,
      homeId,
      (features.away.pace + features.home.pace) / 4,
      halves,
      row.recordedAt,
    );
    if (shot === null) continue;
    const result = results
      .filter((r) => r.gameId === row.gameId && r.season === row.season)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .at(-1);
    if (!result) continue;
    selected.set(row.gameId, {
      id: row.id,
      gameId: row.gameId,
      startsAt: row.prediction.startsAt,
      awayId,
      homeId,
      actual: grade.actual,
      line,
      total: row.prediction.projectedFirstHalfTotal,
      shot,
      market,
      observedAt: result.observedAt,
    });
  }
  return [...selected.values()].sort((a, b) =>
    a.gameId.localeCompare(b.gameId),
  );
}

export function fitMarketCoefficients(
  rows: { features: number[]; market: number; over: boolean }[],
  ridge = 20,
) {
  if (!rows.length) return { coefficients: [0, 0], scales: [1, 1] };
  const scales = [0, 1].map(
    (i) => Math.sqrt(average(rows.map((r) => r.features[i] ** 2))) || 1,
  );
  const normalized = rows.map((r) => ({
    ...r,
    features: r.features.map((v, i) => v / scales[i]),
  }));
  let coefficients = [0, 0];
  const step =
    1 /
    (ridge +
      0.25 *
        normalized.reduce(
          (n, r) => n + r.features.reduce((s, v) => s + v * v, 0),
          0,
        ));
  for (let iteration = 0; iteration < 2000; iteration++) {
    const gradient = coefficients.map((v) => ridge * v);
    for (const row of normalized) {
      const p = sigmoid(
        logit(row.market) +
          row.features.reduce((n, v, i) => n + v * coefficients[i], 0),
      );
      for (let i = 0; i < 2; i++)
        gradient[i] += row.features[i] * (p - Number(row.over));
    }
    const next = coefficients.map((v, i) =>
      Math.max(0, v - step * gradient[i]),
    );
    const difference = Math.max(
      ...next.map((v, i) => Math.abs(v - coefficients[i])),
    );
    coefficients = next;
    if (difference < 1e-10) break;
  }
  return { coefficients, scales };
}

export function fitResearchModel(
  record: RecordStore,
  ledger: SeasonLedger,
  halves: LabHalf[],
  referees: RefereeStore,
  at: string,
  sourceHash: string,
  refereeSourceHash: string,
): ResearchModel {
  const rows = researchTrainingRows(record, ledger, halves, at);
  const residuals = rows.map((r) => r.actual - r.total);
  const mean = average(residuals);
  const sigma = Math.max(
    1,
    Math.sqrt(average(residuals.map((v) => (v - mean) ** 2))),
  );
  const fit = fitMarketCoefficients(
    rows.map((r) => ({
      features: [(r.total - r.line) / sigma, r.shot],
      market: r.market,
      over: r.actual > r.line,
    })),
  );
  const measurements = new Map(
    referees.measurements
      .filter((r) => isoBefore(r.observedAt, at))
      .map((r) => [r.gameId, r]),
  );
  const refResiduals = new Map(
    rows
      .filter((r) => {
        const half = measurements.get(r.gameId);
        return (
          half?.bothD1 &&
          half.startsAt === r.startsAt &&
          half.awayEspnId === r.awayId &&
          half.homeEspnId === r.homeId &&
          half.metrics.points === r.actual
        );
      })
      .map((r) => [r.gameId, r.actual - r.line]),
  );
  return researchModelSchema.parse({
    schemaVersion: 1,
    method: "market-core-v3+referee-core-v4",
    date: easternTipoff(at).date,
    fittedAt: at,
    trainingGames: rows.length,
    trainingIds: rows.map((r) => r.id),
    latestOutcomeAt:
      rows
        .map((r) => r.observedAt)
        .sort()
        .at(-1) ?? null,
    sigma,
    ...fit,
    sourceHash,
    refereeSourceHash,
    refereeProfiles: summarizeReferees(referees, at, refResiduals),
    refereeTrainingGames: refResiduals.size,
    rules: {
      minimumTrainingGames: 80,
      ridge: 20,
      expectedReturn: 0.05,
      refPseudoGames: 20,
      refMinimumGames: 3,
      refMinimumPricedHalves: 20,
      refPointCap: 2,
    },
  });
}

export function captureResearchForecast(
  method: "market-core-v3" | "referee-core-v4",
  row: PredictionRow,
  game: SeasonGame,
  feed: PredictionFeed,
  model: ResearchModel | undefined,
  modelPath: string | undefined,
  halves: LabHalf[],
  referees: RefereeStore | undefined,
  at: string,
): LabForecast {
  const quote = game.quotes.find((q) => q.sportsbook === "draftkings");
  const line =
    marketStatus(row, "draftkings") === "available"
      ? (quote?.latest?.total ?? null)
      : null;
  const features = game.featureSnapshot;
  const baseline =
    row.featureKind === "captured_pregame" &&
    features &&
    isoBefore(features.capturedAt, at) &&
    row.featureCapturedAt === features.capturedAt &&
    (!features.statsRetrievedAt || isoBefore(features.statsRetrievedAt, at))
      ? row.projectedFirstHalfTotal
      : null;
  let reason = "No valid pregame model inputs.";
  let status: LabForecast["status"] = "data_gap";
  let probability: number | null = null,
    marketProbability: number | null = null,
    expectedReturn: number | null = null;
  let refereePoints: number | null = null,
    baselineProbability: number | null = null;
  let assignment: ReturnType<typeof pregameCrew> = null;
  const crew: z.infer<typeof researchForecastSchema>["crew"] = [];
  const side =
    baseline !== null && line !== null
      ? baseline > line
        ? "OVER"
        : baseline < line
          ? "UNDER"
          : "PUSH"
      : null;
  const checkAt = row.marketCoverage?.checkedAt ?? feed.marketCapturedAt;
  const quoteValid =
    quote &&
    isoBefore(quote.latestCapturedAt, at) &&
    isoBefore(checkAt, at) &&
    Date.parse(at) - Date.parse(checkAt) <= 45 * 60_000 &&
    Date.parse(at) - Date.parse(quote.latestCapturedAt) <= 45 * 60_000;
  if (baseline !== null) {
    if (line === null || !quoteValid)
      reason = "A fresh verified DraftKings quote is unavailable.";
    else if (
      !model ||
      model.trainingGames < 80 ||
      !modelPath ||
      !isoBefore(model.fittedAt, at) ||
      model.date !== easternTipoff(at).date
    )
      reason =
        "At least 80 earlier eligible games and today's frozen model are required.";
    else {
      const shot = features
        ? shotOpportunity(
            game.id,
            game.away.espnId,
            game.home.espnId,
            (features.away.pace + features.home.pace) / 4,
            halves,
            at,
          )
        : null;
      marketProbability = fairOverProbability(
        quote?.latest?.overPrice ?? null,
        quote?.latest?.underPrice ?? null,
      );
      if (shot === null)
        reason =
          "Reconciled pregame first-half history is required for both teams.";
      else if (marketProbability === null)
        reason =
          "Both DraftKings side prices must be valid to estimate the market benchmark.";
      else if (side === null || side === "PUSH") {
        status = "watch_only";
        reason = "The unchanged Actual projection has no over/under lean.";
      } else {
        const input = [(baseline - line) / model.sigma, shot];
        let score =
          logit(marketProbability) +
          input.reduce(
            (n, v, i) => n + (v / model.scales[i]) * model.coefficients[i],
            0,
          );
        const initial = sigmoid(score);
        baselineProbability = side === "OVER" ? initial : 1 - initial;
        let refereeReady = method !== "referee-core-v4";
        if (method === "referee-core-v4") {
          assignment = referees ? pregameCrew(referees, game, at) : null;
          if (assignment) {
            for (const official of assignment.officials) {
              const profile = model.refereeProfiles.find(
                (p) => p.id === official.id,
              );
              crew.push({
                ...official,
                pricedGames: profile?.pricedGames ?? 0,
                pointsAssociation: profile?.pointsAssociation ?? 0,
              });
            }
            refereeReady =
              model.refereeTrainingGames >= 20 &&
              crew.every((p) => p.pricedGames >= 3);
            if (refereeReady) {
              refereePoints = clamp(
                average(crew.map((p) => p.pointsAssociation)),
                -2,
                2,
              );
              score += (1.6 * refereePoints) / model.sigma;
            } else
              reason =
                "Verified crew found; each official needs 3 earlier priced halves and the study needs 20 matched games.";
          } else
            reason =
              "The referee crew has not been verified before tipoff in the latest successful source check.";
        }
        if (refereeReady) {
          const over = sigmoid(score);
          probability = side === "OVER" ? over : 1 - over;
          expectedReturn = returnPerUnit(
            probability,
            side === "OVER"
              ? (quote?.latest?.overPrice ?? null)
              : (quote?.latest?.underPrice ?? null),
          );
          status = "watch_only";
          const age =
            (Date.parse(row.startsAt) - Date.parse(quote.latestCapturedAt)) /
            60_000;
          if (Number.isInteger(line))
            reason =
              "Integer total: push-probability support is not yet validated; watch only.";
          else if (!(age > 0 && age <= 15))
            reason =
              "Awaiting a verified quote in the final 15 minutes before tipoff.";
          else if (expectedReturn === null || expectedReturn < 0.05)
            reason =
              "Estimated return on Actual's side is below the fixed 5% research threshold.";
          else {
            status = "qualified";
            reason =
              "Actual direction retained; estimated return ≥5% at a verified final-window quote. Flat 1u paper research.";
          }
        }
      }
    }
  }
  const research = researchForecastSchema.parse({
    modelPath: modelPath ?? null,
    fittedAt: model?.fittedAt ?? null,
    trainingGames: model?.trainingGames ?? 0,
    probability,
    marketProbability,
    expectedReturn,
    paperUnits: status === "qualified" ? 1 : 0,
    crewAssignmentId: assignment?.id ?? null,
    crewObservedAt: assignment?.observedAt ?? null,
    crew,
    refereePointsEquivalent: refereePoints,
    refereeBaselineProbability: baselineProbability,
  });
  return {
    id: "pending",
    season: feed.season,
    methodId: method,
    gameId: row.gameId,
    gameDate: easternTipoff(row.startsAt).date,
    startsAt: row.startsAt,
    recordedAt: at,
    version: 1,
    revision: feed.source.revision,
    awayTeam: row.awayTeam,
    homeTeam: row.homeTeam,
    participants: { away: game.away, home: game.home },
    sportsbook: "draftkings",
    line: quoteValid ? line : null,
    overPrice: quoteValid ? (quote?.latest?.overPrice ?? null) : null,
    underPrice: quoteValid ? (quote?.latest?.underPrice ?? null) : null,
    total: baseline,
    baselineTotal: baseline,
    simpleTotal: row.simpleTotal,
    paceTotal: row.paceAdjustedTotal,
    side: quoteValid ? side : null,
    signalStrength:
      probability !== null ? Math.round(probability * 1000) / 10 : null,
    status,
    reason,
    bonusMinutes: null,
    bonusBaselineMinutes: null,
    inputs: {
      quoteCapturedAt: quote?.latestCapturedAt ?? null,
      entryQuoteCapturedAt: quote?.latestCapturedAt ?? null,
      modelPolicy: "market-offset-ridge20-v1",
      paperPolicy: "lab-flat-paper-v1",
      sourceBoard: quote?.source ?? null,
      minimumExpectedReturn: 0.05,
      refereeAttribution:
        "Crew and games-worked associations; individual caller unavailable.",
    },
    research,
  };
}
