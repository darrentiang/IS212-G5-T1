"""Simultaneous equipment commitments — SCRUM-49 (state-model.md v1.7).

One window-parameterized calculation, shared with SCRUM-50 (availability) and
SCRUM-51 (reserving): ``peak_units(type, window_start, window_end=None)``.
SCRUM-49's stock-reduction guard calls it with window_start=clock.now_local()
and window_end=None — the peak across ongoing and future commitments. SCRUM-50
and SCRUM-51 pass the event's own period instead, so commitments outside that
window never count (docs/design/state-model.md, "Equipment reservation").

Only a reservation in status "Reserved" commits; "Released" and past periods
never do. Periods are half-open [start, end): one that only touches the window
edge does not overlap it, and where a period ends exactly where another
begins, the ending is applied first — the same boundary rule as venue
occupancy (occupancy.py, state-model.md's conflict definition).
"""

from datetime import datetime

from db import db
from models import EquipmentType, Reservation


def _period(reservation):
    """The reservation's stored period as (start, end) naive datetimes."""
    start = datetime.strptime(
        f"{reservation.date} {reservation.start_time}", "%Y-%m-%d %H:%M"
    )
    end = datetime.strptime(
        f"{reservation.date} {reservation.end_time}", "%Y-%m-%d %H:%M"
    )
    return start, end


def peak_units(equipment_type_id, window_start, window_end=None):
    """Maximum units of this type simultaneously Reserved inside the window.

    The window is half-open [window_start, window_end); window_end None means
    unbounded into the future. Returns 0 when nothing commits inside it.

    Raises ValueError if a stored period is inverted or malformed: every
    creation path validates the period (seed.py's fixture import now, SCRUM-51's
    workflow later), so a bad row means broken data, not a number to guess.
    """
    equipment = db.session.get(EquipmentType, equipment_type_id)
    if equipment is None:
        return 0

    reservations = (
        db.session.query(Reservation)
        .filter_by(equipment_type_id=equipment.id, status="Reserved")
        .all()
    )

    # Commitments overlapping the window, with a start/end event inside it.
    active = 0
    events = []
    for reservation in reservations:
        start, end = _period(reservation)
        if end <= start:
            raise ValueError(
                f"reservation {reservation.id} has an inverted period "
                f"{reservation.date} {reservation.start_time}-{reservation.end_time}"
            )
        overlaps = end > window_start and (
            window_end is None or start < window_end
        )
        if not overlaps:
            continue
        if start <= window_start:
            active += reservation.quantity  # ongoing at the window's start
        else:
            events.append((start, reservation.quantity))
        if window_end is None or end < window_end:
            events.append((end, -reservation.quantity))

    # Ends before starts at an equal timestamp: touching periods do not stack.
    events.sort(key=lambda event: (event[0], 0 if event[1] < 0 else 1))

    peak = active
    running = active
    for _, delta in events:
        running += delta
        if running > peak:
            peak = running
    return peak
