"""Append public, reconciled first-half results and context for the Actual model.

Past attendance is an outcome measurement. It is never copied into a pregame
feature; the model uses earlier venue averages as an explicitly labelled proxy.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

from game_context import event_context
from import_season_games import ESPN, first_half, half_complete, model_id


def parse_day(data, season, at, source, known_teams, team_ids):
    if not isinstance(data.get("events"), list):
        raise ValueError("Missing provider events list")
    games, errors = [], []
    for event in data["events"]:
        if event.get("season", {}).get("year") != int(season[:4]) + 1:
            raise ValueError("Provider returned another season")
        if not half_complete(event):
            continue
        competitors = event["competitions"][0].get("competitors", [])
        if len(competitors) != 2:
            errors.append({"gameId": event["id"], "reason": "Expected two teams"})
            continue
        teams = {}
        for competitor in competitors:
            team = competitor["team"]
            espn_id = str(team["id"])
            if espn_id not in team_ids:
                team_ids[espn_id] = model_id(team, known_teams)
            teams[competitor["homeAway"]] = {"espnId": espn_id, "modelId": team_ids[espn_id], "name": team["displayName"], "points": first_half(competitor, True)}
        if set(teams) != {"away", "home"} or any(team["points"] is None for team in teams.values()):
            errors.append({"gameId": event["id"], "reason": "Missing reconciled first-half score or home/away identity"})
            continue
        competition = event["competitions"][0]
        attendance = competition.get("attendance")
        normalized = {"gameId": event["id"], "season": season,
                      "startsAt": datetime.fromisoformat(event["date"].replace("Z", "+00:00")).isoformat().replace("+00:00", "Z"),
                      "away": teams["away"], "home": teams["home"], "context": event_context(event),
                      "attendance": attendance if type(attendance) is int and 0 < attendance < 150000 else None}
        content = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()
        games.append({**normalized, "id": event["id"] + "_" + content, "observedAt": at, "source": source})
    return games, errors


def collect(output, through, force=False):
    at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    old = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"games": [], "days": [], "errors": []}
    games = {game["id"]: game for game in old["games"]}
    days = {row["date"]: row for row in old["days"]}
    errors = {row["date"]: row for row in old.get("errors", [])}
    prior = json.loads(Path("public/data/prior-season.json").read_text(encoding="utf-8"))
    start_year = int(prior["season"][:4])
    requested = []
    for season, first, last in [(prior["season"], date(start_year, 11, 1), date.fromisoformat(prior["asOf"])),
                                (f"{start_year+1}-{str(start_year+2)[-2:]}", date(start_year+1, 11, 1), through)]:
        day = first
        while day <= last:
            key = day.isoformat()
            if force or key not in days or key in errors or day >= through - timedelta(days=1):
                requested.append((season, day))
            day += timedelta(days=1)
    cache = Path(".cache/context-scoreboards")
    cache.mkdir(parents=True, exist_ok=True)
    def fetch(item):
        season, day = item
        url = f"{ESPN}?dates={day:%Y%m%d}&groups=50&limit=1000"
        cached = cache / f"{day}.json"
        receipt = cache / f"{day}.receipt.json"
        if cached.exists() and receipt.exists() and day < through - timedelta(days=1) and not force:
            payload = cached.read_bytes()
            provenance = json.loads(receipt.read_text(encoding="utf-8"))
            if provenance["sha256"] != hashlib.sha256(payload).hexdigest() or provenance["url"] != url:
                raise ValueError("Cached source checksum mismatch")
        else:
            for attempt in range(3):
                try:
                    with urlopen(Request(url, headers={"User-Agent": "1H-Model/0.3 (public first-half venue research)"}), timeout=25) as response:
                        payload = response.read()
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(.5 * (attempt + 1))
            provenance = {"url": url, "sha256": hashlib.sha256(payload).hexdigest(), "retrievedAt": at}
            cached.write_bytes(payload)
            receipt.write_text(json.dumps(provenance), encoding="utf-8")
        data = json.loads(payload)
        if len(data.get("events", [])) >= 1000:
            raise ValueError("Source may be truncated at the event limit")
        return season, day, data, provenance
    team_ids = {}
    context_path = output.with_name("game-contexts.json")
    previous_context = json.loads(context_path.read_text(encoding="utf-8")) if context_path.exists() else {"games": []}
    contexts = {row["gameId"]: row for row in previous_context["games"]}
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = {pool.submit(fetch, item): item for item in requested}
        for future in as_completed(pending):
            season, day = pending[future]
            key = day.isoformat()
            try:
                season, day, data, provenance = future.result()
                parsed, gaps = parse_day(data, season, provenance["retrievedAt"], provenance["url"], prior["teams"], team_ids)
                if day >= through - timedelta(days=1):
                    for event in data["events"]:
                        teams = {team["homeAway"]: str(team["team"]["id"]) for team in event["competitions"][0]["competitors"]}
                        if set(teams) == {"away", "home"}:
                            contexts[event["id"]] = {"gameId": event["id"], "startsAt": datetime.fromisoformat(event["date"].replace("Z", "+00:00")).isoformat().replace("+00:00", "Z"),
                                "awayEspnId": teams["away"], "homeEspnId": teams["home"], "contextRetrievedAt": provenance["retrievedAt"], "context": event_context(event), "source": provenance["url"], "sourceSha256": provenance["sha256"]}
                for row in parsed:
                    games.setdefault(row["id"], row)
                days[key] = {"date": key, "season": season, **provenance, "games": len(parsed), "scoreGaps": gaps}
                errors.pop(key, None)
            except Exception as error:
                errors[key] = {"date": key, "reason": str(error)}
    result = {"schemaVersion": 1, "updatedAt": at, "games": sorted(games.values(), key=lambda game: (game["observedAt"], game["id"])),
              "days": sorted(days.values(), key=lambda day: day["date"]), "errors": sorted(errors.values(), key=lambda error: error["date"])}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    encode = lambda row: json.dumps(row, ensure_ascii=False, separators=(",", ":"))
    # One content-addressed observation per line keeps source-history diffs reviewable.
    text = '{"schemaVersion":1,"updatedAt":' + encode(at) + ',"games":[\n' + ",\n".join(map(encode, result["games"])) + '\n],"days":[\n' + ",\n".join(map(encode, result["days"])) + '\n],"errors":' + encode(result["errors"]) + '}\n'
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(output)
    context_temporary = context_path.with_suffix(".tmp")
    context_temporary.write_text(json.dumps({"schemaVersion": 1, "updatedAt": at, "games": sorted(contexts.values(), key=lambda row: row["gameId"])}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    context_temporary.replace(context_path)
    print(json.dumps({"contextVersions": len(games), "sourceDays": len(days), "checkedDays": len(requested), "sourceErrors": len(errors)}))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("public/data/context-history.json"))
    parser.add_argument("--through", type=date.fromisoformat, default=date.today())
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    collect(args.output, args.through, args.force)
