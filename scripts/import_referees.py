"""Append verified public crews and reconciled first-half officiating proxies.

ESPN does not attribute individual calls to officials. Individual statistics
describe games worked; bonus thresholds and FT sequences are labeled proxies.
Historical crews first collected after tip are never pregame assignments.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
from urllib.request import Request, urlopen

from import_lab_halves import parse_half, remaining


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def crew(data):
    result = []
    for official in data.get("gameInfo", {}).get("officials") or []:
        name = (official.get("fullName") or official.get("displayName") or "").strip()
        if not name:
            continue
        key = " ".join(re.sub(r"[^\w\s]", "", unicodedata.normalize("NFKC", name).casefold()).split())
        result.append({"id": "name:" + key, "name": name})
    result.sort(key=lambda item: item["id"])
    if len({item["id"] for item in result}) != len(result):
        raise ValueError("Duplicate official identity in source crew")
    if len(result) != 3:
        raise ValueError("A verified three-official crew is unavailable")
    return result


def observation(data, game, season, observed_at, source_hash):
    competitors = data["header"]["competitions"][0]["competitors"]
    if {str(c["team"]["id"]) for c in competitors} != {game["away"]["espnId"], game["home"]["espnId"]}:
        raise ValueError("Referee source participant IDs disagree with schedule")
    start = data["header"]["competitions"][0].get("date") or data["header"].get("competitions", [{}])[0].get("startDate")
    if start and instant(start) != instant(game["startsAt"]):
        raise ValueError("Referee source start time disagrees with schedule")
    officials = crew(data)
    source = f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={game['id']}"
    normalized = {"gameId": game["id"], "season": season, "startsAt": game["startsAt"],
                  "awayEspnId": game["away"]["espnId"], "homeEspnId": game["home"]["espnId"], "officials": officials}
    assignment = {**normalized, "id": "crew:" + digest(normalized), "observedAt": observed_at,
                  "source": source, "sourceSha256": source_hash}
    if not game["firstHalfComplete"]:
        return assignment, None
    half = parse_half(data, game, season, observed_at, source_hash)
    rows = {team["espnId"]: team for team in half["teams"]}
    plays = list({play["id"]: play for play in data.get("plays", []) if play.get("period", {}).get("number") == 1}.values())
    plays = sorted(enumerate(plays), key=lambda value: (-remaining(value[1]), value[0]))
    counts = {"foulsFirst10": 0, "foulsLast10": 0, "technicalTagged": 0,
              "shootingFoulsTagged": 0, "offensiveFoulsTagged": 0, "reviewEventsLogged": 0,
              "timeoutEventsLogged": 0, "ftSequenceProxy": 0}
    fouls = {team: 0 for team in rows}
    seventh, tenth, players = {}, {}, {}
    identified = total_fouls = 0
    sequences = set()
    first_foul = first_ft = None
    for _, play in plays:
        kind = play.get("type", {}).get("text", "").lower()
        text = play.get("text", "").lower()
        team = str(play.get("team", {}).get("id", ""))
        left = remaining(play)
        if "foul" in kind:
            first_foul = max(first_foul if first_foul is not None else left, left)
            counts["foulsFirst10" if left >= 600 else "foulsLast10"] += 1
            counts["technicalTagged"] += int("technical" in kind or "technical" in text)
            counts["shootingFoulsTagged"] += int("shooting foul" in text or "shootingfoul" in kind)
            counts["offensiveFoulsTagged"] += int("offensive foul" in text or "offensivefoul" in kind or "charge" in kind)
            if team in fouls and "technical" not in kind and "technical" not in text:
                fouls[team] += 1
                if fouls[team] == 7:
                    seventh[team] = left / 60
                if fouls[team] == 10:
                    tenth[team] = left / 60
                total_fouls += 1
                athletes = play.get("athletesInvolved") or []
                athlete = athletes[0].get("id") if athletes else None
                if athlete:
                    identified += 1
                    key = team + ":" + str(athlete)
                    player = players.setdefault(key, {"count": 0, "earlyTwo": False})
                    player["count"] += 1
                    if player["count"] == 2 and left >= 600:
                        player["earlyTwo"] = True
        attempted = play.get("pointsAttempted", 0)
        if attempted == 1 or "free throw" in text:
            first_ft = max(first_ft if first_ft is not None else left, left)
            sequences.add((team, left))
        counts["reviewEventsLogged"] += int("review" in kind or "instant replay" in kind)
        counts["timeoutEventsLogged"] += int("timeout" in kind)
    counts["ftSequenceProxy"] = len(sequences)
    combined = {key: sum(team[key] for team in half["teams"]) for key in
                ["points", "fga", "fta", "freeThrowsMade", "turnovers", "offensiveRebounds", "threeAttempted"]}
    possessions = (combined["fga"] - combined["offensiveRebounds"] + combined["turnovers"] + .475 * combined["fta"]) / 2
    if not 15 <= possessions <= 60:
        raise ValueError("Implausible reconciled first-half possessions")
    metrics = {**counts, "points": combined["points"], "fouls": sum(fouls.values()),
               "fta": combined["fta"], "ftMade": combined["freeThrowsMade"], "fga": combined["fga"],
               "turnovers": combined["turnovers"], "offensiveRebounds": combined["offensiveRebounds"],
               "threeAttempted": combined["threeAttempted"], "halfPossessions": possessions,
               "bonus7MinutesProxy": sum(seventh.values()), "bonus10MinutesProxy": sum(tenth.values()),
               "firstFoulElapsedMinutes": (1200 - first_foul) / 60 if first_foul is not None else None,
               "firstFTElapsedMinutes": (1200 - first_ft) / 60 if first_ft is not None else None,
               "homeAwayFoulDifference": fouls[game["home"]["espnId"]] - fouls[game["away"]["espnId"]],
               "homeAwayFTADifference": rows[game["home"]["espnId"]]["fta"] - rows[game["away"]["espnId"]]["fta"],
               "foulPlayerIdentityCoverage": identified / total_fouls if total_fouls else None,
               "earlyTwoFoulPlayers": sum(p["earlyTwo"] for p in players.values()) if identified == total_fouls and total_fouls else None}
    normalized_measurement = {**normalized, "bothD1": half["bothD1"], "metrics": metrics}
    measurement = {**normalized_measurement, "id": "ref-half:" + digest(normalized_measurement),
                   "observedAt": observed_at, "assignmentId": assignment["id"], "source": source,
                   "sourceSha256": source_hash}
    return assignment, measurement


def collect(ledger, output, cache_dir, workers=6):
    now = datetime.now(timezone.utc)
    old = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"assignments": [], "measurements": [], "checks": [], "errors": []}
    assignments = {row["id"]: row for row in old["assignments"]}
    measurements = {row["id"]: row for row in old["measurements"]}
    checks = {row["gameId"]: row for row in old["checks"]}
    errors = {row["gameId"]: row for row in old["errors"]}
    for check in checks.values():
        if "assignmentId" not in check:
            matching = [a for a in assignments.values() if a["gameId"] == check["gameId"] and a["observedAt"] == check["checkedAt"]]
            check["assignmentId"] = matching[0]["id"] if len(matching) == 1 else None
    latest = {}
    for row in sorted(measurements.values(), key=lambda item: item["observedAt"]):
        latest[row["gameId"]] = row
    due = []
    for game in ledger["games"]:
        until = instant(game["startsAt"]) - now
        check = checks.get(game["id"])
        last = instant(check["checkedAt"]) if check else None
        if game["firstHalfComplete"]:
            previous = latest.get(game["id"])
            total = game["away"]["firstHalfPoints"] + game["home"]["firstHalfPoints"]
            changed = not previous or previous["startsAt"] != game["startsAt"] or previous["metrics"]["points"] != total
            recent = instant(game["startsAt"]) >= now - timedelta(days=2)
            if changed or (recent and (not last or now - last >= timedelta(hours=6))):
                if not last or now - last >= timedelta(minutes=15):
                    due.append(game)
        elif -timedelta(hours=4) <= until <= timedelta(hours=18) and not re.search(r"cancel|postpon", game["status"], re.I):
            cadence = timedelta(minutes=5) if until <= timedelta(minutes=90) else timedelta(hours=1)
            if not last or now - last >= cadence:
                due.append(game)
    cache_dir.mkdir(exist_ok=True, parents=True)
    def fetch(game):
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={game['id']}"
        for attempt in range(2):
            try:
                with urlopen(Request(url, headers={"User-Agent": "1H-Model-Lab/1.0 (public officiating research)"}), timeout=25) as response:
                    raw = response.read()
                break
            except Exception:
                if attempt:
                    raise
                time.sleep(.5)
        at = stamp()
        sha = hashlib.sha256(raw).hexdigest()
        (cache_dir / (game["id"] + ".json.gz")).write_bytes(gzip.compress(raw))
        (cache_dir / (game["id"] + ".receipt.json")).write_text(json.dumps({"source": url, "observedAt": at, "sha256": sha}), encoding="utf-8")
        return at, observation(json.loads(raw), game, ledger["season"], at, sha)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, game): game for game in due}
        for future in as_completed(futures):
            game = futures[future]
            try:
                at, (assignment, measurement) = future.result()
                assignments.setdefault(assignment["id"], assignment)
                if measurement:
                    measurements.setdefault(measurement["id"], measurement)
                checks[game["id"]] = {"gameId": game["id"], "checkedAt": at, "assignmentId": assignment["id"]}
                errors.pop(game["id"], None)
            except Exception as error:
                at = stamp()
                checks[game["id"]] = {"gameId": game["id"], "checkedAt": at, "assignmentId": None}
                errors[game["id"]] = {"gameId": game["id"], "observedAt": at, "reason": str(error)}
    result = {"schemaVersion": 1, "updatedAt": stamp(), "assignments": sorted(assignments.values(), key=lambda r: (r["observedAt"], r["id"])),
              "measurements": sorted(measurements.values(), key=lambda r: (r["observedAt"], r["id"])),
              "checks": sorted(checks.values(), key=lambda r: r["gameId"]), "errors": sorted(errors.values(), key=lambda r: r["gameId"])}
    output.parent.mkdir(exist_ok=True, parents=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Referee research: {len(due)} checked, {len(assignments)} crew observations, {len(measurements)} reconciled first halves, {len(errors)} explicit source gaps")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("public/data/season-games.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/referees.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/referee-summaries"))
    args = parser.parse_args()
    collect(json.loads(args.ledger.read_text(encoding="utf-8")), args.output, args.cache_dir)
