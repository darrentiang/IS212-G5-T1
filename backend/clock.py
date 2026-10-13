"""The current time, read in one place — SCRUM-79 (End or Remove a Venue Block).

Block times are naive Singapore local time (models.VenueBlock), while servers
and CI may run in UTC. Every rule that compares against "now" calls
now_local() through this module (`clock.now_local()`), so a test can
monkeypatch it instead of sleeping (pytest-standard: a controllable clock).

Singapore keeps UTC+8 all year, with no daylight saving, so a fixed offset is
exact. ZoneInfo is not used: Windows has no time zone database without the
tzdata package.

SCRUM-49 adds an optional file override for functional tests: when the
CONNECTSPHERE_CLOCK_FILE environment variable is set and that file exists,
now_local() returns the timestamp it holds (naive, to the minute) instead of
the real time. The environment variable is set only by functional-test
configuration; without it, behaviour is exactly as it always was. The file
being absent means "no override now" — that is how a test restores real
time. The file being present but unparsable is an error, never a silent
fall back to real time: a test that asked for a pinned clock must not run
on the wrong one.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

SINGAPORE = timezone(timedelta(hours=8))


def _override():
    """The pinned time from CONNECTSPHERE_CLOCK_FILE, or None when unpinned."""
    path = os.environ.get("CONNECTSPHERE_CLOCK_FILE")
    if not path:
        return None
    try:
        text = Path(path).read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None  # absent file = override not active (the restore path)
    try:
        pinned = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(
            f"CONNECTSPHERE_CLOCK_FILE ({path}) does not hold an ISO timestamp: "
            f"{text!r}"
        ) from None
    if pinned.tzinfo is not None:
        raise ValueError(
            f"CONNECTSPHERE_CLOCK_FILE ({path}) must be a naive local timestamp, "
            f"got {text!r}"
        )
    return pinned.replace(second=0, microsecond=0)


def now_local():
    """The current Singapore time, naive, to the minute: blocks are kept to the minute."""
    pinned = _override()
    if pinned is not None:
        return pinned
    return datetime.now(timezone.utc).astimezone(SINGAPORE).replace(
        tzinfo=None, second=0, microsecond=0
    )
