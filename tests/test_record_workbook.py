import json
from pathlib import Path
import subprocess
import sys

from openpyxl import load_workbook


def test_record_workbook_keeps_frozen_values_results_and_signal_colors(tmp_path):
    summary = {"season": "2026-27", "modelVersion": "test", "sportsbook": "betmgm", "basis": "latest", "games": 1, "versions": 1, "pregame": 1,
               "wins": 1, "losses": 0, "pushes": 0, "pending": 0, "winRate": 1, "mae": 2,
               "bands": [{"label": "75–100", "wins": 1, "losses": 0, "pushes": 0, "pending": 0, "winRate": 1}]}
    record = {"id": "one", "recordedAt": "2026-11-02T22:00:00Z", "prediction": {"startsAt": "2026-11-03T00:00:00Z", "awayTeam": "A", "homeTeam": "B", "projectedFirstHalfTotal": 76, "featureCapturedAt": "2026-11-02T20:00:00Z"},
              "comparison": {"line": 70, "lean": "OVER"}, "signal": {"score": 75, "fill": "#acd496", "label": "Aligned"}, "grade": "Win", "actual": 74, "counted": True,
              "state": "pregame", "version": 1, "source": {"revision": "main"}, "sportsbook": "betmgm", "basis": "latest"}
    data = {"updatedAt": "2026-11-03T02:00:00Z", "summary": [summary], "records": [record]}
    source = tmp_path / "input.json"
    output = tmp_path / "record.xlsx"
    source.write_text(json.dumps(data), encoding="utf-8")
    subprocess.run([sys.executable, str(Path(__file__).parents[1] / "scripts/build_record_workbook.py"), "--input", str(source), "--output", str(output)], check=True, capture_output=True)
    wb = load_workbook(output, data_only=True)
    assert wb.sheetnames == ["Record Summary", "Signal Results", "Prediction Record"]
    assert wb["Record Summary"]["H7"].value == 1
    ws = wb["Prediction Record"]
    assert ws["E7"].value == 76 and ws["F7"].value == 70 and ws["I7"].value == "Win"
    assert ws["E7"].fill.fgColor.rgb.upper().endswith("ACD496")
    assert ws["B7"].value.hour == 19 and '" ET"' in ws["B7"].number_format
    assert ws["N7"].value == "one"
