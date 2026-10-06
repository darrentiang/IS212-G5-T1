"""The current time, read in one place — SCRUM-79 (End or Remove a Venue Block).

Block times are naive Singapore local time (models.VenueBlock), while servers
and CI may run in UTC. Every rule that compares against "now" calls
now_local() through this module (`clock.now_local()`), so a test can
monkeypatch it instead of sleeping (pytest-standard: a controllable clock).

Singapore keeps UTC+8 all year, with no daylight saving, so a fixed offset is
exact. ZoneInfo is not used: Windows has no time zone database without the
tzdata package.
"""

from datetime import datetime, timedelta, timezone

SINGAPORE = timezone(timedelta(hours=8))


def now_local():
    """The current Singapore time, naive, to the minute: blocks are kept to the minute."""
    return datetime.now(timezone.utc).astimezone(SINGAPORE).replace(
        tzinfo=None, second=0, microsecond=0
    )
