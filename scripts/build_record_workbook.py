"""Readable prediction history from immutable forecast records and result events."""
import argparse
from datetime import datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import PatternFill
from build_team_workbook import sheet


def local(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)


def build_workbook(data, output):
    wb = Workbook()
    wb.remove(wb.active)
    context = f"Updated {local(data['updatedAt']):%b %d, %Y %I:%M %p} ET. Lines retain their recorded sportsbook and entry rule."
    summary = [[s[k] for k in ["season", "modelVersion", "sportsbook", "basis", "games", "versions", "pregame", "wins", "losses", "pushes", "pending", "winRate", "mae"]] for s in data["summary"]]
    sheet(wb, "Record Summary", "Running prediction record", context,
          "One first eligible pregame forecast per game counts. Pushes are excluded from win rate. Historical estimates do not count.",
          ["Season", "Model", "Book", "Line basis", "Games saved", "Versions", "Official forecasts", "Wins", "Losses", "Pushes", "Pending", "Win rate", "Model MAE"],
          [14, 25, 17, 16, 16, 15, 20, 12, 12, 12, 12, 15, 16], summary, {12: "0.0%", 13: "0.0"})
    bands = [[s["season"], s["modelVersion"], b["label"], b["wins"], b["losses"], b["pushes"], b["pending"], b["winRate"]] for s in data["summary"] for b in s["bands"]]
    sheet(wb, "Signal Results", "Does the green signal scale predict better results?", context,
          "Signal scores are research rankings, not hit probabilities. Rates below are observed results of the official pregame forecasts.",
          ["Season", "Model", "Signal band", "Wins", "Losses", "Pushes", "Pending", "Observed win rate"],
          [15, 26, 25, 13, 13, 13, 13, 23], bands, {8: "0.0%"})
    coverage = [[d[k] for k in ["date", "games", "projected", "unavailable", "counted", "unpriced", "historical", "noLean", "otherPregame", "withResults"]] for d in data.get("dailyCoverage", [])]
    sheet(wb, "Daily Coverage", "Every game accounted for by Eastern date", context,
          "Games with missing model inputs or without a recorded pregame line remain visible. Only counted pregame forecasts enter the win rate.",
          ["Game date ET", "Games saved", "With projection", "Missing inputs", "Counted pregame", "No recorded line", "Historical estimate", "No model lean", "Other pregame", "1H results available"],
          [18, 16, 19, 19, 22, 22, 24, 20, 20, 24], coverage)
    daily = data.get("dailyGames", [])
    daily_rows = []
    ordered_daily = sorted(daily, key=lambda r: (-int(r["gameDate"].replace("-", "")), r["prediction"]["startsAt"]))
    for r in ordered_daily:
        p = r["prediction"]
        daily_rows.append([r["gameDate"], local(p["startsAt"]), p["awayTeam"], p["homeTeam"], p["projectedFirstHalfTotal"], r["comparison"]["line"],
                           r["comparison"]["lean"], r["actual"], r["grade"], r["coverageStatus"], local(r["recordedAt"]), r["id"], r["signal"]["score"]])
    daily_ws = sheet(wb, "Daily Games", "All games and their saved predictions", context,
                     "One row per game: the counted forecast when available, otherwise the best saved estimate. Filter Game date ET for today's complete slate.",
                     ["Game date ET", "Tipoff ET", "Away team", "Home team", "Saved model 1H", "Recorded line", "Lean", "Actual 1H", "Result", "Coverage status", "Recorded ET", "Record ID", "Signal / 100"],
                     [18, 25, 31, 31, 18, 18, 14, 16, 20, 28, 25, 37, 18], daily_rows,
                     {2: 'm/d/yy h:mm AM/PM" ET"', 5: "0.0", 6: "0.0", 8: "0.0", 11: 'm/d/yy h:mm AM/PM" ET"'})
    daily_ws.freeze_panes = "E7"
    for row_number, r in enumerate(ordered_daily, 7):
        fill = r["signal"]["fill"].lstrip("#") if r["signal"]["fill"] else "F3F4F0" if row_number % 2 == 0 else "FFFFFF"
        for cell in daily_ws[row_number][:13]:
            cell.fill = PatternFill("solid", fgColor=fill)
    rows = []
    for r in data["records"]:
        p = r["prediction"]
        rows.append([local(r["recordedAt"]), local(p["startsAt"]), p["awayTeam"], p["homeTeam"], p["projectedFirstHalfTotal"],
                     r["comparison"]["line"], r["comparison"]["lean"], r["signal"]["score"], r["grade"], r["actual"], "Yes" if r["counted"] else "No",
                     r["state"], r["version"], r["id"], r["source"]["revision"], p["featureCapturedAt"], f"{r['sportsbook']}/{r['basis']}", r["signal"]["label"]])
    ws = sheet(wb, "Prediction Record", "Every recorded prediction version", context,
               "Green is the frozen research signal. Results use the original recorded line. Later versions are saved and excluded from headline counts.",
               ["Recorded ET", "Tipoff ET", "Away team", "Home team", "Model 1H", "Recorded line", "Lean", "Signal / 100", "Result", "Actual 1H", "Counts", "Capture kind", "Version", "Record ID", "Source revision", "Features captured UTC", "Benchmark", "Signal status"],
               [25, 25, 31, 31, 14, 16, 13, 16, 19, 14, 12, 18, 12, 37, 45, 29, 24, 24], rows,
               {1: 'm/d/yy h:mm AM/PM" ET"', 2: 'm/d/yy h:mm AM/PM" ET"', 5: "0.0", 6: "0.0", 10: "0.0"})
    ws.freeze_panes = "E7"
    for row_number, r in enumerate(data["records"], 7):
        fill = r["signal"]["fill"].lstrip("#") if r["signal"]["fill"] else "F3F4F0" if row_number % 2 == 0 else "FFFFFF"
        for cell in ws[row_number][:18]:
            cell.fill = PatternFill("solid", fgColor=fill)
        if r["grade"] in ["Win", "Loss"]:
            ws.cell(row_number, 9).fill = PatternFill("solid", fgColor="D8EBD3" if r["grade"] == "Win" else "F5DDDA")
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    print(f"Prediction record workbook: {output}, {len(rows)} immutable forecast versions")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_workbook(json.loads(args.input.read_text(encoding="utf-8")), args.output)
