"""What holds a venue for a period — SCRUM-38 (Prevent Double-Booking of a
Venue), SCRUM-41 (Reserve Setup and Turnaround Time Around a Booking) and
SCRUM-84 (Place a Tentative Venue Hold).

The one overlap rule, in one place. Venue search (SCRUM-33), approving a venue
booking (SCRUM-38 AC1-AC6) and the booking page's warnings (SCRUM-38 AC7) all
ask venue_holders() what holds a venue, so they can never disagree.

Only a block, an Approved booking or a Held hold of the same venue holds it; a
booking that is Requested, Rejected or Withdrawn does not, and neither does a
Released hold. Periods that only touch at a boundary do not overlap. Times are
naive local, the same as a block's and as an event's stored date and times.

SCRUM-41: what a booking occupies is its own period widened by the venue's
setup and turnaround time (occupied_period), and what a proposed event would
occupy is the same widening of its period (buffered_period). Callers compare
one occupied period against another — search and warnings pass the candidate's
buffered_period, approval passes the booking's own occupied_period — so both
sides of any comparison widen together. Blocks are never widened themselves.

SCRUM-84: a Held hold takes the venue for the period its event would occupy
there (hold_period), derived like a booking's and never stored. The caller may
name the event that is asking: that event's own holds are never holders for it,
so its own search still lists the venue, its own booking page warns of nothing,
and approving its own request is not refused (AC6). Only holds are exempted;
the event's own Approved bookings still hold the venue. Whether a hold is still
holding is decided in is_holding alone, so SCRUM-85's expiry is one change.
"""

from datetime import datetime, timedelta
from typing import NamedTuple

# Only a booking in this status takes the venue's time (SCRUM-33 AC3, AC4).
HOLDING_BOOKING_STATUS = "Approved"

# Only a hold in this status takes the venue's time (SCRUM-84 AC4, AC7).
HOLDING_HOLD_STATUS = "Held"


class Holders(NamedTuple):
    """What holds a venue for a period, each list earliest start first."""

    bookings: list
    blocks: list
    holds: list

    def any(self):
        """True when anything at all holds the venue."""
        return bool(self.bookings or self.blocks or self.holds)


def moment(date_text, time_text):
    """A stored ISO date and HH:MM time as a naive local date-time."""
    return datetime.strptime(f"{date_text} {time_text}", "%Y-%m-%d %H:%M")


def overlaps(first_start, first_end, second_start, second_end):
    """Two periods overlap when each starts before the other ends: touching is not overlapping."""
    return first_start < second_end and second_start < first_end


def _shift(moment_value, minutes):
    """``moment_value`` plus ``minutes``, clamped to the date range Python represents.

    A recorded duration carries no maximum — the times endpoint accepts any
    non-negative whole number (venues/services.py) — so a very large setup or
    turnaround time can push a period past the first or last representable
    date. Raising there would turn one saved venue into a venue whose bookings,
    clashes, search and warnings cannot be read at all, so the period clamps to
    the edge instead: it stays as wide as the duration asks for, and every read
    keeps working. Clamping, rather than inventing a maximum duration no story
    has set, is the rule recorded in docs/design/state-model.md. The try also
    covers timedelta refusing a minute count too large to hold.
    """
    try:
        return moment_value + timedelta(minutes=minutes)
    except OverflowError:
        return datetime.max if minutes >= 0 else datetime.min


def buffered_period(venue, date_text, start_text, end_text):
    """The period an event at this venue would be occupied for (SCRUM-41 AC1).

    The event's own period widened by the venue's setup time before its start
    and its turnaround time after its end. Both are whole minutes (SCRUM-80)
    and default to 0, so a venue that records neither behaves as if both are
    zero (AC4). Dates roll over instead of clamping at midnight: an 00:15 event
    with 30 minutes of setup is occupied from the previous day. Nothing is
    stored — every read recomputes the period from the durations recorded now.
    An extreme duration clamps at the edges of the date range (_shift) instead
    of raising, so a saved venue can always still be read.
    """
    return (
        _shift(moment(date_text, start_text), -venue.setup_time),
        _shift(moment(date_text, end_text), venue.turnaround_time),
    )


def occupied_period(booking):
    """The period a booking takes its venue for (SCRUM-41 AC1).

    Its own period widened by its venue's setup and turnaround time, the same
    calculation buffered_period gives a proposed event, so the two sides of an
    approval are always widened together.
    """
    return buffered_period(booking.venue, booking.date, booking.start_time, booking.end_time)


def hold_period(hold):
    """The period a hold takes its venue for (SCRUM-84 AC1): its event's
    period widened by the venue's setup and turnaround time, as for a booking."""
    event = hold.event_request
    return buffered_period(hold.venue, event.date, event.start_time, event.end_time)


def is_holding(hold):
    """Whether a hold currently holds its venue (SCRUM-84 AC4, AC6, AC7).

    The one place this is decided: SCRUM-85 adds the expiry test here.
    """
    return hold.status == HOLDING_HOLD_STATUS


def venue_holders(venue, starts_at, ends_at, asking_event=None):
    """The venue's Approved bookings, blocks and Held holds that overlap the period.

    The period is the candidate's occupied one (SCRUM-41): search and warnings
    pass buffered_period(...), approval passes occupied_period(...). Each
    Approved booking is compared by its own occupied period; a block is
    compared by its recorded period and is never widened (SCRUM-41, blocks).
    A booking that is not Approved is never a holder, so a Requested booking
    being approved never clashes with itself.

    SCRUM-84: each Held hold is compared by its own derived period. A hold of
    asking_event, when given, is never a holder: an event never competes with
    its own hold (AC6).
    """
    bookings = [
        booking
        for booking in venue.booking_requests
        if booking.status == HOLDING_BOOKING_STATUS
        and overlaps(*occupied_period(booking), starts_at, ends_at)
    ]
    blocks = [
        block for block in venue.blocks if overlaps(block.starts_at, block.ends_at, starts_at, ends_at)
    ]
    holds = [
        hold
        for hold in venue.holds
        if is_holding(hold)
        and (asking_event is None or hold.event_request_id != asking_event.id)
        and overlaps(*hold_period(hold), starts_at, ends_at)
    ]
    bookings.sort(key=lambda booking: (occupied_period(booking)[0], booking.id))
    blocks.sort(key=lambda block: (block.starts_at, block.id))
    holds.sort(key=lambda hold: (hold_period(hold)[0], hold.id))
    return Holders(bookings=bookings, blocks=blocks, holds=holds)
