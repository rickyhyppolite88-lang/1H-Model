"""Choose a cheap skip, a market refresh, or a full refresh from actual tipoff times."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
from zoneinfo import ZoneInfo

FULL_SCHEDULE = "20 6,12,18 * * *"
LEGACY_FULL_SCHEDULE = "20 11,17,23 * * *"
POLL_SCHEDULE = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"
LEGACY_POLL_SCHEDULE = "7,17,27,37,47,57 * * * *"
EASTERN = ZoneInfo("America/New_York")
PRETIP_MINUTES = 75
MIN_REFRESH_MINUTES = 15
DISCOVERY_HOURS = 2
UPCOMING_DISCOVERY_MINUTES = 30
RESULT_WINDOW_HOURS = 4


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Refresh and tipoff timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def plan_refresh(ledger: dict, now: datetime, event: str, schedule: str = "", *, refresh_data: bool = False, refresh_lines: bool = False) -> dict:
    if now.tzinfo is None:
        raise ValueError("The planning clock must include a timezone")
    now = now.astimezone(timezone.utc)
    today = now.astimezone(EASTERN).date()

    def decision(mode: str, reason: str, near: int = 0, active: int = 0, minimum: int = MIN_REFRESH_MINUTES) -> dict:
        return {"mode": mode, "reason": reason, "date": today.isoformat(), "plannedAt": now.isoformat().replace("+00:00", "Z"),
                "nearTipGames": near, "activeHalves": active, "targetMinutesBeforeTipoff": 60, "preTipWindowMinutes": PRETIP_MINUTES,
                "minimumRefreshMinutes": minimum}

    if event not in {"schedule", "workflow_dispatch"}:
        return decision("build", "Validate and publish code without refreshing public sources.")
    if event == "workflow_dispatch" and not (refresh_data or refresh_lines):
        return decision("build", "Manual build without a public-data refresh.")
    season = ledger.get("season", "")
    if not re.fullmatch(r"\d{4}-\d{2}", season) or season != f"{int(season[:4])}-{str(int(season[:4]) + 1)[-2:]}":
        raise ValueError("The configured season must span consecutive years")
    year = int(season[:4])
    if not date(year, 11, 1) <= today <= date(year + 1, 4, 30):
        return decision("skip", "Outside the configured basketball season; season rollover is required.")
    if event == "workflow_dispatch":
        return decision("full" if refresh_data else "markets", "Manual public-data refresh.")
    if schedule in {FULL_SCHEDULE, LEGACY_FULL_SCHEDULE}:
        return decision("full", "Scheduled team-stat, schedule, line, and result refresh.")
    if schedule not in {POLL_SCHEDULE, LEGACY_POLL_SCHEDULE}:
        raise ValueError("Unrecognized refresh schedule")
    captured = instant(ledger["capturedAt"])
    if captured > now + timedelta(minutes=2):
        raise ValueError("The last market capture is in the future")
    age = max(timedelta(), now - captured)
    through = date.fromisoformat(ledger["through"])
    if through > today:
        raise ValueError("The market ledger is dated after the planning day")
    closing = sum(
        not game["firstHalfComplete"]
        and not re.search(r"cancel|postpon|in progress|halftime|final|suspended|overtime", game["status"], re.IGNORECASE)
        and timedelta() < instant(game["startsAt"]) - now <= timedelta(minutes=15)
        for game in ledger["games"]
    )
    if closing and age >= timedelta(minutes=5):
        return decision("markets", "Final pre-tip line check in the last 15 minutes.", closing, minimum=5)
    if age < timedelta(minutes=MIN_REFRESH_MINUTES):
        return decision("skip", "A successful market refresh is less than 15 minutes old.")
    if through < today:
        return decision("full", "Discover the new Eastern game date with fresh team stats and markets.")
    near = active = 0
    upcoming_today = False
    for game in ledger["games"]:
        if re.search(r"cancel|postpon", game["status"], re.IGNORECASE) or game["firstHalfComplete"]:
            continue
        until_tip = instant(game["startsAt"]) - now
        if until_tip > timedelta() and instant(game["startsAt"]).astimezone(EASTERN).date() == today:
            upcoming_today = True
        reported_started = re.search(r"in progress|halftime|final|suspended|overtime", game["status"], re.IGNORECASE)
        if not reported_started and timedelta() < until_tip <= timedelta(minutes=PRETIP_MINUTES):
            near += 1
        elif -timedelta(hours=RESULT_WINDOW_HOURS) <= until_tip <= (timedelta(hours=RESULT_WINDOW_HOURS) if reported_started else timedelta()):
            active += 1
    if near:
        return decision("markets", "Upcoming games are inside the 75-minute pre-tip window.", near, active)
    if active:
        return decision("markets", "Started games still need completed first-half results.", near, active)
    if upcoming_today and age >= timedelta(minutes=UPCOMING_DISCOVERY_MINUTES):
        return decision("markets", "Discover newly posted sportsbook lines every 30 minutes while today's games are upcoming.")
    if age >= timedelta(hours=DISCOVERY_HOURS):
        return decision("markets", "Discover schedule changes and newly posted markets after two hours.")
    return decision("skip", "No pre-tip or first-half-result check is due.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("public/data/season-games.json"))
    parser.add_argument("--now", help="Explicit aware ISO clock for review/testing; default is the actual UTC time")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = plan_refresh(json.loads(args.ledger.read_text(encoding="utf-8")), instant(args.now) if args.now else datetime.now(timezone.utc),
                          os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch"), os.environ.get("REFRESH_SCHEDULE", ""),
                          refresh_data=os.environ.get("REFRESH_DATA", "false").lower() == "true", refresh_lines=os.environ.get("REFRESH_LINES", "false").lower() == "true")
    print(json.dumps(result, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key in ["mode", "reason", "date"]:
                output.write(f"{key}={result[key]}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(f"### Refresh plan: {result['mode']}\n\n{result['reason']}\n\nPlanned at {result['plannedAt']}; {result['nearTipGames']} games near tipoff, {result['activeHalves']} first halves awaiting results.\n")


if __name__ == "__main__":
    main()
