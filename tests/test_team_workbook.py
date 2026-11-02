import importlib.util
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("team_workbook", ROOT / "scripts/build_team_workbook.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def test_team_report_preserves_missing_inputs_cohorts_and_projection_values(tmp_path):
    empty = {"sample": 0, "priorMae": None, "modelMae": None, "bias": None, "priorDefenseMae": None, "defenseMae": None}
    graded = {"sample": 1, "priorMae": 2, "modelMae": 0, "bias": 0, "priorDefenseMae": 3, "defenseMae": 2}
    # Keep this fixture independent of today's team records and changing results.
    data = {"priorSeason": "2025-26", "currentSeason": "2026-27", "priorAsOf": "2026-04-07", "currentAsOf": "2026-11-02",
            "source": {"prior": {}, "current": {}}, "summary": {"prospective": empty, "reconstructed": graded, "ungradedCompleted": 0},
            "teams": [{"id": "a", "name": "Team A", "conference": "SEC", "rank": 1, "priorGames": 30, "currentGames": 0, "currentWeight": 0,
                       "metrics": [{"key": key, "prior": value, "current": None, "change": None, "blended": None if key == "firstHalfAllowed" else value}
                                   for key, value in [("firstHalfPoints", 30), ("firstHalfAllowed", 32), ("pace", 70), ("offensiveEfficiency", 1.05), ("defensiveEfficiency", 1.02)]],
                       "prospective": empty, "reconstructed": {**graded, "modelMae": 2, "priorMae": 1}}],
            "games": [{"gameId": "one", "startsAt": "2026-11-03T00:00:00Z", "awayTeam": "Team A", "homeTeam": "Team B", "kind": "reconstructed_season_debut",
                       "awayProjected": 35, "homeProjected": 37, "awayActual": 33, "homeActual": 39, "priorTotal": 70, "modelTotal": 72, "shift": 2, "actualTotal": 72, "error": 0}]}
    target = tmp_path / "teams.xlsx"
    exporter.build_workbook(data, target)
    wb = load_workbook(target, data_only=True)
    assert wb.sheetnames == ["Team Comparison", "Season Check", "Team Accuracy", "Game Review"]
    ws = wb["Team Comparison"]
    assert ws["A7"].value == data["teams"][0]["name"]
    assert ws["E7"].value is None  # Zero-game inputs stay unavailable.
    assert ws["G8"].value is None  # First-half defense is not a new fitted coefficient.
    offense = data["teams"][0]["metrics"][3]["prior"]
    assert abs(ws["D10"].value - offense * 100) < 1e-10
    assert ws["D10"].data_type == "n"
    check = wb["Season Check"]
    assert check["B7"].value == data["summary"]["prospective"]["sample"]
    assert check["C7"].value == data["summary"]["prospective"]["priorMae"]
    assert check["B8"].value == data["summary"]["reconstructed"]["sample"]
    games = wb["Game Review"]
    for index, game in enumerate(data["games"], 7):
        assert games.cell(index, 14).value == game["gameId"]
        assert abs(games.cell(index, 9).value - game["modelTotal"]) < 1e-10
        assert abs(games.cell(index, 4).value + games.cell(index, 5).value - games.cell(index, 9).value) < 1e-10
    for sheet in wb:
        assert sheet.freeze_panes == "C7"
        assert not sheet.sheet_view.showGridLines
