import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("importer", Path(__file__).parents[1] / "scripts/import_teamrankings.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def html(metric="firstHalfPoints", value="35.4", header="2025", selected="2026-04-07", count=300):
    rows = "".join(
        f'<tr><td>{index + 1}</td><td><a href="/ncaa-basketball/team/team-{index}">Team {index}</a> (20-10)</td>'
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


@pytest.mark.parametrize("source", [html(header="2024"), html(selected="2025-04-07"), html(count=1), html(value="NaN")], ids=["wrong-season", "wrong-date", "partial", "nonfinite"])
def test_rejects_wrong_season_wrong_date_partial_or_invalid_source(source):
    with pytest.raises(ValueError):
        importer.parse_table(source, "firstHalfPoints", "2025-26", "2026-04-07")


def test_rejects_efficiency_per_100_possessions():
    with pytest.raises(ValueError, match="invalid units"):
        importer.parse_table(html(value="108"), "offensiveEfficiency", "2025-26", "2026-04-07")
