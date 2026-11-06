from datetime import datetime, timedelta, timezone
import copy

import pytest

from game_context import event_context
from fit_game_context import build_features, core_baselines, crowd_band, fit, latest_games
from import_context_history import parse_day


def event(note="", neutral=False, conference=False):
    return {"id":"one", "date":"2026-01-05T23:00Z", "season":{"year":2026,"type":2},
            "status":{"type":{"name":"STATUS_FINAL"},"period":2},
            "competitions":[{"neutralSite":neutral,"conferenceCompetition":conference,"attendance":0,
                "venue":{"id":"v","fullName":"Arena","address":{"city":"City"}},
                "notes":[{"headline":note}],"competitors":[
                    {"homeAway":side,"team":{"id":str(i),"displayName":f"Team {i}","conferenceId":"1"},"linescores":[{"value":35,"period":1}]} for i,side in [(1,"home"),(2,"away")]]}]}


@pytest.mark.parametrize("note,conference,expected",[("",True,"conference_regular"),("",False,"nonconference_regular"),("Big Ten Tournament - Quarterfinal",False,"conference_tournament"),("NCAA Men's Basketball Championship - First Round",False,"national_postseason"),("Maui Invitational",False,"other_tournament"),("Hall of Fame Series - Boston",False,"nonconference_regular")])
def test_game_classification_uses_provider_flags_and_explicit_bracket_notes(note, conference, expected):
    ctx=event_context(event(note,True,conference))
    assert ctx["matchupType"]==expected and ctx["neutralSite"] is True
    assert "attendance" not in ctx


def test_missing_neutral_flag_is_unknown_not_an_assumed_home_court():
    data=event();del data["competitions"][0]["neutralSite"]
    assert event_context(data)["neutralSite"] is None


def test_history_keeps_unknown_attendance_missing_and_validates_first_half_scores():
    data=event()
    known={"1":"team-1","2":"team-2"}
    games,gaps=parse_day({"events":[data]},"2025-26","2026-11-06T12:00:00Z","https://example.com",[],known)
    assert not gaps and games[0]["attendance"] is None
    data["competitions"][0]["competitors"][0]["linescores"]=[]
    games,gaps=parse_day({"events":[data]},"2025-26","2026-11-06T12:00:00Z","https://example.com",[],known)
    assert not games and gaps
    with pytest.raises(ValueError,match="season"):
        parse_day({"events":[data]},"2026-27","2026-11-06T12:00:00Z","https://example.com",[],known)


def history(n=400):
    first=datetime(2025,11,1,20,tzinfo=timezone.utc)
    games=[]
    for i in range(n):
        home=i%8; away=(i//8+home+1)%8
        if home==away: away=(away+1)%8
        total=60+home+away+(3 if home%2==0 else -3)
        starts=(first+timedelta(days=i//4,hours=i%4)).isoformat().replace("+00:00","Z")
        games.append({"id":f"id-{i}","gameId":str(i),"season":"2025-26","startsAt":starts,"observedAt":"2026-04-08T00:00:00Z",
            "home":{"modelId":str(home),"points":total//2},"away":{"modelId":str(away),"points":total-total//2},
            "attendance":1000 if i%3==0 else 10000, "context":{"venueKey":f"venue-{home}","neutralSite":False,"matchupType":"nonconference_regular"}})
    return {"games":games,"errors":[]}


def test_training_uses_only_observed_earlier_games_and_deduplicates_corrections():
    raw=history()
    corrected=copy.deepcopy(raw["games"][0]);corrected.update(id="correction",observedAt="2026-11-07T00:00:00Z")
    corrected["home"]["points"]=99
    raw["games"].append(corrected)
    before=latest_games(raw,"2026-11-06T00:00:00Z")
    after=latest_games(raw,"2026-11-08T00:00:00Z")
    assert len(before)==len(after)==400
    assert before[0]["home"]["points"]!=99 and after[0]["home"]["points"]==99


def test_sparse_fit_converges_and_excludes_non_d1_targets_and_small_crowd_penalties():
    raw=history()
    raw["games"][0]["away"]["modelId"]=None
    model=fit(raw,"2026-11-06T00:00:00Z")
    assert model["trainingGames"]==399 and model["converged"]
    assert "crowd:small" not in model["coefficients"]
    assert all(key.startswith(("location:","crowd:","type:")) or key=="neutral" for key in model["coefficients"])
    assert model["rules"]["minimumCrowdAttendance"]==3000
    assert model["rules"]["maximumAdjustment"]==4


def test_venue_proxy_requires_earlier_attendance_and_does_not_use_the_current_game():
    raw=history(4)
    for game in raw["games"]: game["context"]["venueKey"]="same-venue"
    rows,_=build_features(raw["games"])
    assert all(not row["crowdEligible"] for row in rows[:3])
    assert rows[3]["crowdEligible"]
    assert crowd_band(None) is None and crowd_band(1000)=="small"


def test_core_controls_use_original_pregame_forecasts_and_never_a_post_tip_baseline():
    prior={"season":"2025-26","teams":[{"id":str(i),"gamesPlayed":30,"firstHalfPoints":30+i*10,"pace":70,"offensiveEfficiency":1,"defensiveEfficiency":1} for i in range(2)]}
    raw=history(1)
    def record(game,at,total):
        return {"season":"2026-27","gameId":game,"recordedAt":at,"version":1,"state":"pregame","prediction":{"startsAt":"2026-11-06T22:00:00Z","projectedFirstHalfTotal":total}}
    values=core_baselines(raw,prior,[record("before","2026-11-06T21:00:00Z",80),record("before","2026-11-06T21:10:00Z",99),record("after","2026-11-06T23:00:00Z",70)])
    assert values[("2025-26","0")]==70
    assert values[("2026-27","before")]==80
    assert ("2026-27","after") not in values
