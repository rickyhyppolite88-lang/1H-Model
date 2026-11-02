import importlib.util
from pathlib import Path

from openpyxl import load_workbook

spec = importlib.util.spec_from_file_location("workbook_export", Path(__file__).parents[1] / "scripts/build_prediction_workbook.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def row(game_id, away, home, rank=None):
    return {"gameId": game_id, "startsAt": "2026-11-03T00:00:00Z", "awayTeam": "Away", "homeTeam": "Home",
            "awayConference": away, "homeConference": home, "awayRank": rank, "homeRank": None, "rankingsKnown": True,
            "projectedFirstHalfTotal": 72.25, "actualFirstHalfTotal": None, "unavailableReason": None,
            "top25": rank is not None, "comparison": {"line": 70.5, "signedEdge": 1.75, "lean": "OVER"}}


def test_workbook_groups_match_unique_games_and_keep_typed_values(tmp_path):
    data = {"generatedAt": "2026-11-02T23:00:00Z", "defaultSportsbook": "betmgm", "defaultLineBasis": "latest",
            "source": {"projectionCode": "https://example.com/model"},
            "predictions": [row("one", "SEC", "ACC", 1), row("two", "SEC", "SEC"), row("three", None, "Big Ten", 25)]}
    output = tmp_path / "predictions.xlsx"
    exporter.build_workbook(data, output)
    workbook = load_workbook(output)
    ids = lambda sheet: [workbook[sheet].cell(r, 12).value for r in range(7, workbook[sheet].max_row + 1) if workbook[sheet].cell(r, 12).value]
    assert workbook.sheetnames[:2] == ["All Games", "Top 25"]
    assert ids("All Games") == ["one", "two", "three"]
    assert ids("Top 25") == ["one", "three"]
    assert ids("SEC") == ["one", "two"]
    assert ids("ACC") == ["one"]
    assert ids("Unclassified") == ["three"]
    sheet = workbook["All Games"]
    assert sheet["D7"].value == 72.25 and sheet["D7"].data_type == "n"
    assert sheet["F7"].value == 1.75 and sheet["J7"].value is None
    assert sheet["A7"].value.hour == 19  # UTC midnight is the previous evening in New York.
    assert sheet.freeze_panes == "D7" and len(sheet.tables) == 1
    assert not sheet.sheet_view.showGridLines


def test_sheet_names_are_safe_unique_and_excel_length_bounded():
    used = set()
    assert exporter.sheet_name("ACC/SEC", used) == "ACC SEC"
    assert exporter.sheet_name("ACC:SEC", used) == "ACC SEC 2"
    assert len(exporter.sheet_name("Very long conference name " * 5, used)) <= 31
    assert exporter.safe_text("=HYPERLINK(\"bad\")").startswith("'")
    assert exporter.safe_text(-1.5) == -1.5
