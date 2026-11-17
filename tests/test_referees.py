import copy
import json
from datetime import datetime, timedelta, timezone

import pytest
import import_referees as refs


def fixture():
    game = {"id": "game", "startsAt": "2026-11-03T00:00:00Z", "firstHalfComplete": True,
            "away": {"espnId": "1", "modelId": "a", "firstHalfPoints": 3},
            "home": {"espnId": "2", "modelId": "b", "firstHalfPoints": 5}}
    def play(i, team, kind, clock="18:00", attempted=0, made=False):
        return {"id": str(i), "period": {"number": 1}, "team": {"id": team}, "type": {"text": kind},
                "clock": {"displayValue": clock}, "pointsAttempted": attempted, "shootingPlay": attempted > 0,
                "scoringPlay": made, "scoreValue": attempted if made else 0, "text": kind}
    plays = [play(0, "2", "Technical Foul", "19:00")]
    plays += [play(i+1, "2", "Personal Foul", "9:00" if i == 6 else "18:00") for i in range(7)]
    plays += [play(10, "1", "JumpShot", "8:00", 2, True), play(11, "1", "Free Throw", "7:00", 1, True),
              play(12, "1", "Free Throw", "7:00", 1), play(13, "2", "JumpShot", "6:00", 3, True),
              play(14, "2", "LayUpShot", "5:00", 2, True)]
    plays += [play(100+i, "1" if i % 2 else "2", "JumpShot", "4:00", 2) for i in range(40)]
    data = {"header": {"competitions": [{"competitors": [{"team": {"id": "1"}, "linescores": [{"value": 3}]}, {"team": {"id": "2"}, "linescores": [{"value": 5}]}]}]},
            "gameInfo": {"officials": [{"fullName": name} for name in ["Ref A", "Ref B", "Ref C"]]}, "plays": plays}
    return data, game


def test_referee_measurements_are_first_half_reconciled_and_proxies_are_explicit():
    data, game = fixture()
    assignment, measurement = refs.observation(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)
    metrics = measurement["metrics"]
    assert assignment["observedAt"] > assignment["startsAt"]  # historical, never a pregame assignment
    assert metrics["points"] == 8 and metrics["fouls"] == 7
    assert metrics["technicalTagged"] == 1
    assert metrics["bonus7MinutesProxy"] == 9
    assert metrics["bonus10MinutesProxy"] == 0
    assert metrics["fta"] == 2 and metrics["ftMade"] == 1
    assert metrics["ftSequenceProxy"] == 1
    assert metrics["earlyTwoFoulPlayers"] is None
    assert metrics["foulPlayerIdentityCoverage"] == 0
    assert metrics["shootingFoulsTagged"] == 0  # tags only, not all actual shooting fouls


def test_two_foul_player_metric_requires_complete_player_identity_and_tenth_foul_is_separate():
    data, game = fixture()
    personal = [p for p in data["plays"] if p["type"]["text"] == "Personal Foul"]
    for i, play in enumerate(personal):
        play["athletesInvolved"] = [{"id": str(i//4)}]
    for i in range(3):
        extra = copy.deepcopy(personal[-1]);extra.update(id=f"extra-{i}", clock={"displayValue": f"{8-i}:00"}, athletesInvolved=[{"id": "2"}]);data["plays"].append(extra)
    _, half = refs.observation(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)
    assert half["metrics"]["foulPlayerIdentityCoverage"] == 1
    assert half["metrics"]["earlyTwoFoulPlayers"] == 2
    assert half["metrics"]["bonus7MinutesProxy"] == 9
    assert half["metrics"]["bonus10MinutesProxy"] == 6


def test_pregame_crew_is_collected_without_inventing_half_results():
    data, game = fixture();game["firstHalfComplete"] = False;game["status"] = "Scheduled"
    assignment, half = refs.observation(data, game, "2026-27", "2026-11-02T23:45:00Z", "a"*64)
    assert assignment["observedAt"] < assignment["startsAt"] and half is None
    data["header"]["competitions"][0]["competitors"][0]["team"]["id"] = "wrong"
    with pytest.raises(ValueError, match="participant"):
        refs.observation(data, game, "2026-27", "2026-11-02T23:45:00Z", "a"*64)


def test_crew_validation_never_guesses_missing_or_duplicate_officials():
    data, game = fixture()
    data["gameInfo"]["officials"].pop()
    with pytest.raises(ValueError, match="three-official"):
        refs.observation(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)
    data["gameInfo"]["officials"].append({"fullName": "REF A."})
    with pytest.raises(ValueError, match="Duplicate"):
        refs.observation(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)


def test_source_updates_append_crews_keep_original_receipts_and_block_failed_latest_checks(tmp_path, monkeypatch):
    data, game = fixture();game["firstHalfComplete"] = False;game["status"] = "Scheduled"
    clock = [datetime(2026, 11, 2, 23, 30, tzinfo=timezone.utc)]
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]
    class Response:
        def __enter__(self):return self
        def __exit__(self, *_):return None
        def read(self):return json.dumps(data).encode()
    monkeypatch.setattr(refs, "datetime", Clock)
    monkeypatch.setattr(refs, "urlopen", lambda *_args, **_kwargs: Response())
    output=tmp_path/"refs.json";cache=tmp_path/"cache";ledger={"season":"2026-27","games":[game]}
    first=refs.collect(ledger,output,cache);original=copy.deepcopy(first["assignments"][0])
    clock[0]+=timedelta(minutes=6);data["gameInfo"]["officials"][0]["fullName"]="Replacement Ref"
    second=refs.collect(ledger,output,cache)
    assert len(second["assignments"])==2 and original in second["assignments"]
    assert second["checks"][0]["assignmentId"]!=original["id"]
    receipt=json.loads((cache/"game.receipt.json").read_text())
    assert receipt["observedAt"]==clock[0].isoformat().replace("+00:00","Z")
    clock[0]+=timedelta(minutes=6)
    def fail(*_args,**_kwargs):raise OSError("Source unavailable")
    monkeypatch.setattr(refs,"urlopen",fail);monkeypatch.setattr(refs.time,"sleep",lambda _:None)
    third=refs.collect(ledger,output,cache)
    assert len(third["assignments"])==2 and third["checks"][0]["assignmentId"] is None
    assert third["errors"][0]["reason"]=="Source unavailable"
