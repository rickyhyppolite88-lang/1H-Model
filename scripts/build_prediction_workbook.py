"""Portable recurring GitHub XLSX export from the shared TypeScript report payload."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

HEADERS = ["Tipoff ET", "Away team (rank)", "Home team (rank)", "Model 1H", "Book 1H", "Difference", "Research lean", "Away conference", "Home conference", "Actual 1H", "Availability", "Game ID", "Away rank", "Home rank", "Top 25 game"]
WIDTHS = [19, 30, 30, 13, 12, 12, 15, 17, 17, 12, 39, 15, 11, 11, 14]
GREEN = "203C33"
MUTED = "71816A"


def safe_text(value):
    if isinstance(value, str) and re.match(r"^\s*[=+@-]", value):
        return "'" + value
    return value


def sheet_name(label: str, used: set[str]) -> str:
    base = re.sub(r"[\\/*?:\[\]]", " ", label).strip()[:31] or "Conference"
    name, count = base, 2
    while name.casefold() in used:
        suffix = f" {count}"
        name = base[:31 - len(suffix)] + suffix
        count += 1
    used.add(name.casefold())
    return name


def team_label(row: dict, side: str) -> str:
    rank = row.get(side + "Rank")
    name = row[side + "Team"]
    return f"#{rank} {name}" if rank is not None else name


def build_workbook(data: dict, output: Path) -> None:
    rows = data["predictions"]
    conferences = sorted({row[key] for row in rows for key in ["awayConference", "homeConference"] if row.get(key)})
    groups = [("All Games", rows), ("Top 25", [row for row in rows if row["top25"]])]
    groups.extend((name, [row for row in rows if name in [row.get("awayConference"), row.get("homeConference")]]) for name in conferences)
    if any(not row.get("awayConference") or not row.get("homeConference") for row in rows):
        groups.append(("Unclassified", [row for row in rows if not row.get("awayConference") or not row.get("homeConference")]))
    wb = Workbook()
    wb.remove(wb.active)
    used: set[str] = set()
    generated = datetime.fromisoformat(data["generatedAt"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York"))
    for index, (name, games) in enumerate(groups):
        ws = wb.create_sheet(sheet_name(name, used))
        ws.sheet_view.showGridLines = False
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.sheet_properties.tabColor = GREEN if index < 2 else "A9BA99"
        ws.freeze_panes = "D7"
        ws.sheet_view.zoomScale = 85
        for row_number, height in [(2, 27), (3, 20), (4, 22)]:
            ws.merge_cells(start_row=row_number, start_column=1, end_row=row_number, end_column=11)
            ws.row_dimensions[row_number].height = height
        ws["A2"] = f"{name} first-half projections"
        ws["A2"].font = Font(name="Arial", size=15, color=GREEN, bold=True)
        ws["A3"] = f"Updated {generated:%b %d, %Y %I:%M %p} ET. {data['defaultSportsbook']} {data['defaultLineBasis']} lines. Values are points."
        ws["A3"].font = Font(name="Arial", size=10, color=MUTED)
        predicted = sum(row["projectedFirstHalfTotal"] is not None for row in games)
        ws["A4"] = f"{len(games)} games. {predicted} projected. {len(games) - predicted} with missing inputs."
        ws["A4"].font = Font(name="Arial", size=11, color=GREEN)
        for column, (header, width) in enumerate(zip(HEADERS, WIDTHS), 1):
            cell = ws.cell(6, column, header)
            cell.font = Font(name="Arial", size=10, color="FFFFFF", bold=True)
            cell.fill = PatternFill("solid", fgColor=GREEN)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(right=Side(style="thin", color="FFFFFF"))
            ws.column_dimensions[get_column_letter(column)].width = width
        ws.row_dimensions[6].height = 30
        for row_number, row in enumerate(games, 7):
            comparison = row["comparison"]
            tipoff = datetime.fromisoformat(row["startsAt"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)
            values = [tipoff, team_label(row, "away"), team_label(row, "home"), row["projectedFirstHalfTotal"],
                      comparison["line"], comparison["signedEdge"], comparison["lean"] or "Unavailable",
                      row.get("awayConference") or "Unknown", row.get("homeConference") or "Unknown",
                      row["actualFirstHalfTotal"], row.get("unavailableReason") or ("Line unavailable" if comparison["line"] is None else "Available"),
                      row["gameId"], row.get("awayRank"), row.get("homeRank"), "Yes" if row["top25"] else "No" if row["rankingsKnown"] else "Unknown"]
            for column, value in enumerate(values, 1):
                cell = ws.cell(row_number, column, safe_text(value))
                cell.font = Font(name="Arial", size=11, color=GREEN if column in [4, 6] else "354332", bold=column == 4)
                cell.alignment = Alignment(vertical="center", horizontal="right" if column in [4, 5, 6, 10, 13, 14] else "left", indent=1 if column in [2, 3, 7, 8, 9, 11] else 0, wrap_text=column in [2, 3, 8, 9, 11])
                if row_number % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="F3F6ED")
            ws.cell(row_number, 1).number_format = "m/d/yy h:mm AM/PM"
            for column in [4, 5, 10]:
                ws.cell(row_number, column).number_format = "0.0"
            ws.cell(row_number, 6).number_format = '+0.0;-0.0;"—"'
            ws.row_dimensions[row_number].height = 36 if row["unavailableReason"] is None else 46
        if games:
            ref = f"A6:O{6 + len(games)}"
            table = Table(displayName=f"Predictions{index + 1}", ref=ref)
            table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium4", showRowStripes=True, showColumnStripes=False)
            ws.add_table(table)
            ws.conditional_formatting.add(f"F7:F{6 + len(games)}", CellIsRule(operator="greaterThan", formula=["0"], fill=PatternFill("solid", fgColor="DFECDC")))
            ws.conditional_formatting.add(f"F7:F{6 + len(games)}", CellIsRule(operator="lessThan", formula=["0"], fill=PatternFill("solid", fgColor="E4EDF6")))
        else:
            ws["A7"] = "No games in this group."
        ws["Q2"] = "Source and definitions"
        ws["Q3"] = "Top 25 includes either team ranked 1–25 on ESPN at retrieval."
        ws["Q4"] = "Conference games include either team; a game may appear on two conference sheets."
        ws["Q5"] = "Missing inputs remain blank. Research lean is not a calibrated probability."
        for row_number, url in enumerate(["https://www.espn.com/mens-college-basketball/scoreboard", "https://www.espn.com/mens-college-basketball/rankings", "https://www.sportsbookreview.com/betting-odds/ncaa-basketball/totals/1st-half/", data["source"]["projectionCode"]], 7):
            ws.cell(row_number, 17, url).hyperlink = url
            ws.cell(row_number, 17).font = Font(name="Arial", size=10, color="647A59", underline="single")
        ws.column_dimensions["Q"].width = 100
        ws.print_options.horizontalCentered = False
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A3
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.print_title_rows = "1:6"
        ws.print_area = f"A1:O{max(7, 6 + len(games))}"
    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    print(f"Workbook: {output}, {len(wb.sheetnames)} sheets, {len(rows)} unique games")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_workbook(json.loads(args.input.read_text(encoding="utf-8")), args.output)
