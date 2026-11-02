import importlib.util
import json
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("team_workbook", ROOT / "scripts/build_team_workbook.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def test_team_report_preserves_missing_inputs_cohorts_and_projection_values(tmp_path):
    data = json.loads((ROOT / "public/data/team-evaluation.json").read_text(encoding="utf-8"))
    data["teams"] = data["teams"][:2]
    data["games"] = data["games"][:2]
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
