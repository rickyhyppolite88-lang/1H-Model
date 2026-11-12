import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("refresh_plan", Path(__file__).parents[1] / "scripts/plan_refresh.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)
NOW = datetime(2026, 11, 4, 23, tzinfo=timezone.utc)


def ledger(minutes=60, status="Scheduled", complete=False, age=30):
    return {"season": "2026-27", "through": "2026-11-04", "capturedAt": (NOW - timedelta(minutes=age)).isoformat(),
            "games": [{"id": "game", "startsAt": (NOW + timedelta(minutes=minutes)).isoformat(), "status": status, "firstHalfComplete": complete}]}


def poll(data, now=NOW):
    return refresh.plan_refresh(data, now, "schedule", refresh.POLL_SCHEDULE)


@pytest.mark.parametrize("minutes,expected", [(76, "skip"), (75, "markets"), (60, "markets"), (45, "markets"), (1, "markets")])
def test_pre_tip_window_targets_about_one_hour_and_catches_late_jobs(minutes, expected):
    result = poll(ledger(minutes=minutes, age=20))
    assert result["mode"] == expected
    assert result["nearTipGames"] == (0 if expected == "skip" else 1)


@pytest.mark.parametrize("age,mode", [(14.99, "skip"), (15, "markets"), (20, "markets")])
def test_successful_check_is_not_repeated_too_soon(age, mode):
    assert poll(ledger(age=age))["mode"] == mode


@pytest.mark.parametrize("age,mode", [(4.99, "skip"), (5, "markets"), (10, "markets")])
def test_final_fifteen_minutes_check_lines_every_five_minutes(age, mode):
    result = poll(ledger(minutes=8, age=age))
    assert result["mode"] == mode
    if mode == "markets":
        assert "Final pre-tip" in result["reason"]


@pytest.mark.parametrize("status", ["Canceled", "Postponed", "In Progress", "Final"])
def test_final_pretip_acceleration_does_not_rank_started_or_inactive_games(status):
    result = poll(ledger(minutes=8, age=5, status=status))
    assert result["mode"] == ("markets" if status in {"In Progress", "Final"} else "skip")
    assert result["nearTipGames"] == 0


@pytest.mark.parametrize("status,complete", [("Canceled", False), ("Cancelled", False), ("Postponed", False), ("Final", True), ("In Progress", True)])
def test_canceled_or_completed_halves_do_not_trigger_near_tip_checks(status, complete):
    assert poll(ledger(status=status, complete=complete))["mode"] == "skip"


@pytest.mark.parametrize("minutes,status,mode", [(0, "Scheduled", "markets"), (-45, "In Progress", "markets"), (-240, "Final", "markets"), (-241, "Final", "skip"), (20, "In Progress", "markets")])
def test_results_followup_is_bounded_and_reported_started_games_are_not_called_pregame(minutes, status, mode):
    result = poll(ledger(minutes=minutes, status=status))
    assert result["mode"] == mode
    assert result["nearTipGames"] == 0


def test_periodic_discovery_does_not_require_an_already_known_near_tip_game():
    data = ledger(minutes=200, age=120)
    assert poll(data)["mode"] == "markets"
    data["games"] = []
    assert poll(data)["mode"] == "markets"
    data["capturedAt"] = (NOW - timedelta(minutes=119)).isoformat()
    assert poll(data)["mode"] == "skip"


@pytest.mark.parametrize("age,mode", [(29, "skip"), (30, "markets"), (90, "markets")])
def test_morning_lines_are_discovered_before_the_pre_tip_window(age, mode):
    data = ledger(minutes=240, age=age)
    assert poll(data)["mode"] == mode


def test_tomorrows_games_do_not_trigger_the_faster_today_discovery():
    data = ledger(minutes=24 * 60, age=30)
    assert poll(data)["mode"] == "skip"


def test_new_eastern_day_requires_stats_and_schedule_discovery_before_line_only_polls():
    data = ledger()
    data["through"] = "2026-11-03"
    assert poll(data)["mode"] == "full"
    data["capturedAt"] = (NOW - timedelta(minutes=5)).isoformat()
    assert poll(data)["mode"] == "skip"


@pytest.mark.parametrize("age,mode", [(4.99,"skip"),(5,"markets"),(10,"markets")])
def test_active_first_half_results_are_checked_every_five_minutes(age,mode):
    result=poll(ledger(minutes=-45,status="In Progress",age=age))
    assert result["mode"] == mode
    if mode == "markets":
        assert result["activeHalves"] == 1
        assert result["minimumRefreshMinutes"] == 5


def test_result_refresh_includes_prior_eastern_date_for_unfinished_overnight_games():
    now=datetime(2026,11,5,5,15,tzinfo=timezone.utc)
    data=ledger(minutes=-60,status="In Progress",age=5)
    data.update(through="2026-11-05",capturedAt="2026-11-05T05:10:00Z")
    data["games"][0]["startsAt"]="2026-11-05T04:30:00Z"
    result=poll(data,now)
    assert result["mode"] == "markets"
    assert result["date"] == "2026-11-05"
    assert result["date_from"] == "2026-11-04"
    data["games"][0]["firstHalfComplete"]=True
    assert poll(data,now)["mode"] == "skip"


def test_utc_midnight_is_not_an_eastern_date_rollover():
    now = datetime(2026, 11, 5, 0, 30, tzinfo=timezone.utc)
    data = ledger(minutes=60)
    data["capturedAt"] = "2026-11-04T23:45:00Z"
    data["games"][0]["startsAt"] = "2026-11-05T01:30:00Z"
    result = poll(data, now)
    assert result["date"] == "2026-11-04"
    assert result["mode"] == "markets"
    assert result["nearTipGames"] == 1


def test_daylight_saving_jump_uses_elapsed_minutes_not_wall_clock_hours():
    data = ledger()
    data.update(season="2025-26", through="2026-03-08", capturedAt="2026-03-08T05:00:00Z")
    data["games"][0]["startsAt"] = "2026-03-08T07:30:00Z"
    result = poll(data, datetime(2026, 3, 8, 6, 30, tzinfo=timezone.utc))
    assert result["nearTipGames"] == 1
    assert result["date"] == "2026-03-08"


def test_full_schedule_and_manual_requests_have_explicit_refresh_modes():
    data = ledger(age=1)
    assert refresh.plan_refresh(data, NOW, "schedule", refresh.FULL_SCHEDULE)["mode"] == "full"
    assert refresh.plan_refresh(data, NOW, "schedule", refresh.LEGACY_FULL_SCHEDULE)["mode"] == "full"
    assert refresh.plan_refresh(data, NOW, "workflow_dispatch", refresh_data=True)["mode"] == "full"
    assert refresh.plan_refresh(data, NOW, "workflow_dispatch", refresh_lines=True)["mode"] == "markets"
    assert refresh.plan_refresh(data, NOW, "workflow_dispatch")["mode"] == "build"
    assert refresh.plan_refresh(data, NOW, "pull_request")["mode"] == "build"
    assert refresh.plan_refresh(data, NOW, "push")["mode"] == "build"


def test_offseason_is_skipped_but_source_validation_can_still_run():
    data = ledger()
    later = datetime(2027, 6, 1, tzinfo=timezone.utc)
    assert poll(data, later)["mode"] == "skip"
    assert refresh.plan_refresh(data, later, "pull_request")["mode"] == "build"


def test_invalid_or_future_observations_fail_instead_of_looking_fresh():
    data = ledger()
    data["capturedAt"] = (NOW + timedelta(minutes=3)).isoformat()
    with pytest.raises(ValueError, match="future"):
        poll(data)
    data = ledger()
    data["through"] = "2026-11-05"
    with pytest.raises(ValueError, match="dated after"):
        poll(data)
    with pytest.raises(ValueError, match="timezone"):
        refresh.instant("2026-11-04T23:00:00")
    with pytest.raises(ValueError, match="schedule"):
        refresh.plan_refresh(ledger(), NOW, "schedule", "unknown")


def test_staggered_tipoffs_receive_a_refresh_in_the_hour_before_window_without_refetching_every_scan():
    tips = [refresh.instant(value) for value in ["2026-11-04T23:30:00Z", "2026-11-05T00:00:00Z", "2026-11-05T01:00:00Z", "2026-11-05T03:00:00Z", "2026-11-05T05:30:00Z"]]
    data = ledger()
    data["capturedAt"] = "2026-11-04T21:00:00Z"
    data["games"] = [{"id": str(i), "startsAt": tip.isoformat(), "status": "Scheduled", "firstHalfComplete": False} for i, tip in enumerate(tips)]
    clock = refresh.instant("2026-11-04T22:07:00Z")
    captures = []
    scans = 0
    while clock <= refresh.instant("2026-11-05T06:07:00Z"):
        for game, tip in zip(data["games"], tips):
            game["firstHalfComplete"] = clock >= tip + timedelta(minutes=45)
            game["status"] = "In Progress" if tip <= clock else "Scheduled"
        result = poll(data, clock)
        scans += 1
        if result["mode"] in {"markets", "full"}:
            captures.append(clock)
            data["capturedAt"] = clock.isoformat()
            data["through"] = result["date"]
        clock += timedelta(minutes=10)
    assert len(captures) < scans
    for tip in tips:
        assert any(timedelta(minutes=45) <= tip - captured <= timedelta(minutes=75) for captured in captures)
