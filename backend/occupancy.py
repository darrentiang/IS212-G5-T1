"""What holds a venue for a period — SCRUM-38 (Prevent Double-Booking of a Venue).

The one overlap rule, in one place. Venue search (SCRUM-33), approving a venue
booking (SCRUM-38 AC1-AC6) and the booking page's warnings (SCRUM-38 AC7) all
ask venue_holders() what holds a venue, so they can never disagree.

Only a block or an Approved booking of the same venue holds it; a booking that
is Requested, Rejected or Withdrawn does not. Periods that only touch at a
boundary do not overlap. Times are naive local, the same as a block's and as
an event's stored date and times.

SCRUM-41 widens an approved booking's occupied period by the venue's setup and
turnaround time; occupied_period() is the only function it should need to
change. Approving compares the candidate booking's occupied_period() as well,
so both sides of an approval widen together; search and warnings pass the
event's plain period.
"""

from datetime import datetime
from typing import NamedTuple

# Only a booking in this status takes the venue's time (SCRUM-33 AC3, AC4).
HOLDING_BOOKING_STATUS = "Approved"


class Holders(NamedTuple):
    """What holds a venue for a period, each list earliest start first."""

    bookings: list
    blocks: list


def moment(date_text, time_text):
    """A stored ISO date and HH:MM time as a naive local date-time."""
    return datetime.strptime(f"{date_text} {time_text}", "%Y-%m-%d %H:%M")


def overlaps(first_start, first_end, second_start, second_end):
    """Two periods overlap when each starts before the other ends: touching is not overlapping."""
    return first_start < second_end and second_start < first_end


def occupied_period(booking):
    """The period a booking takes its venue for.

    SCRUM-41 adds setup and turnaround time to this period (SCRUM-33 AC3); it
    is not built yet, so for now the occupied period is the booking's own.
    """
    return moment(booking.date, booking.start_time), moment(booking.date, booking.end_time)


def venue_holders(venue, starts_at, ends_at):
    """The venue's Approved bookings and blocks that overlap the period.

    A booking that is not Approved is never a holder, so a Requested booking
    being approved never clashes with itself.
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
    bookings.sort(key=lambda booking: (occupied_period(booking)[0], booking.id))
    blocks.sort(key=lambda block: (block.starts_at, block.id))
    return Holders(bookings=bookings, blocks=blocks)
