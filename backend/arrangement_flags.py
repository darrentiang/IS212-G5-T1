"""SCRUM-61: flags on an event's arrangements, derived at every read and never stored.

Too small (AC1, AC2): the event's expected attendance is more than the venue's
maximum capacity, on an Approved booking, a Requested booking request or a Held
hold; each venue on its own, equal to the capacity fits (the same rule as the
SCRUM-42 suitability warning).

Timing mismatch (AC6): an Approved booking, a Requested booking request or a
Reserved equipment reservation whose date, start or end time is not the
event's. A hold keeps no period of its own: it always covers the event's
current one, and SCRUM-47 refuses a change to the date or times while it is
Held, so a hold is never out of step.

Because nothing is stored, a flag goes by itself (AC5) once the attendance or
the period matches again, or the arrangement leaves those statuses (cancelled,
withdrawn, rejected, released, expired). A flag never changes a status (AC4).
"""

ACTIVE_BOOKING_STATUSES = ("Requested", "Approved")


def _too_small(event, venue):
    return event.attendance is not None and event.attendance > venue.max_capacity


def _out_of_step(row, event):
    return (row.date, row.start_time, row.end_time) != (event.date, event.start_time, event.end_time)


def booking_too_small(booking):
    return booking.status in ACTIVE_BOOKING_STATUSES and _too_small(booking.event_request, booking.venue)


def booking_timing_mismatch(booking):
    return booking.status in ACTIVE_BOOKING_STATUSES and _out_of_step(booking, booking.event_request)


def hold_too_small(hold):
    return hold.status == "Held" and _too_small(hold.event_request, hold.venue)


def reservation_timing_mismatch(reservation, event):
    return reservation.status == "Reserved" and _out_of_step(reservation, event)
