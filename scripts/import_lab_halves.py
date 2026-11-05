"""Append reconciled first-half play-by-play measurements for isolated Lab research."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen


def remaining(play: dict) -> float:
    minutes, seconds = play["clock"]["displayValue"].split(":")
    return int(minutes) * 60 + float(seconds)


def parse_half(data: dict, game: dict, season: str, observed_at: str, payload_hash: str) -> dict:
    competitors = data["header"]["competitions"][0]["competitors"]
    if {str(team["team"]["id"]) for team in competitors} != {game["away"]["espnId"], game["home"]["espnId"]}:
        raise ValueError("Provider team IDs disagree with schedule")
    plays = list({play["id"]: play for play in data.get("plays", []) if play.get("period", {}).get("number") == 1}.values())
    if not plays:
        raise ValueError("No first-half play-by-play")
    stats = {str(team["team"]["id"]): {"espnId": str(team["team"]["id"]), "points": 0, "fouls": 0,
             "bonusMinutes": 0, "fga": 0, "fta": 0, "freeThrowsMade": 0, "threeMade": 0, "threeAttempted": 0,
             "turnovers": 0, "offensiveRebounds": 0} for team in competitors}
    shooting_points = {team: 0 for team in stats}
    seventh = {}
    for play in plays:
        team = str(play.get("team", {}).get("id", ""))
        if team not in stats:
            continue
        row = stats[team]
        kind = play.get("type", {}).get("text", "").lower()
        points = int(play.get("scoreValue", 0)) if play.get("scoringPlay") else 0
        row["points"] += points
        attempted = play.get("pointsAttempted", 0)
        if attempted == 0 and "free throw" in play.get("text", "").lower():
            attempted = 1
        if play.get("shootingPlay") and attempted in [1, 2, 3]:
            row["fta" if attempted == 1 else "fga"] += 1
            if attempted == 1:
                row["freeThrowsMade"] += bool(play.get("scoringPlay"))
            if attempted == 3:
                row["threeAttempted"] += 1
                row["threeMade"] += bool(play.get("scoringPlay"))
            shooting_points[team] += attempted if play.get("scoringPlay") else 0
        if "foul" in kind and "technical" not in kind:
            row["fouls"] += 1
            if row["fouls"] == 7:
                seventh[team] = remaining(play) / 60
        row["turnovers"] += "turnover" in kind
        row["offensiveRebounds"] += kind == "offensive rebound"
    for competitor in competitors:
        team = str(competitor["team"]["id"])
        periods = competitor.get("linescores") or [{}]
        raw_score = periods[0].get("value")
        if raw_score is None:
            raw_score = periods[0].get("displayValue")
        score = float(raw_score) if raw_score is not None else None
        scheduled = next(game[side]["firstHalfPoints"] for side in ["away", "home"] if game[side]["espnId"] == team)
        if score is None or not score.is_integer() or scheduled is None or stats[team]["points"] != score or score != scheduled or shooting_points[team] != score:
            raise ValueError("First-half scoring does not reconcile to provider and ledger")
        opponent = next(other for other in stats if other != team)
        stats[team]["bonusMinutes"] = seventh.get(opponent, 0)
    normalized = {"gameId": game["id"], "season": season, "startsAt": game["startsAt"],
                  "bothD1": bool(game["away"].get("modelId") and game["home"].get("modelId")),
                  "teams": sorted(stats.values(), key=lambda team: team["espnId"])}
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {**normalized, "id": f"{game['id']}_{digest}", "observedAt": observed_at,
            "source": f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={game['id']}",
            "sourceSha256": payload_hash}


def import_halves(ledger: dict, output: Path, cache_dir: Path | None = None) -> dict:
    now = datetime.now(timezone.utc)
    at = now.isoformat().replace("+00:00", "Z")
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"halves": [], "checks": [], "errors": []}
    halves = {half["id"]: half for half in previous["halves"]}
    checks = {check["gameId"]: check for check in previous.get("checks", [])}
    errors = {error["gameId"]: error for error in previous.get("errors", [])}
    latest = {}
    for half in sorted(halves.values(), key=lambda half: half["observedAt"]):
        latest[half["gameId"]] = half
    due = []
    for game in ledger["games"]:
        if not game["firstHalfComplete"]:
            continue
        observed = latest.get(game["id"])
        points = {team["espnId"]: team["points"] for team in observed["teams"]} if observed else {}
        changed = observed is None or observed["startsAt"] != game["startsAt"] or any(points.get(game[side]["espnId"]) != game[side]["firstHalfPoints"] for side in ["away", "home"])
        needs_free_throws = observed is not None and any("freeThrowsMade" not in team for team in observed["teams"])
        checked = checks.get(game["id"], {}).get("checkedAt")
        recent = datetime.fromisoformat(game["startsAt"].replace("Z", "+00:00")) >= now - timedelta(days=2)
        stale = checked is None or now - datetime.fromisoformat(checked.replace("Z", "+00:00")) >= timedelta(hours=6)
        if changed or needs_free_throws or (recent and stale) or game["id"] in errors:
            due.append(game)

    def fetch(game):
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={game['id']}"
        cached = cache_dir / f"{game['id']}.json" if cache_dir else None
        if cached and cached.exists():
            payload = cached.read_bytes()
        else:
            for attempt in range(3):
                try:
                    with urlopen(Request(url, headers={"User-Agent": "1H-Model-Lab/1.0 (public first-half research)"}), timeout=25) as response:
                        payload = response.read()
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(.5 * (attempt + 1))
        return parse_half(json.loads(payload), game, ledger["season"], at, hashlib.sha256(payload).hexdigest())

    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch, game): game for game in due}
        for future in as_completed(pending):
            game = pending[future]
            try:
                half = future.result()
                # An unchanged measurement retains its genuine first-observed time.
                halves.setdefault(half["id"], half)
                checks[game["id"]] = {"gameId": game["id"], "checkedAt": at}
                errors.pop(game["id"], None)
            except Exception as error:
                errors[game["id"]] = {"gameId": game["id"], "reason": str(error)}
    result = {"schemaVersion": 1, "updatedAt": at, "halves": sorted(halves.values(), key=lambda half: (half["observedAt"], half["id"])),
              "checks": sorted(checks.values(), key=lambda check: check["gameId"]), "errors": sorted(errors.values(), key=lambda error: error["gameId"])}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Lab raw halves: {len(latest)} previously known; {len(due)} checked; {len(result['halves'])} immutable versions; {len(errors)} data gaps")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=Path("public/data/season-games.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/lab-halves.json"))
    parser.add_argument("--cache-dir", type=Path, help="Explicit offline replay; reads supplied JSON, never claims historical availability")
    args = parser.parse_args()
    import_halves(json.loads(args.ledger.read_text(encoding="utf-8")), args.output, args.cache_dir)
