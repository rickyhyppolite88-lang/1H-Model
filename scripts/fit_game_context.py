"""Fit incremental context to errors left by the Actual 60/40 core.

The core supplies opponent/pace controls. Prior-season training uses its dated
season-end metrics as in-sample controls; current-season training uses genuinely
recorded pregame core totals. No target game's attendance becomes an input.
"""
from collections import defaultdict
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path

RULES = {"version": "lab-core-residual-v1", "locationPenalty": 40,
         "contextPenalty": 30, "minimumContextGames": 30, "minimumVenueAttendances": 3,
         "minimumLocationGames": 3, "minimumCrowdAttendance": 3000, "maximumAdjustment": 4, "maximumIterations": 600, "tolerance": 0.00001}
TYPES = ["conference_regular", "nonconference_regular", "conference_tournament", "national_postseason", "other_tournament"]
BANDS = ["medium", "large", "very_large"]
GLOBAL_KEYS = ["neutral"] + [f"type:{kind}" for kind in TYPES] + [f"crowd:{band}" for band in BANDS]


def crowd_band(attendance):
    if attendance is None:
        return None
    return "small" if attendance < 3000 else "medium" if attendance < 8000 else "large" if attendance < 15000 else "very_large"


def latest_games(raw, at):
    games = {}
    for game in sorted(raw["games"], key=lambda row: (row["observedAt"], row["id"])):
        if game["observedAt"] <= at and game["startsAt"] < at:
            games[(game["season"], game["gameId"])] = game
    return sorted(games.values(), key=lambda row: (row["startsAt"], row["id"]))


def build_features(games):
    venues = defaultdict(lambda: {"games": 0, "attendanceTotal": 0})
    rows = []
    # All simultaneous games share the same earlier attendance history.
    batches = defaultdict(list)
    for game in games:
        batches[game["startsAt"]].append(game)
    for starts_at in sorted(batches):
        for game in batches[starts_at]:
            context = game["context"]
            venue = venues[context["venueKey"]]
            expected_attendance = venue["attendanceTotal"] / venue["games"] if venue["games"] >= RULES["minimumVenueAttendances"] else None
            crowd = crowd_band(expected_attendance)
            crowd_eligible = crowd in BANDS and expected_attendance >= RULES["minimumCrowdAttendance"]
            if game["away"]["modelId"] or game["home"]["modelId"]:
                values = {key: 0.0 for key in GLOBAL_KEYS}
                values["neutral"] = float(context["neutralSite"] is True)
                if context["matchupType"] in TYPES:
                    values[f"type:{context['matchupType']}"] = 1.0
                if crowd_eligible:
                    values[f"crowd:{crowd}"] = 1.0
                rows.append({"game": game, "global": values, "crowdEligible": crowd_eligible, "signed": 0 if context["neutralSite"] is not False else 1})
        for game in batches[starts_at]:
            if game["attendance"] is not None:
                venue = venues[game["context"]["venueKey"]]
                venue["games"] += 1
                venue["attendanceTotal"] += game["attendance"]
    return rows, dict(venues)


def core_baselines(raw, prior, records):
    keys=["firstHalfPoints","pace","offensiveEfficiency","defensiveEfficiency"]
    teams={team["id"]:team for team in prior["teams"] if team["gamesPlayed"]>0 and all(team.get(key) is not None for key in keys)}
    averages={key:sum(team[key] for team in teams.values())/len(teams) for key in keys}
    adjusted={team_id:{key:team[key]*.65+averages[key]*.35 for key in keys} for team_id,team in teams.items()}
    totals={}
    for game in raw["games"]:
        if game["season"]!=prior["season"]: continue
        a=adjusted.get(game["away"]["modelId"]);b=adjusted.get(game["home"]["modelId"])
        if not a or not b: continue
        pace=(a["pace"]+b["pace"])/2
        efficiency=(a["offensiveEfficiency"]+b["defensiveEfficiency"]+b["offensiveEfficiency"]+a["defensiveEfficiency"])/2
        totals[(game["season"],game["gameId"])]=.6*(a["firstHalfPoints"]+b["firstHalfPoints"])+.4*pace*efficiency/2
    for record in sorted(records,key=lambda row:(row["recordedAt"],row["version"])):
        key=(record["season"],record["gameId"])
        prediction=record["prediction"]
        if key in totals or record["state"]!="pregame" or record["recordedAt"]>=prediction["startsAt"] or prediction["projectedFirstHalfTotal"] is None: continue
        totals[key]=record.get("contextFeatures",{}).get("baselineTotal",prediction["projectedFirstHalfTotal"])
    return totals


