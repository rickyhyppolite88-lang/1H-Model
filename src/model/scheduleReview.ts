import { z } from "zod";
import type { GameContext } from "./gameContext";
import { easternTipoff } from "./time";

const teamIdentitySchema = z.object({
  espnId: z.string().min(1),
  modelId: z.string().nullable(),
  name: z.string().min(1),
});
export const participantsSchema = z.object({
  away: teamIdentitySchema,
  home: teamIdentitySchema,
});
export type Participants = z.infer<typeof participantsSchema>;
export const scheduleMessages = {
  unchanged: "Saved and result tip times agree.",
  verified_time_change:
    "Verified same-day tip-time change: the ESPN game and both teams match, and this forecast preceded both tip times. The saved forecast and line are unchanged.",
  review:
    "Schedule review: the changed tip time has not passed the game, team, date and pregame-timing checks. Excluded from graded results.",
};
type SavedSchedule = {
  season: string;
  gameId: string;
  startsAt: string;
  recordedAt: string;
  awayTeam: string;
  homeTeam: string;
  participants?: Participants;
  awayModelId?: string;
  homeModelId?: string;
  awayEspnId?: string;
  homeEspnId?: string;
  context?: GameContext;
};
type ResultSchedule = {
  season: string;
  gameId: string;
  startsAt?: string;
  observedAt: string;
  sourceCapturedAt: string;
  source: string;
  participants?: Participants;
  context?: GameContext;
};

/** Resolve a bounded clock change, never a new opponent, date or post-tip forecast. */
export function reviewSchedule(
  saved: SavedSchedule,
  result: ResultSchedule | undefined,
): keyof typeof scheduleMessages {
  if (
    !result?.startsAt ||
    Date.parse(result.startsAt) === Date.parse(saved.startsAt)
  )
    return "unchanged";
  const oldTip = Date.parse(saved.startsAt);
  const newTip = Date.parse(result.startsAt);
  const captured = Date.parse(saved.recordedAt);
  const teams = result.participants;
  const url = new URL(result.source);
  if (
    saved.gameId !== result.gameId ||
    saved.season !== result.season ||
    url.protocol !== "https:" ||
    url.hostname !== "site.api.espn.com" ||
    !url.pathname.startsWith(
      "/apis/site/v2/sports/basketball/mens-college-basketball/",
    ) ||
    !teams ||
    teams.away.espnId === teams.home.espnId ||
    teams.away.name !== saved.awayTeam ||
    teams.home.name !== saved.homeTeam ||
    captured >= Math.min(oldTip, newTip) ||
    Date.parse(result.sourceCapturedAt) < newTip ||
    Date.parse(result.observedAt) < Date.parse(result.sourceCapturedAt) ||
    Math.abs(newTip - oldTip) > 6 * 60 * 60_000 ||
    easternTipoff(saved.startsAt).date !== easternTipoff(result.startsAt).date
  )
    return "review";
  for (const side of ["away", "home"] as const) {
    const modelId =
      saved.participants?.[side].modelId ?? saved[`${side}ModelId`];
    const espnId = saved.participants?.[side].espnId ?? saved[`${side}EspnId`];
    if (
      (modelId && modelId !== teams[side].modelId) ||
      (espnId && espnId !== teams[side].espnId)
    )
      return "review";
  }
  if (saved.context) {
    const current = result.context;
    if (
      !current ||
      !saved.context.venueKey ||
      saved.context.venueKey !== current.venueKey ||
      saved.context.neutralSite !== current.neutralSite ||
      saved.context.conferenceGame !== current.conferenceGame ||
      saved.context.matchupType !== current.matchupType
    )
      return "review";
  }
  return "verified_time_change";
}
