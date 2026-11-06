"""Provider-declared venue and game classification; no inferred home crowd share."""
import re


def event_context(event):
    competition = event["competitions"][0]
    venue = competition.get("venue") or {}
    notes = " | ".join(note.get("headline", "") for note in competition.get("notes", []))
    conference = competition.get("conferenceCompetition")
    neutral = competition.get("neutralSite")
    teams = competition.get("competitors", [])
    conference_ids = [team.get("team", {}).get("conferenceId") for team in teams]
    same_conference = len(conference_ids) == 2 and conference_ids[0] is not None and conference_ids[0] == conference_ids[1]
    if re.search(r"NCAA.*Championship|\bNIT\b|College Basketball (?:Invitational|Crown)|\bCBI\b|\bCIT\b", notes, re.I):
        kind = "national_postseason"
    elif re.search(r"\btournament\b", notes, re.I) and (conference is True or same_conference):
        kind = "conference_tournament"
    elif re.search(r"\btournament\b|\binvitational\b|Battle 4 Atlantis", notes, re.I):
        kind = "other_tournament"
    elif event.get("season", {}).get("type") == 3:
        kind = "postseason_unknown"
    elif conference is True:
        kind = "conference_regular"
    elif conference is False:
        kind = "nonconference_regular"
    else:
        kind = "unknown"
    address = venue.get("address") or {}
    venue_id = str(venue["id"]) if venue.get("id") is not None else None
    name = venue.get("fullName")
    key = f"id:{venue_id}" if venue_id else (f"name:{name}|{address.get('city', '')}|{address.get('state', '')}" if name else None)
    return {"neutralSite": neutral if type(neutral) is bool else None,
            "conferenceGame": conference if type(conference) is bool else None,
            "matchupType": kind, "eventLabel": notes or None,
            "venueId": venue_id, "venueKey": key, "venueName": name,
            "city": address.get("city"), "state": address.get("state")}