def fit(raw, at=None, seasons=None, base_totals=None):
    at = at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    games = latest_games(raw, at)
    if seasons:
        games = [game for game in games if game["season"] in seasons]
    rows, venues = build_features(games)
    if len(rows) < 300:
        raise ValueError("At least 300 earlier D1 halves are required to fit context")
    profiles = {}
    for row in rows:
        game = row["game"]
        for side, sign in [("home", row["signed"]), ("away", -row["signed"])]:
            if not game[side]["modelId"]:
                continue
            key = f"{game['season']}:{game[side]['modelId']}"
            profile = profiles.setdefault(key, {"games": 0, "home": 0, "away": 0, "neutralGames": 0, "signedLocation": 0., **{key: 0. for key in GLOBAL_KEYS}})
            profile["games"] += 1
            profile["neutralGames" if sign == 0 else side] += 1
            profile["signedLocation"] += sign
            for field, value in row["global"].items():
                profile[field] += value
    for profile in profiles.values():
        for key in ["signedLocation", *GLOBAL_KEYS]:
            profile[key] /= profile["games"]
    rows = [row for row in rows if row["game"]["away"]["modelId"] and row["game"]["home"]["modelId"] and (base_totals is None or (row["game"]["season"],row["game"]["gameId"]) in base_totals)]
    if len(rows)<300: raise ValueError("Fewer than 300 games have usable core baseline controls")
    location_counts = defaultdict(lambda: {"home": 0, "away": 0})
    for key, profile in profiles.items():
        team = key.split(":", 1)[1]
        for side in ["home", "away"]:
            location_counts[team][side] += profile[side]
    context_counts = {key: sum(row["global"][key] for row in rows) for key in GLOBAL_KEYS}
    columns = defaultdict(list)
    targets = []
    for index, row in enumerate(rows):
        game = row["game"]
        targets.append(game["away"]["points"] + game["home"]["points"] - (base_totals.get((game["season"],game["gameId"]),0) if base_totals is not None else 0))
        paired = []
        for side, sign in [("home", row["signed"]), ("away", -row["signed"])]:
            team = game[side]["modelId"]
            key = f"{game['season']}:{team}"
            paired.append(profiles[key])
            # Core baseline already controls team/opponent scoring and pace.
            # Refitting free team intercepts here would remove precisely the
            # residual calibration this extension must learn.
            counts = location_counts[team]
            if min(counts.values()) >= RULES["minimumLocationGames"]:
                columns[f"location:{team}"].append((index, sign - profiles[key]["signedLocation"]))
        for key in GLOBAL_KEYS:
            if key.startswith("crowd:") and not row["crowdEligible"]:
                continue
            if context_counts[key] >= RULES["minimumContextGames"]:
                value = row["global"][key] - (paired[0][key] + paired[1][key]) / 2
                if value:
                    columns[key].append((index, value))
    intercept = sum(targets) / len(targets)
    residual = [value - intercept for value in targets]
    keys = sorted(columns)
    coefficients = dict.fromkeys(keys, 0.)
    denominators = {}
    for key in keys:
        penalty = RULES["locationPenalty"] if key.startswith("location:") else RULES["contextPenalty"]
        denominators[key] = sum(value * value for _, value in columns[key]) + penalty
    converged = False
    for iteration in range(RULES["maximumIterations"]):
        shift = sum(residual) / len(residual)
        intercept += shift
        residual = [value - shift for value in residual]
        maximum = abs(shift)
        for key in keys:
            previous = coefficients[key]
            entries = columns[key]
            value = sum(x * (residual[i] + x * previous) for i, x in entries) / denominators[key]
            delta = value - previous
            if delta:
                for i, x in entries:
                    residual[i] -= x * delta
            coefficients[key] = value
            maximum = max(maximum, abs(delta))
        if maximum < RULES["tolerance"]:
            converged = True
            break
    if not converged:
        raise ValueError(f"Context fit did not converge: maximum update {maximum}")
    league = {}
    for season in sorted({game["season"] for game in games}):
        season_profiles = [profile for key, profile in profiles.items() if key.startswith(season + ":")]
        n = sum(profile["games"] for profile in season_profiles)
        if n:
            league[season] = {"games": n, **{field: sum(profile[field] * profile["games"] for profile in season_profiles) / n for field in ["signedLocation", *GLOBAL_KEYS]}}
    return {"schemaVersion": 1, "modelVersion": "lab-context-v1", "fittedAt": at, "rules": RULES,
            "historySha256": hashlib.sha256(json.dumps([game["id"] for game in games], sort_keys=True).encode()).hexdigest(),
            "trainingGames": len(rows), "trainingSeasons": sorted(league), "latestGameAt": max(game["startsAt"] for game in games),
            "iterations": iteration + 1, "converged": converged,
            "coefficients": {key: round(value, 10) for key, value in coefficients.items() if not key.startswith("rating:")},
            "profiles": profiles, "leagueProfiles": league, "locationCounts": dict(location_counts), "contextCounts": context_counts,
            "venues": {key: value for key, value in venues.items() if key and value["games"] > 0}, "sourceErrors": raw.get("errors", [])}


