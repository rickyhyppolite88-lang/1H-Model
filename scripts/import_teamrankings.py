"""Import dated public TeamRankings tables; no third-party Python dependencies."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

BASE = "https://www.teamrankings.com/ncaa-basketball"
METRICS = {
    "firstHalfPoints": "stat/1st-half-points-per-game",
    "firstHalfAllowed": "stat/opponent-1st-half-points-per-game",
    "pace": "stat/possessions-per-game",
    "offensiveEfficiency": "stat/offensive-efficiency",
    "defensiveEfficiency": "stat/defensive-efficiency",
    "strengthOfSchedule": "ranking/schedule-strength-by-other",
}


class StatsTable(HTMLParser):
    """Keep visible cell text: rating data-sort values contain a +500 offset."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[dict]] = []
        self.headers: list[str] = []
        self.selected_dates: list[str] = []
        self.in_table = False
        self.row: list[dict] = []
        self.cell: dict | None = None
        self.cell_tag = ""
        self.table_count = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "option" and "selected" in values and values.get("value"):
            self.selected_dates.append(values["value"])
        if tag == "table" and "datatable" in (values.get("class") or "").split():
            self.table_count += 1
            self.in_table = True
        if not self.in_table:
            return
        if tag == "tr":
            self.row = []
        if tag in {"td", "th"}:
            self.cell = {"text": "", "href": None}
            self.cell_tag = tag
        if tag == "a" and self.cell is not None:
            self.cell["href"] = values.get("href")

    def handle_data(self, data: str) -> None:
        if self.in_table and self.cell is not None:
            self.cell["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if not self.in_table:
            return
        if tag in {"td", "th"} and self.cell is not None:
            self.cell["text"] = " ".join(self.cell["text"].split())
            if self.cell_tag == "th":
                self.headers.append(self.cell["text"])
            else:
                self.row.append(self.cell)
            self.cell = None
        if tag == "tr" and self.row:
            self.rows.append(self.row)
        if tag == "table":
            self.in_table = False


def parse_table(html: str, metric: str, season: str, as_of: str) -> dict[str, dict]:
    parser = StatsTable()
    parser.feed(html)
    if as_of not in parser.selected_dates:
        raise ValueError(f"{metric}: source did not confirm requested date {as_of}")
    expected_header = "Rating" if metric == "strengthOfSchedule" else season[:4]
    if parser.table_count != 1 or parser.headers[:3] != ["Rank", "Team", expected_header]:
        raise ValueError(f"{metric}: unexpected table/season headers: {parser.headers[:3]}")
    teams: dict[str, dict] = {}
    for cells in parser.rows:
        if len(cells) < 3 or not cells[1]["text"]:
            raise ValueError(f"{metric}: malformed team row")
        name = re.sub(r"\s*\(\d+-\d+\)\s*$", "", cells[1]["text"]).strip()
        if cells[1]["href"]:
            path = urlparse(cells[1]["href"]).path
            if not path.startswith("/ncaa-basketball/team/"):
                raise ValueError(f"{metric}: unexpected team URL")
            team_id = path.rstrip("/").split("/")[-1]
        else:
            # Archived/discontinued teams can have visible stats but no source link.
            team_id = "unlinked-" + re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")
        if team_id in teams:
            raise ValueError(f"{metric}: duplicate team ID {team_id}")
        record = re.search(r"\((\d+)-(\d+)\)\s*$", cells[1]["text"])
        visible = cells[2]["text"].replace(",", "")
        number = None if visible in {"--", "N/A", "", "-"} else float(visible)
        if number is not None and not math.isfinite(number):
            raise ValueError(f"{metric}: non-finite statistic")
        if number is not None:
            bounds = {
                "firstHalfPoints": (0, 100), "firstHalfAllowed": (0, 100), "pace": (30, 120),
                "offensiveEfficiency": (0.3, 2), "defensiveEfficiency": (0.3, 2),
                "strengthOfSchedule": (-100, 100),
            }[metric]
            if not bounds[0] <= number <= bounds[1]:
                raise ValueError(f"{metric}: invalid units/value {number} for {team_id}")
        if metric == "strengthOfSchedule" and not record:
            raise ValueError(f"{metric}: missing games record for {team_id}")
        teams[team_id] = {
            "name": name, "value": number,
            "gamesPlayed": sum(map(int, record.groups())) if record else None,
        }
    if len(teams) < 300:
        raise ValueError(f"{metric}: only {len(teams)} teams; refusing a partial or blocked response")
    return teams


def fetch_html(url: str) -> str:
    request = Request(url, headers={"User-Agent": "1H-Model/0.1 (public dated team-statistics importer)"})
    with urlopen(request, timeout=40) as response:
        if response.status != 200:
            raise ValueError(f"Unexpected HTTP status {response.status}")
        return response.read().decode("utf-8")


def import_season(season: str, as_of: str) -> dict:
    start = int(season[:4])
    if season != f"{start}-{str(start + 1)[-2:]}":
        raise ValueError("Season must be consecutive years, e.g. 2025-26")
    requested = date.fromisoformat(as_of)
    if not date(start, 7, 1) <= requested <= date(start + 1, 6, 30):
        raise ValueError("Requested snapshot date is outside the season")
    if requested > date.today():
        raise ValueError("Cannot import a future snapshot")
    tables: dict[str, dict] = {}
    urls: dict[str, str] = {}
    for metric, path in METRICS.items():
        urls[metric] = f"{BASE}/{path}?date={as_of}"
        tables[metric] = parse_table(fetch_html(urls[metric]), metric, season, as_of)
        print(f"{metric}: {len(tables[metric])} teams")
        time.sleep(0.4)
    expected = set(tables["strengthOfSchedule"])
    for metric, table in tables.items():
        if set(table) != expected:
            raise ValueError(f"{metric}: team IDs do not match the other tables; refusing a partial join")
    teams = []
    for team_id in sorted(expected):
        schedule = tables["strengthOfSchedule"][team_id]
        team = {"id": team_id, "name": schedule["name"], "gamesPlayed": schedule["gamesPlayed"]}
        team.update({metric: table[team_id]["value"] for metric, table in tables.items()})
        if team["gamesPlayed"] == 0:
            # Preseason ratings and missing-stat sort values are not completed-game observations.
            for metric in METRICS:
                team[metric] = None
        elif any(team[key] is None for key in ["firstHalfPoints", "pace", "offensiveEfficiency", "defensiveEfficiency"]):
            print(f"Warning: incomplete completed-game statistics for {team['name']}")
        teams.append(team)
    return {
        "schemaVersion": 1, "season": season, "asOf": as_of,
        "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {"name": "TeamRankings", "urls": urls},
        "teams": sorted(teams, key=lambda team: team["name"].casefold()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", required=True)
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dataset = import_season(args.season, args.as_of)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    observed = sum(team["gamesPlayed"] > 0 for team in dataset["teams"])
    print(f"Saved {len(dataset['teams'])} teams; {observed} have completed games: {args.output}")


if __name__ == "__main__":
    main()
