"""Snapshot public team colors for decorative jersey icons, separate from model inputs."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

SOURCE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=1000&groups=50"


def identities(data: dict, retrieved_at: str) -> dict:
    leagues = [league for sport in data.get("sports", []) for league in sport.get("leagues", [])
               if league.get("slug") == "mens-college-basketball"]
    if len(leagues) != 1:
        raise ValueError("Expected one NCAA men's basketball team directory")
    teams = {}
    ids = set()
    for entry in leagues[0].get("teams", []):
        team = entry["team"]
        name, team_id = team["displayName"].strip(), str(team["id"])
        if not name or not team_id.isdigit() or name in teams or team_id in ids:
            raise ValueError("Missing or duplicate team identity")
        primary, secondary = team.get("color"), team.get("alternateColor")
        for color in [primary, secondary]:
            if color and not re.fullmatch(r"[0-9a-fA-F]{6}", color):
                raise ValueError(f"Invalid team color: {name}")
        abbreviation = str(team.get("abbreviation", "")).strip()
        if not abbreviation or len(abbreviation) > 12:
            raise ValueError(f"Invalid team abbreviation: {name}")
        ids.add(team_id)
        teams[name] = {"espnId": team_id, "abbreviation": abbreviation,
                       "primaryColor": f"#{primary.lower()}" if primary else None,
                       "secondaryColor": f"#{secondary.lower()}" if secondary else None}
    return {"schemaVersion": 1, "source": SOURCE, "retrievedAt": retrieved_at,
            "artwork": "Illustrated jersey icons using public team colors and abbreviations; not official uniform photographs.",
            "teams": dict(sorted(teams.items()))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Previously retrieved public directory JSON")
    parser.add_argument("--output", type=Path, default=Path("src/data/team-identities.json"))
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
        retrieved = datetime.fromtimestamp(args.input.stat().st_mtime, timezone.utc)
    else:
        with urlopen(Request(SOURCE, headers={"User-Agent": "1H-Model/0.2 (public team identity data)"}), timeout=45) as response:
            raw = response.read()
        retrieved = datetime.now(timezone.utc)
    result = identities(json.loads(raw), retrieved.isoformat().replace("+00:00", "Z"))
    if len(result["teams"]) < 300:
        raise ValueError("The public team directory is incomplete; keep the prior snapshot")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(result['teams'])} public team identities to {args.output}")


if __name__ == "__main__":
    main()
