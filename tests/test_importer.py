import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("importer", Path(__file__).parents[1] / "scripts/import_teamrankings.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def html(metric="firstHalfPoints", value="35.4", header="2025", selected="2026-04-07", count=300, record="20-10"):
    rows = "".join(
        f'<tr><td>{index + 1}</td><td><a href="/ncaa-basketball/team/team-{index}">Team {index}</a> ({record})</td>'
        f'<td data-sort="535.4">{value}</td></tr>' for index in range(count)
    )
    return f'<select><option value="{selected}" selected>Season</option></select><table class="datatable"><tr><th>Rank</th><th>Team</th><th>{header}</th></tr>{rows}</table>'


def test_rating_sort_offset_is_not_imported_as_real_strength():
    rows = importer.parse_table(html(header="Rating", value="-5.4"), "strengthOfSchedule", "2025-26", "2026-04-07")
    assert rows["team-0"]["value"] == -5.4
    assert rows["team-0"]["gamesPlayed"] == 30
    assert rows["team-0"]["name"] == "Team 0"


def test_missing_stats_are_null_instead_of_sort_value_zero():
    rows = importer.parse_table(html(value="--"), "firstHalfPoints", "2025-26", "2026-04-07")
    assert rows["team-0"]["value"] is None


@pytest.mark.parametrize("record,games", [("20-10", 30), ("1-1-1", 3), ("0-0-0", 0)])
def test_provider_record_formats_keep_all_games_and_clean_names(record, games):
    rows = importer.parse_table(html(header="Rating", value="-7.9", record=record), "strengthOfSchedule", "2025-26", "2026-04-07")
    assert rows["team-0"] == {"name": "Team 0", "value": -7.9, "gamesPlayed": games}


@pytest.mark.parametrize("record", ["unknown", "1-1-1-1", "1-", "1.5-1"])
def test_missing_or_malformed_schedule_record_still_blocks_import(record):
    with pytest.raises(ValueError, match="missing games record"):
        importer.parse_table(html(header="Rating", value="-7.9", record=record), "strengthOfSchedule", "2025-26", "2026-04-07")


def test_full_import_accepts_three_part_record_without_replacing_stats(monkeypatch):
    values = {"firstHalfPoints": "39.5", "firstHalfAllowed": "39.0", "pace": "78.7", "offensiveEfficiency": "1.125", "defensiveEfficiency": "0.985", "strengthOfSchedule": "-7.9"}
    def fetch(url):
        metric = next(key for key, path in importer.METRICS.items() if path in url)
        return html(value=values[metric], header="Rating" if metric == "strengthOfSchedule" else "2026", selected="2026-11-10", record="1-1-1")
    monkeypatch.setattr(importer, "fetch_html", fetch)
    monkeypatch.setattr(importer.time, "sleep", lambda seconds: None)
    data = importer.import_season("2026-27", "2026-11-10")
    assert len(data["teams"]) == 300
    assert data["teams"][0] == {"id": "team-0", "name": "Team 0", "gamesPlayed": 3, **{key: float(value) for key, value in values.items()}}


def test_first_half_defense_uses_dated_observations_and_rejects_invalid_units():
    rows = importer.parse_table(html(value="31.2"), "firstHalfAllowed", "2025-26", "2026-04-07")
    assert rows["team-0"]["value"] == 31.2
    with pytest.raises(ValueError, match="invalid units"):
        importer.parse_table(html(value="312"), "firstHalfAllowed", "2025-26", "2026-04-07")


@pytest.mark.parametrize("source", [html(header="2024"), html(selected="2025-04-07"), html(count=1), html(value="NaN")], ids=["wrong-season", "wrong-date", "partial", "nonfinite"])
def test_rejects_wrong_season_wrong_date_partial_or_invalid_source(source):
    with pytest.raises(ValueError):
        importer.parse_table(source, "firstHalfPoints", "2025-26", "2026-04-07")


def test_rejects_efficiency_per_100_possessions():
    with pytest.raises(ValueError, match="invalid units"):
        importer.parse_table(html(value="108"), "offensiveEfficiency", "2025-26", "2026-04-07")
