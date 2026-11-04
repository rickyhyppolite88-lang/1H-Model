import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("team_identities", Path(__file__).parents[1] / "scripts/import_team_identities.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def directory(*teams):
    return {"sports": [{"leagues": [{"slug": "mens-college-basketball", "teams": [{"team": team} for team in teams]}]}]}


def team(**changes):
    return {"id": "1", "displayName": "Example Wildcats", "abbreviation": "EX", "color": "003594", "alternateColor": "FFFFFF", **changes}


def test_color_snapshot_retains_exact_names_and_source_provenance():
    result = module.identities(directory(team()), "2026-11-04T15:00:00Z")
    assert result["source"] == module.SOURCE
    assert result["retrievedAt"] == "2026-11-04T15:00:00Z"
    assert result["teams"]["Example Wildcats"] == {"espnId": "1", "abbreviation": "EX", "primaryColor": "#003594", "secondaryColor": "#ffffff"}


def test_missing_colors_remain_missing_for_the_neutral_jersey_fallback():
    result = module.identities(directory(team(color=None, alternateColor=None)), "2026-11-04T15:00:00Z")
    assert result["teams"]["Example Wildcats"]["primaryColor"] is None


@pytest.mark.parametrize("changes", [{"id": "1", "displayName": "Different Team"}, {"id": "2"}])
def test_rejects_duplicate_team_ids_or_names(changes):
    with pytest.raises(ValueError, match="duplicate"):
        module.identities(directory(team(), team(**changes)), "2026-11-04T15:00:00Z")


def test_rejects_invalid_colors():
    with pytest.raises(ValueError, match="Invalid team color"):
        module.identities(directory(team(color="navy")), "2026-11-04T15:00:00Z")
