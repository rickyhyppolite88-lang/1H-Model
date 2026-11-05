import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("markets", Path(__file__).parents[1] / "scripts/import_season_games.py")
markets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(markets)


@pytest.mark.parametrize("espn_id,espn_name,source_name", [
    ("399", "UAlbany Great Danes", "University at Albany Great Danes"),
    ("247", "King's Monarchs", "King's College (PA) Monarchs"),
    ("131616", "Central Bible Saints", "Central Christian College of the Bible Saints"),
    ("2119", "Central State Marauders", "Central State (OH) Marauders"),
])
def test_verified_cross_provider_alias_still_requires_opponent_and_time(espn_id, espn_name, source_name):
    row = {"gameView": {"gameId": 1, "startDate": "2026-11-06T00:00:00+00:00",
                        "awayTeam": {"fullName": source_name}, "homeTeam": {"fullName": "Manhattan Jaspers"}}}
    event = {"id": "event", "date": "2026-11-06T00:00Z", "competitions": [{"competitors": [
        {"team": {"id": espn_id, "displayName": espn_name}}, {"team": {"id": "2363", "displayName": "Manhattan Jaspers"}}]}]}
    assert markets.match_event(row, [event]) is event
    event["date"] = "2026-11-07T00:00Z"
    assert markets.match_event(row, [event]) is None
    event["date"] = "2026-11-06T00:00Z"
    event["competitions"][0]["competitors"][1]["team"]["displayName"] = "Different opponent"
    assert markets.match_event(row, [event]) is None


def test_conflicting_grace_identity_is_not_guessed_from_home_team_alone():
    assert not markets.identifiers({"displayName": "Grace (CA)", "fullName": " Talons"}) & markets.identifiers({"id": "134743", "displayName": "Grace University Lancers"}, espn=True)


@pytest.mark.parametrize("mode", ["available", "no_current_line", "not_in_feed", "not_matched", "unmatched"])
def test_source_counts_and_last_known_quote_provenance(monkeypatch, tmp_path, mode):
    output = tmp_path / "ledger.json"
    old_time = "2026-11-05T10:00:00Z"
    old_quote = {"sportsbook": "betmgm", "opening": {"total": 68.5}, "latest": {"total": 69.5},
                 "openingCapturedAt": old_time, "latestCapturedAt": old_time}
    output.write_text(json.dumps({"season": "2026-27", "seasonStart": "2026-11-01", "through": "2026-11-05", "games": [{
        "id": "event", "startsAt": "2026-11-06T00:00:00Z", "quotes": [old_quote],
        "away": {"espnId": "399"}, "home": {"espnId": "2363"},
    }]}), encoding="utf-8")
    event = {"id": "event", "date": "2026-11-06T00:00Z", "status": {"period": 0, "type": {"name": "STATUS_SCHEDULED", "description": "Scheduled"}},
             "competitions": [{"competitors": [
                 {"homeAway": "away", "team": {"id": "399", "displayName": "UAlbany Great Danes"}},
                 {"homeAway": "home", "team": {"id": "2363", "displayName": "Manhattan Jaspers"}}]}]}
    row = {"gameView": {"gameId": 1, "startDate": "2026-11-06T00:00:00+00:00",
                        "awayTeam": {"fullName": "University at Albany Great Danes" if mode != "unmatched" else "Unknown team"}, "homeTeam": {"fullName": "Manhattan Jaspers"}},
           "oddsViews": [] if mode == "not_in_feed" else [{"sportsbook": "betmgm", "openingLine": {"total": 68.5}, "currentLine": None if mode == "no_current_line" else {"total": 70.5}}]}
    page = {"query": {"date": "2026-11-05", "league": "ncaa-basketball", "oddsType": "totals", "oddsScope": ["1st-half"]},
            "props": {"pageProps": {"oddsTables": [{"league": "NCAAB", "oddsTableModel": {"gameRows": [] if mode == "not_matched" else [row]}}]}}}
    directory = {"leagues": [{"id": "41", "groups": [{"id": "50", "children": [{"id": "1", "name": "Conference"}]}]}]}
    monkeypatch.setattr(markets, "read_url", lambda url: json.dumps(directory) if "dropdown" in url else json.dumps({"events": [event]}) if "site.api.espn.com" in url else '<script id="__NEXT_DATA__">' + json.dumps(page) + '</script>')
    monkeypatch.setattr(markets.time, "sleep", lambda _: None)
    result = markets.import_games("2026-27", date(2026, 11, 5), date(2026, 11, 5), output)
    game = result["games"][0]
    check = result["marketChecks"][0]
    assert check["date"] == "2026-11-05"  # midnight UTC is still today's ET slate
    assert game["quotes"][0]["opening"]["total"] == 68.5
    if mode == "available":
        assert game["quotes"][0]["latest"]["total"] == 70.5
        assert check["books"] == [{"sportsbook": "betmgm", "sourceLines": 1, "importedLines": 1, "unmatchedLines": 0}]
    else:
        assert game["quotes"][0]["latest"]["total"] == 69.5
        assert game["quotes"][0]["latestCapturedAt"] == old_time
    if mode == "unmatched":
        assert check["unmatchedGames"] == 1
        assert check["books"][0]["unmatchedLines"] == 1
        assert result["unmatchedOdds"][0]["booksWithLines"] == ["betmgm"]
    elif mode == "not_matched":
        assert game["marketCoverage"]["status"] == "not_matched"
    elif mode == "no_current_line":
        assert game["marketCoverage"]["books"][0]["status"] == "no_current_line"