def save_model(history, output):
    raw = json.loads(history.read_text(encoding="utf-8"))
    at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    selected = latest_games(raw, at)
    prior=json.loads(Path("public/data/prior-season.json").read_text(encoding="utf-8"))
    index=json.loads(Path("public/data/prediction-record-index.json").read_text(encoding="utf-8"))
    records=[]
    for archive in index["archives"]:
        records.extend(json.loads((Path("public")/archive["jsonPath"]).read_text(encoding="utf-8"))["records"])
    baselines=core_baselines(raw,prior,records)
    baseline_digest=hashlib.sha256(json.dumps(sorted((f"{key[0]}:{key[1]}",value) for key,value in baselines.items())).encode()).hexdigest()
    digest = hashlib.sha256(json.dumps([game["id"] for game in selected], sort_keys=True).encode()).hexdigest()
    if output.exists():
        previous = json.loads(output.read_text(encoding="utf-8"))
        if previous["historySha256"] == digest and previous["rules"] == RULES and previous.get("baselineSha256")==baseline_digest and previous.get("sourceErrors", []) == raw.get("errors", []):
            print(f"Context model unchanged: {previous['trainingGames']} earlier D1 halves")
            return previous
    model = fit(raw, at, base_totals=baselines)
    model["baselineSha256"]=baseline_digest
    model["baselineMethod"]="Prior-season dated end metrics as in-sample controls; current-season original recorded pregame 60/40 core totals. Intercept and team bias are not added to forecasts."
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({"contextTrainingGames": model["trainingGames"], "iterations": model["iterations"], "coefficients": {key: value for key, value in model["coefficients"].items() if not key.startswith("location:")}}))
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, default=Path("public/data/context-history.json"))
    parser.add_argument("--output", type=Path, default=Path("public/data/context-model.json"))
    args = parser.parse_args()
    save_model(args.history, args.output)
