import {
  type CompleteMetrics,
  completeMetrics,
  metricKeys,
  type SeasonDataset,
} from "./schema";

export interface BlendSettings {
  priorEquivalentGames: number;
  leagueRegression: number;
}

export const defaultBlend: BlendSettings = {
  priorEquivalentGames: 8,
  leagueRegression: 0.35,
};

export interface BlendedTeam extends CompleteMetrics {
  id: string;
  name: string;
  currentWeight: number;
  currentGames: number;
  priorAvailable: boolean;
  strengthOfSchedule: number | null;
  notes: string[];
}

export function assertSnapshots(
  prior: SeasonDataset,
  current: SeasonDataset,
  predictionDate: string,
) {
  if (
    Number(current.season.slice(0, 4)) !==
    Number(prior.season.slice(0, 4)) + 1
  ) {
    throw new Error("The snapshots must cover consecutive seasons.");
  }
  if (prior.asOf >= current.asOf)
    throw new Error("The prior snapshot must precede the current snapshot.");
  if (current.asOf > predictionDate || prior.asOf > predictionDate) {
    throw new Error(
      "A snapshot is newer than the prediction date. Import an earlier snapshot to avoid future data.",
    );
  }
  const start = Number(current.season.slice(0, 4));
  if (
    predictionDate < `${start}-07-01` ||
    predictionDate > `${start + 1}-06-30`
  ) {
    throw new Error(
      "The prediction date must belong to the current snapshot's season.",
    );
  }
}

export function leagueAverage(prior: SeasonDataset): CompleteMetrics {
  const teams = prior.teams
    .filter((team) => team.gamesPlayed > 0)
    .map(completeMetrics)
    .filter((metrics): metrics is CompleteMetrics => metrics !== null);
  if (teams.length === 0)
    throw new Error("No complete prior-season team statistics are available.");
  return Object.fromEntries(
    metricKeys.map((key) => [
      key,
      teams.reduce((total, team) => total + team[key], 0) / teams.length,
    ]),
  ) as unknown as CompleteMetrics;
}

export function blendTeam(
  id: string,
  prior: SeasonDataset,
  current: SeasonDataset,
  settings: BlendSettings,
  predictionDate: string,
): BlendedTeam {
  assertSnapshots(prior, current, predictionDate);
  if (
    !Number.isFinite(settings.priorEquivalentGames) ||
    settings.priorEquivalentGames <= 0 ||
    !Number.isFinite(settings.leagueRegression) ||
    settings.leagueRegression < 0 ||
    settings.leagueRegression > 1
  ) {
    throw new Error(
      "Prior strength must be positive; league regression must be between 0 and 100%.",
    );
  }
  const old = prior.teams.find((team) => team.id === id);
  const recent = current.teams.find((team) => team.id === id);
  if (!old && !recent)
    throw new Error("Team was not found in either snapshot.");
  const average = leagueAverage(prior);
  const oldMetrics = old && old.gamesPlayed > 0 ? completeMetrics(old) : null;
  const recentMetrics = recent ? completeMetrics(recent) : null;
  const currentGames = recent?.gamesPlayed ?? 0;
  const usableCurrent = currentGames > 0 && recentMetrics !== null;
  const currentWeight = usableCurrent
    ? currentGames / (currentGames + settings.priorEquivalentGames)
    : 0;
  const values = Object.fromEntries(
    metricKeys.map((key) => {
      const regressed = oldMetrics
        ? oldMetrics[key] * (1 - settings.leagueRegression) +
          average[key] * settings.leagueRegression
        : average[key];
      return [
        key,
        regressed * (1 - currentWeight) +
          (usableCurrent ? recentMetrics[key] : 0) * currentWeight,
      ];
    }),
  ) as unknown as CompleteMetrics;
  const notes = [
    "Roster continuity is not measured; league regression reduces reliance on last year's roster.",
  ];
  if (!oldMetrics)
    notes.push(
      "No complete prior-season record; using the prior-season league average.",
    );
  if (!usableCurrent)
    notes.push(
      currentGames > 0
        ? "Current statistics are incomplete; using the regressed prior until all four metrics are available."
        : "No completed current-season games in this snapshot; using the regressed prior.",
    );
  return {
    ...values,
    id,
    name: recent?.name ?? old?.name ?? id,
    currentWeight,
    currentGames,
    priorAvailable: oldMetrics !== null,
    // Last year's schedule is not this year's schedule. Never carry it forward.
    strengthOfSchedule:
      currentGames > 0 ? (recent?.strengthOfSchedule ?? null) : null,
    notes,
  };
}
