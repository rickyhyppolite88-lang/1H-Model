import copy
import importlib.util
import json
from pathlib import Path

import pytest


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / f"scripts/{name}.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


raw = module("import_lab_halves")
settings = module("configure_lab")


def fixture():
    game = {"id": "game", "startsAt": "2026-11-03T00:00:00Z", "firstHalfComplete": True,
            "away": {"espnId": "1", "modelId": "a", "firstHalfPoints": 3},
            "home": {"espnId": "2", "modelId": "b", "firstHalfPoints": 5}}
    competitors = [{"team": {"id": "1"}, "linescores": [{"value": 3}]}, {"team": {"id": "2"}, "linescores": [{"value": 5}]}]
    def play(number, team, kind, clock, attempted=0, made=False):
        return {"id": str(number), "period": {"number": 1}, "team": {"id": team}, "type": {"text": kind},
                "clock": {"displayValue": clock}, "pointsAttempted": attempted, "shootingPlay": attempted > 0 or "FreeThrow" in kind,
                "scoringPlay": made, "scoreValue": attempted if made else 0,
                "text": "Player misses free throw" if attempted == 0 and "FreeThrow" in kind else kind}
    plays = [play(0, "2", "Technical Foul", "19:00")]
    plays += [play(i + 1, "2", "Personal Foul", "9:00" if i == 6 else "18:00") for i in range(7)]
    plays += [play(10, "1", "JumpShot", "8:00", 2, True), play(11, "1", "MadeFreeThrow", "7:00", 1, True),
              play(12, "1", "MadeFreeThrow", "7:00"), play(13, "2", "JumpShot", "6:00", 3, True),
              play(14, "2", "LayUpShot", "5:00", 2, True)]
    return {"header": {"competitions": [{"competitors": competitors}]}, "plays": plays}, game


def test_raw_counts_reconcile_and_seventh_personal_foul_excludes_technical():
    data, game = fixture()
    data["plays"].append(data["plays"][-1])  # repeated event ID is not another basket
    half = raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a" * 64)
    away, home = half["teams"]
    assert (away["points"], home["points"]) == (3, 5)
    assert away["fta"] == 2  # includes the missed FT with missing pointsAttempted
    assert away["freeThrowsMade"] == 1 and home["freeThrowsMade"] == 0
    assert away["bonusMinutes"] == 9
    assert home["fouls"] == 7 and home["bonusMinutes"] == 0
    assert home["threeMade"] == 1 and home["threeAttempted"] == 1


def test_summary_display_value_scores_are_numeric_and_missing_scores_are_not_zero():
    data, game = fixture()
    for competitor in data["header"]["competitions"][0]["competitors"]:
        competitor["linescores"] = [{"displayValue": str(competitor["linescores"][0]["value"])}]
    assert raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)["teams"][0]["points"] == 3
    data["header"]["competitions"][0]["competitors"][0]["linescores"] = []
    with pytest.raises(ValueError, match="reconcile"):
        raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a"*64)


def test_raw_summary_rejects_incomplete_or_inconsistent_halves():
    data, game = fixture()
    game["away"]["firstHalfPoints"] = 4
    with pytest.raises(ValueError, match="reconcile"):
        raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a" * 64)
    data["plays"] = []
    with pytest.raises(ValueError, match="No first-half"):
        raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a" * 64)


def test_repeated_measurement_preserves_first_observed_time_and_corrections_append(tmp_path):
    data, game = fixture()
    cache = tmp_path / "cache"
    cache.mkdir()
    cached = cache / "game.json"
    cached.write_text(json.dumps(data), encoding="utf-8")
    output = tmp_path / "halves.json"
    ledger = {"season": "2026-27", "games": [game]}
    first = raw.import_halves(ledger, output, cache)
    original = copy.deepcopy(first["halves"][0])
    second = raw.import_halves(ledger, output, cache)
    assert second["halves"] == [original]
    game["away"]["firstHalfPoints"] = 4
    data["header"]["competitions"][0]["competitors"][0]["linescores"][0]["value"] = 4
    data["plays"].append({**data["plays"][8], "id": "correction", "pointsAttempted": 1, "scoreValue": 1})
    cached.write_text(json.dumps(data), encoding="utf-8")
    third = raw.import_halves(ledger, output, cache)
    assert not third["errors"]
    assert len(third["halves"]) == 2 and original in third["halves"]


def test_shared_pause_changes_only_the_selected_method_configuration(tmp_path):
    path = tmp_path / "config.json"
    config = {"schemaVersion": 1, "methods": [{"id": name, "enabled": True} for name in settings.METHODS]}
    path.write_text(json.dumps(config), encoding="utf-8")
    settings.configure(path, "first-half-defense-v1", "disable")
    rows = json.loads(path.read_text())["methods"]
    assert all(row["enabled"] == (row["id"] != "first-half-defense-v1") for row in rows)
    settings.configure(path, "first-half-defense-v1", "enable")
    assert all(row["enabled"] for row in json.loads(path.read_text())["methods"])
    with pytest.raises(ValueError):
        settings.configure(path, "unknown", "disable")


def test_free_throw_enrichment_appends_without_rewriting_older_raw_history(tmp_path):
    data, game = fixture()
    original = raw.parse_half(data, game, "2026-27", "2026-11-03T01:00:00Z", "a" * 64)
    for team in original["teams"]:
        team.pop("freeThrowsMade")
    original["id"] = "old-schema-measurement"
    output = tmp_path / "halves.json"
    output.write_text(json.dumps({"halves": [original], "checks": [], "errors": []}), encoding="utf-8")
    cached = tmp_path / "game.json"
    cached.write_text(json.dumps(data), encoding="utf-8")
    result = raw.import_halves({"season": "2026-27", "games": [game]}, output, tmp_path)
    assert len(result["halves"]) == 2 and original in result["halves"]
    enriched = next(half for half in result["halves"] if half["id"] != original["id"])
    assert enriched["teams"][0]["freeThrowsMade"] == 1
    assert enriched["observedAt"] > original["observedAt"]
