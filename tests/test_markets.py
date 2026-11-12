import importlib.util
import json
from datetime import date
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


@pytest.mark.parametrize("total", [0, 0.0])
def test_zero_total_placeholder_is_an_unavailable_quote(total):
    assert markets.quote({"total": total, "overOdds": 0, "underOdds": 0}) is None


def test_verified_upstate_provider_alias_is_consistent():
    assert markets.normalize("USC Upstate Spartans") == markets.normalize("South Carolina Upstate Spartans")


@pytest.mark.parametrize("rank,expected,known", [(1, 1, True), (25, 25, True), (99, None, True), (None, None, False), (0, None, False)])
def test_rank_and_conference_classification(rank, expected, known):
    result = markets.team_classification({"team": {"conferenceId": "23"}, "curatedRank": {"current": rank}}, {"23": "SEC"})
    assert result == {"conferenceId": "23", "conference": "SEC", "rank": expected, "rankKnown": known}


@pytest.mark.parametrize("espn_id,target", [("2393", "middle-tennessee-st-blue-raiders"), ("82", "illinois-chicago-flames"), ("399", "albany-great-danes"), ("2546", "se-missouri-st-redhawks"), ("145", "mississippi-rebels"), ("2547", "seattle-redhawks"), ("2463", "csu-northridge-matadors")])
def test_verified_team_alias_requires_an_existing_model_record(espn_id, target):
    team = {"id": espn_id, "displayName": "Provider alias"}
    assert markets.model_id(team, [{"id": target, "name": "Model team"}]) == target
    assert markets.model_id(team, []) is None


def test_incremental_refresh_keeps_a_known_midnight_game_without_refetching_prior_day(monkeypatch, tmp_path):
    output = tmp_path / "ledger.json"
    output.write_text(json.dumps({"season": "2026-27", "seasonStart": "2026-11-01", "through": "2026-11-01", "games": [{
        "id": "espn-1", "oddsGameId": "1", "startsAt": "2026-11-02T04:59:00Z", "quotes": [],
        "away": {"espnId": "2463", "name": "Cal State Northridge Matadors"}, "home": {"espnId": "b"},
    }]}), encoding="utf-8")
    monkeypatch.setattr(markets, "read_url", lambda url: json.dumps({"leagues": [{"id": "41", "groups": [{"id": "50", "children": [{"id": "23", "name": "SEC"}]}]}]}) if "dropdown" in url else json.dumps({"events": []}) if "site.api.espn.com" in url else board())
    monkeypatch.setattr(markets.time, "sleep", lambda seconds: None)
    result = markets.import_games("2026-27", date(2026, 11, 2), date(2026, 11, 2), output)
    assert result["unmatchedOdds"] == []
    assert result["games"][0]["id"] == "espn-1"
    assert result["games"][0]["away"]["modelId"] == "csu-northridge-matadors"
    assert result["games"][0].get("featureSnapshot") is None
