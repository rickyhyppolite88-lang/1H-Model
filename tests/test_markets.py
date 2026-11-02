import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("markets", Path(__file__).parents[1] / "scripts/import_season_games.py")
markets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(markets)


def board(scope="1st-half", market="totals", day="2026-11-02"):
    page = {"query": {"date": day, "league": "ncaa-basketball", "oddsType": market, "oddsScope": [scope]},
            "props": {"pageProps": {"oddsTables": [{"league": "NCAAB", "oddsTableModel": {"gameRows": [None, {"gameView": {"gameId": 1}}]}}]}}}
    return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(page) + '</script>'


def test_parser_confirms_first_half_totals_and_skips_empty_rows():
    assert len(markets.parse_odds(board(), "2026-11-02")) == 1


@pytest.mark.parametrize("page", [board(scope="full-game"), board(market="pointspread"), board(day="2026-11-01")], ids=["full-game", "spread", "wrong-date"])
def test_wrong_market_or_date_is_rejected(page):
    with pytest.raises(ValueError):
        markets.parse_odds(page, "2026-11-02")


def test_first_half_is_not_partial_score_in_first_period():
    event = {"status": {"period": 1, "type": {"name": "STATUS_IN_PROGRESS"}}}
    assert not markets.half_complete(event)
    assert markets.first_half({"linescores": [{"period": 1, "value": 27}]}, False) is None


def test_second_half_allows_completed_first_half_result():
    event = {"status": {"period": 2, "type": {"name": "STATUS_IN_PROGRESS"}}}
    assert markets.half_complete(event)
    assert markets.first_half({"linescores": [{"period": 1, "value": 43}, {"period": 2, "value": 7}]}, True) == 43


def test_missing_first_half_is_not_zero_or_full_game_score():
    assert markets.first_half({"score": 100, "linescores": []}, True) is None
    assert markets.quote(None) is None
    with pytest.raises(ValueError):
        markets.quote({"total": 165.5})


def test_midnight_provider_date_boundary_matches_by_teams_and_time():
    row = {"gameView": {"gameId": 1, "startDate": "2026-11-02T05:00:00+00:00", "awayTeam": {"fullName": "High Point Panthers"}, "homeTeam": {"fullName": "Liberty Flames"}}}
    event = {"date": "2026-11-02T04:59Z", "competitions": [{"competitors": [{"team": {"displayName": "Liberty Flames"}}, {"team": {"displayName": "High Point Panthers"}}]}]}
    assert markets.match_event(row, [event]) is event
    with pytest.raises(ValueError, match="Ambiguous"):
        markets.match_event(row, [event, event])


def test_verified_upstate_provider_alias_is_consistent():
    assert markets.normalize("USC Upstate Spartans") == markets.normalize("South Carolina Upstate Spartans")
