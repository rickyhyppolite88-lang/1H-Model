"""Archive public NCAA first-half totals and ESPN period results, with quote provenance."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from game_context import event_context

SBR = "https://www.sportsbookreview.com/betting-odds/ncaa-basketball/totals/1st-half/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"
CONFERENCES = "https://site.api.espn.com/apis/site/v2/leagues/dropdown?region=us&lang=en&sport=basketball&league=mens-college-basketball"
EASTERN = ZoneInfo("America/New_York")


def conference_directory(data: dict) -> dict[str, str]:
    leagues = [league for league in data.get("leagues", []) if league.get("id") == "41"]
    if len(leagues) != 1:
        raise ValueError("Conference directory did not identify NCAA men's basketball")
    groups = [group for group in leagues[0].get("groups", []) if group.get("id") == "50"]
    if len(groups) != 1 or not groups[0].get("children"):
        raise ValueError("Missing Division I conference directory")
    return {str(group["id"]): group.get("midsizeName") or group["name"] for group in groups[0]["children"]}


def team_classification(competitor: dict, conferences: dict[str, str]) -> dict:
    conference_id = competitor["team"].get("conferenceId")
    raw_rank = competitor.get("curatedRank", {}).get("current")
    known = type(raw_rank) is int and raw_rank >= 1
    return {"conferenceId": str(conference_id) if conference_id is not None else None,
            "conference": conferences.get(str(conference_id)),
            "rank": raw_rank if known and raw_rank <= 25 else None,
            "rankKnown": known}


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    value = re.sub(r"\bstate\b", "st", value)
    value = re.sub(r"\bsaint\b", "st", value)
    normalized = re.sub(r"[^a-z0-9]", "", value)
    return {"uscupstate": "southcarolinaupstate", "uscupstatespartans": "southcarolinaupstatespartans"}.get(normalized, normalized)


def identifiers(team: dict, espn=False) -> set[str]:
    keys = ("displayName", "shortDisplayName", "location", "abbreviation") if espn else ("name", "fullName", "shortName", "displayName")
    names = {normalize(team[key]) for key in keys if team.get(key)}
    # Verified provider aliases, tied to ESPN IDs rather than a fuzzy name join.
    # Grace (CA) / Grace University has conflicting mascots: deliberately unresolved.
    aliases = {"399": ["Albany", "University at Albany", "University at Albany Great Danes"],
               "247": ["King's College (PA)", "King's College (PA) Monarchs"],
               "131616": ["Central Christian College of the Bible", "Central Christian College of the Bible Saints"],
               "2119": ["Central State (OH)", "Central State (OH) Marauders"]}
    if espn:
        names.update(normalize(name) for name in aliases.get(str(team.get("id")), []))
    return names


def read_url(url: str) -> str:
    request = Request(url, headers={"User-Agent": "1H-Model/0.2 (public first-half odds and results audit)"})
    with urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def parse_odds(html: str, requested_date: str) -> list[dict]:
    match = re.search(r'<script\b(?=[^>]*\bid="__NEXT_DATA__")[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise ValueError("Odds page has no structured public board")
    page = json.loads(match.group(1))
    query = page.get("query", {})
    if query.get("date") != requested_date or query.get("league") != "ncaa-basketball" or query.get("oddsType") != "totals" or query.get("oddsScope") != ["1st-half"]:
        raise ValueError("Odds date, sport or first-half totals scope was not confirmed")
    rows = []
    for table in page["props"]["pageProps"]["oddsTables"]:
        if table["league"] != "NCAAB":
            raise ValueError("Unexpected league on first-half board")
        rows.extend(row for row in table["oddsTableModel"]["gameRows"] if row and row.get("gameView"))
    return rows


def half_complete(event: dict) -> bool:
    status = event["status"]
    name = status["type"]["name"]
    if name in {"STATUS_CANCELED", "STATUS_CANCELLED", "STATUS_POSTPONED", "STATUS_SUSPENDED"}:
        return False
    return status.get("period", 0) >= 2 or name == "STATUS_HALFTIME" or name in {"STATUS_FINAL", "STATUS_FINAL_OVERTIME"}


def first_half(competitor: dict, is_complete: bool) -> int | None:
    if not is_complete:
        return None
    halves = [row["value"] for row in competitor.get("linescores", []) if row.get("period") == 1]
    if len(halves) != 1 or not isinstance(halves[0], (float, int)) or not 0 <= halves[0] <= 150 or not float(halves[0]).is_integer():
        return None
    return int(halves[0])


def model_id(team: dict, teams: list[dict]) -> str | None:
    # Verified ESPN team IDs for provider display-name differences; never fuzzy-match teams.
    aliases = {"2511": "queens-university-of-charlotte-royals", "2393": "middle-tennessee-st-blue-raiders",
               "82": "illinois-chicago-flames", "399": "albany-great-danes", "2546": "se-missouri-st-redhawks",
               "145": "mississippi-rebels", "2547": "seattle-redhawks"}
    if str(team["id"]) in aliases:
        target = aliases[str(team["id"])]
        return target if any(row["id"] == target for row in teams) else None
    wanted = identifiers(team, espn=True)
    matches = [row["id"] for row in teams if wanted & {normalize(row["name"]), normalize(row["id"].replace("-", " "))}]
    return matches[0] if len(matches) == 1 else None


def match_event(row: dict, events: list[dict]) -> dict | None:
    game = row["gameView"]
    start = datetime.fromisoformat(game["startDate"])
    candidates = []
    for event in events:
        event_start = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
        if abs((start - event_start).total_seconds()) > 6 * 3600:
            continue
        teams = event["competitions"][0]["competitors"]
        if len(teams) != 2:
            continue
        a, b = (identifiers(team["team"], espn=True) for team in teams)
        home, away = identifiers(game["homeTeam"]), identifiers(game["awayTeam"])
        if (a & home and b & away) or (a & away and b & home):
            candidates.append(event)
    if len(candidates) > 1:
        raise ValueError(f"Ambiguous cross-provider game join for {game['gameId']}")
    return candidates[0] if candidates else None


def quote(line: dict | None) -> dict | None:
    if not line or line.get("total") is None:
        return None
    total = line["total"]
    if not isinstance(total, (int, float)) or not 1 <= total <= 150:
        raise ValueError("Invalid first-half total")
    return {"total": total, "overPrice": line.get("overOdds"), "underPrice": line.get("underOdds")}


def import_games(season: str, start: date, through: date, output: Path) -> dict:
    if not re.fullmatch(r"\d{4}-\d{2}", season) or season != f"{int(season[:4])}-{str(int(season[:4]) + 1)[-2:]}":
        raise ValueError("Season must span consecutive years")
    season_start = date(int(season[:4]), 11, 1)
    if not season_start <= start <= through <= date.today() or through > date(int(season[:4]) + 1, 6, 30):
        raise ValueError("Requested dates are outside this season or in the future")
    existing = json.loads(output.read_text(encoding="utf-8")) if output.exists() else None
    if existing and (existing["season"] != season or existing["through"] > through.isoformat()):
        raise ValueError("Cannot merge another season or future observations into this ledger")
    prior = json.loads(Path("public/data/prior-season.json").read_text(encoding="utf-8"))
    conferences = conference_directory(json.loads(read_url(CONFERENCES)))
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    events_by_id = {}
    boards = []
    checks = {}
    day = start
    while day <= through:
        date_string = day.isoformat()
        score_url = f"{ESPN}?dates={day:%Y%m%d}&groups=50&limit=1000"
        score_data = json.loads(read_url(score_url))
        events = score_data.get("events")
        if not isinstance(events, list):
            raise ValueError("ESPN response has no events list")
        for event in events:
            events_by_id[event["id"]] = (event, score_url)
        odds_url = f"{SBR}?date={date_string}"
        rows = parse_odds(read_url(odds_url), date_string)
        checks[date_string] = {"date": date_string, "checkedAt": now, "source": odds_url,
                              "boardGames": len({str(row["gameView"]["gameId"]) for row in rows}),
                              "matchedGames": set(), "books": {}}
        for row in rows:
            for view in row.get("oddsViews") or []:
                if view and quote(view.get("currentLine")) is not None:
                    check = checks[date_string]["books"].setdefault(view["sportsbook"], {"source": set(), "imported": set()})
                    check["source"].add(str(row["gameView"]["gameId"]))
        boards.extend((row, odds_url) for row in rows)
        print(f"{date_string}: {len(events)} score events, {len(rows)} odds-board games")
        day += timedelta(days=1)
        time.sleep(0.3)
    games = {row["id"]: row for row in existing["games"]} if existing else {}
    for event_id, (event, score_url) in events_by_id.items():
        competitors = event["competitions"][0]["competitors"]
        if len(competitors) != 2:
            continue
        complete = half_complete(event)
        teams = {}
        for competitor in competitors:
            team = competitor["team"]
            teams[competitor["homeAway"]] = {"espnId": str(team["id"]), "modelId": model_id(team, prior["teams"]), "name": team["displayName"], "firstHalfPoints": first_half(competitor, complete), **team_classification(competitor, conferences)}
        if set(teams) != {"home", "away"}:
            raise ValueError("Game does not identify exactly one home and away team")
        previous = games.get(event_id, {})
        starts_at = datetime.fromisoformat(event["date"].replace("Z", "+00:00")).isoformat(timespec="seconds").replace("+00:00", "Z")
        games[event_id] = {"id": event_id, "startsAt": starts_at, "status": event["status"]["type"]["description"], "firstHalfComplete": complete and all(t["firstHalfPoints"] is not None for t in teams.values()), **teams,
            "context": event_context(event), "contextRetrievedAt": now,
            "quotes": previous.get("quotes", []), "oddsGameId": previous.get("oddsGameId"), "featureSnapshot": previous.get("featureSnapshot"), "scoresSource": score_url,
            **({"marketCoverage": previous["marketCoverage"]} if previous.get("marketCoverage") else {}),
            "boxScoreUrl": f"https://www.espn.com/mens-college-basketball/boxscore/_/gameId/{event_id}", "capturedAt": now}
    # A successful source check must not make an old retained quote look current.
    for game in games.values():
        game_date = datetime.fromisoformat(game["startsAt"].replace("Z", "+00:00")).astimezone(EASTERN).date().isoformat()
        if game_date in checks:
            game["marketCoverage"] = {"checkedAt": now, "source": checks[game_date]["source"],
                                      "status": "not_matched", "books": []}
    refreshed_sources = {check["source"] for check in checks.values()}
    unmatched = [row for row in (existing or {}).get("unmatchedOdds", []) if row["source"] not in refreshed_sources]
    archived_ids = {game["oddsGameId"]: game["id"] for game in games.values() if game.get("oddsGameId")}
    for row, source in boards:
        odds_id = str(row["gameView"]["gameId"])
        event_id = archived_ids.get(odds_id)
        if not event_id:
            event = match_event(row, [pair[0] for pair in events_by_id.values()])
            event_id = event["id"] if event else None
        if event_id is None:
            game = row["gameView"]
            unmatched.append({"oddsGameId": str(game["gameId"]), "away": game["awayTeam"].get("name") or game["awayTeam"].get("displayName", ""),
                              "home": game["homeTeam"].get("name") or game["homeTeam"].get("displayName", ""), "source": source,
                              "startsAt": game["startDate"], "reason": "No unique verified team-and-time match in the schedule.",
                              "booksWithLines": sorted({view["sportsbook"] for view in row.get("oddsViews") or [] if view and quote(view.get("currentLine")) is not None})})
            continue
        game = games[event_id]
        check = next(check for check in checks.values() if check["source"] == source)
        check["matchedGames"].add(odds_id)
        views = {view["sportsbook"]: view for view in row.get("oddsViews") or [] if view}
        game["marketCoverage"] = {"checkedAt": now, "source": source, "status": "matched",
                                  "books": [{"sportsbook": book, "status": "available" if quote(view.get("currentLine")) is not None else "no_current_line"}
                                            for book, view in sorted(views.items())]}
        game["oddsGameId"] = odds_id
        archived_ids[odds_id] = event_id
        by_book = {q["sportsbook"]: q for q in game["quotes"]}
        for view in row.get("oddsViews") or []:
            if not view:
                continue
            opening, latest = quote(view.get("openingLine")), quote(view.get("currentLine"))
            if opening is None and latest is None:
                continue
            book = view["sportsbook"]
            old = by_book.get(book)
            by_book[book] = {"sportsbook": book, "opening": old["opening"] if old and old.get("opening") else opening,
                "latest": latest if latest is not None else old.get("latest") if old else None,
                "openingCapturedAt": old["openingCapturedAt"] if old and old.get("opening") else now,
                "latestCapturedAt": now if latest is not None or not old else old["latestCapturedAt"],
                "closingVerified": False, "quoteTimestamp": None, "source": source}
            if latest is not None:
                check["books"][book]["imported"].add(odds_id)
        game["quotes"] = sorted(by_book.values(), key=lambda q: q["sportsbook"])
    ordered = sorted(games.values(), key=lambda game: (game["startsAt"], game["id"]))
    # Only a complete archive from season start can establish that a team is debuting.
    complete_history = start == season_start or bool(existing and existing.get("seasonStart") == season_start.isoformat() and start <= date.fromisoformat(existing["through"]) + timedelta(days=1))
    for game in ordered:
        previous_ids = {t["espnId"] for other in ordered if other["startsAt"] < game["startsAt"] for t in [other["home"], other["away"]]}
        game["seasonDebut"] = complete_history and all(game[side]["espnId"] not in previous_ids for side in ["home", "away"])
    market_checks = {check["date"]: check for check in (existing or {}).get("marketChecks", [])}
    for day, check in checks.items():
        market_checks[day] = {"date": day, "checkedAt": now, "source": check["source"], "boardGames": check["boardGames"],
                              "matchedGames": len(check["matchedGames"]), "unmatchedGames": check["boardGames"] - len(check["matchedGames"]),
                              "books": [{"sportsbook": book, "sourceLines": len(counts["source"]), "importedLines": len(counts["imported"]),
                                         "unmatchedLines": len(counts["source"] - counts["imported"])} for book, counts in sorted(check["books"].items())]}
    return {"schemaVersion": 1, "season": season, "seasonStart": season_start.isoformat() if complete_history else None,
        "through": through.isoformat(), "capturedAt": now, "market": "first_half_total", "games": ordered,
        "marketChecks": sorted(market_checks.values(), key=lambda check: check["date"]),
        "unmatchedOdds": unmatched, "notes": ["Openers and latest displayed quotes are distinct. No retrieved latest quote is a verified closing line.", "ESPN first-half results are graded only after that period ends, including games still in their second half."]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default="2026-27")
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--through", type=date.fromisoformat, default=date.today())
    parser.add_argument("--output", type=Path, default=Path("public/data/season-games.json"))
    args = parser.parse_args()
    season_start = date(int(args.season[:4]), 11, 1)
    previous = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else None
    start = args.start or (max(season_start, min(date.fromisoformat(previous["through"]), args.through - timedelta(days=1))) if previous else season_start)
    data = import_games(args.season, start, args.through, args.output)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    halves = [g for g in data["games"] if g["firstHalfComplete"]]
    print(f"Saved {len(data['games'])} games; {len(halves)} completed first halves; {sum(bool(g['quotes']) for g in halves)} with quotes; {len(data['unmatchedOdds'])} unmatched odds games")


if __name__ == "__main__":
    main()
