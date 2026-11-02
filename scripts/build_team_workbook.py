"""Render the shared TypeScript team evaluation payload as a portable daily Excel report."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter

GREEN = "203C33"
METRICS = {
    "firstHalfPoints": ("1H points scored / game", 1),
    "firstHalfAllowed": ("1H points allowed / game", 1),
    "pace": ("Possessions / full game", 1),
    "offensiveEfficiency": ("Offense: points / 100 possessions", 100),
    "defensiveEfficiency": ("Defense: points allowed / 100 possessions", 100),
}


def safe(value):
    return "'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value


def sheet(wb, name, title, context, note, headers, widths, rows, formats=None):
    ws = wb.create_sheet(name)
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 85
    ws.sheet_properties.tabColor = GREEN
    ws.freeze_panes = "C7"
    for index, text in [(2, title), (3, context), (4, note)]:
        ws.merge_cells(start_row=index, start_column=1, end_row=index, end_column=min(11, len(headers)))
        ws.cell(index, 1, text).font = Font(name="Arial", size=15 if index == 2 else 10, bold=index == 2, color=GREEN)
        ws.row_dimensions[index].height = 27 if index == 2 else 25
        ws.cell(index, 1).alignment = Alignment(vertical="center", wrap_text=True)
    for column, (header, width) in enumerate(zip(headers, widths), 1):
        cell = ws.cell(6, column, header)
        cell.font = Font(name="Arial", color="FFFFFF", bold=True, size=10)
        cell.fill = PatternFill("solid", fgColor=GREEN)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(column)].width = width
    ws.row_dimensions[6].height = 36
    for number, values in enumerate(rows, 7):
        for column, value in enumerate(values, 1):
            cell = ws.cell(number, column, safe(value))
            cell.font = Font(name="Arial", size=11, color=GREEN)
            cell.alignment = Alignment(vertical="center", wrap_text=True, horizontal="right" if isinstance(value, (int, float)) else "left")
            if number % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F3F6ED")
            if formats and column in formats:
                cell.number_format = formats[column]
        ws.row_dimensions[number].height = 36
    if rows:
        table = Table(displayName=name.replace(" ", ""), ref=f"A6:{get_column_letter(len(headers))}{6 + len(rows)}")
        table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium4", showRowStripes=True)
        ws.add_table(table)
    else:
        ws["A7"] = "No graded games in this cohort yet."
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = "1:6"
    ws.print_area = f"A1:{get_column_letter(len(headers))}{max(7, 6 + len(rows))}"
    return ws


def build_workbook(data: dict, output: Path):
    wb = Workbook()
    wb.remove(wb.active)
    context = f"{data['priorSeason']} final through {data['priorAsOf']} to {data['currentSeason']} through {data['currentAsOf']}."
    rows = []
    for team in data["teams"]:
        for metric in team["metrics"]:
            label, scale = METRICS[metric["key"]]
            values = [metric[key] * scale if metric[key] is not None else None for key in ["prior", "current", "change", "blended"]]
            rows.append([team["name"], team["conference"], label, *values, team["priorGames"], team["currentGames"], team["currentWeight"], team["rank"], team["id"]])
    ws = sheet(wb, "Team Comparison", "Team offense and defense across seasons", context,
               "Allowed points is context only. Higher offense / lower defense is better. Missing inputs stay blank. Prior regression: 35%; strength: 8 games.",
               ["Team", "Conference", "Metric / units", "Prior final", "Current observed", "Season change", "Blended input", "Prior games", "Current games", "Current weight", "Rank", "Team ID"],
               [29, 19, 36, 14, 16, 15, 16, 13, 13, 15, 10, 38], rows,
               {4: "0.0", 5: "0.0", 6: '+0.0;-0.0;"—"', 7: "0.0", 10: "0%"})
    ws["N2"] = "Public dated source tables"
    for index, url in enumerate([*data["source"]["prior"].values(), *data["source"]["current"].values()], 3):
        ws.cell(index, 14, url).hyperlink = url
    ws.column_dimensions["N"].width = 110
    origins = [("prospective", "Captured before tipoff"), ("reconstructed", "Reconstructed season debut")]
    overall = []
    for key, label in origins:
        c = data["summary"][key]
        overall.append([label, c["sample"], c["priorMae"], c["modelMae"], c["bias"]])
    sheet(wb, "Season Check", "Season-wide combined first-half total checks", context,
          f"Lower MAE is better. Both models use the same eligible games. {data['summary']['ungradedCompleted']} completed games lack comparable predictions.",
          ["Prediction origin", "Games checked", "Prior baseline MAE", "Blended model MAE", "Model bias"],
          [34, 19, 24, 24, 20], overall, {3: "0.0", 4: "0.0", 5: "0.0"})
    accuracy = []
    for team in data["teams"]:
        for key, label in origins:
            c = team[key]
            if c["sample"]:
                accuracy.append([team["name"], label, c["sample"], c["priorMae"], c["modelMae"], c["priorDefenseMae"], c["defenseMae"], c["bias"]])
    sheet(wb, "Team Accuracy", "Did the offense and defense estimates match?", context,
          "MAE is absolute first-half point error; lower is better. Bias = predicted minus actual. Reconstructed rows were not recorded forecasts.",
          ["Team", "Prediction origin", "Games checked", "Prior offense MAE", "Model offense MAE", "Prior defense MAE", "Model defense MAE", "Scoring bias"],
          [29, 33, 15, 19, 19, 19, 19, 17], accuracy, {i: "0.0" for i in range(4, 9)})
    reviews = []
    for game in data["games"]:
        tipoff = datetime.fromisoformat(game["startsAt"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)
        kind = "Captured before tipoff" if game["kind"] == "captured_pregame" else "Reconstructed debut" if game["kind"] else "No eligible inputs"
        reviews.append([tipoff, game["awayTeam"], game["homeTeam"], game["awayProjected"], game["homeProjected"], game["awayActual"], game["homeActual"], game["priorTotal"], game["modelTotal"], game["shift"], game["actualTotal"], game["error"], kind, game["gameId"]])
    sheet(wb, "Game Review", "Prior baseline versus frozen blended predictions", context,
          "Team estimates add to the combined total. Change = blended minus prior baseline. Error = blended minus actual. Unscored games stay blank.",
          ["Tipoff ET", "Away team", "Home team", "Away estimate", "Home estimate", "Away actual", "Home actual", "Prior total", "Blended total", "Change", "Actual total", "Total error", "Prediction origin", "Game ID"],
          [19, 32, 32, 15, 15, 14, 14, 14, 15, 14, 14, 14, 29, 17], reviews,
          {1: "m/d/yy h:mm AM/PM", **{i: "0.0" for i in range(4, 13)}})
    wb.properties.title = "1H Model team comparison"
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    print(f"Team workbook: {output}, {len(data['teams'])} teams, {len(reviews)} games")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_workbook(json.loads(args.input.read_text(encoding="utf-8")), args.output)
