import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatDate, formatDateTimePeriod, statusBadgeClass, STATUS } from '../../app/format'
import { getVenue, listVenueBlocks, listVenueBookings } from './api'

// Bookings a Requested or an Approved booking never shows (SCRUM-39 AC5): a
// Rejected or Withdrawn request no longer holds or threatens to hold the venue.
const SHOWN_BOOKING_STATUSES = [STATUS.BOOKING.REQUESTED, STATUS.BOOKING.APPROVED]

// '2026-10-09T14:30' (occupied_start/occupied_end, a block's start/end) is
// already local, naive and sortable as a string or a Date: no timezone
// conversion, the same values ui-guidelines.md §9 says are shown as sent.
const toDate = (wireValue) => new Date(wireValue)
const pad = (value) => String(value).padStart(2, '0')
const toISODate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
// The reverse of toDate: a local Date back to the naive wire string
// ('YYYY-MM-DDTHH:MM'), never through toISOString, which converts to UTC.
const toWire = (date) => `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`

// The Monday, 00:00, of the week containing `date` (team decision, 09-10-2026:
// no document had fixed a week's start day before this story).
function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = start.getDay()
  const toMonday = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + toMonday)
  return start
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

// The displayed range is [start, end): end is exclusive, so a period that
// starts exactly at it belongs to the next range, not this one.
function rangeFor(mode, anchor) {
  if (mode === 'month') {
    const start = startOfMonth(anchor)
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) }
  }
  const start = startOfWeek(anchor)
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) }
}

function shiftAnchor(mode, anchor, direction) {
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
  const shifted = new Date(anchor)
  shifted.setDate(shifted.getDate() + direction * 7)
  return shifted
}

// One Date per day in [start, end), so a free day still gets its own row
// (ui-guidelines.md §7: judging dates means seeing the open ones too).
function daysBetween(start, end) {
  const days = []
  for (let day = new Date(start); day < end; day.setDate(day.getDate() + 1)) {
    days.push(new Date(day))
  }
  return days
}

// Two periods overlap when each starts before the other ends (the same rule
// as occupancy.py, applied here only to decide what the calendar shows).
const overlaps = (firstStart, firstEnd, secondStart, secondEnd) =>
  firstStart < secondEnd && secondStart < firstEnd

// SCRUM-39 AC4 widens only an Approved booking's displayed period; a
// Requested booking has not yet earned the buffer, since it does not yet
// hold the venue (occupancy.py never widens anything but an Approved
// booking's occupied period either).
function bookingPeriod(booking) {
  return booking.status === STATUS.BOOKING.APPROVED
    ? [toDate(booking.occupied_start), toDate(booking.occupied_end)]
    : [new Date(`${booking.date}T${booking.start_time}`), new Date(`${booking.date}T${booking.end_time}`)]
}

const STATUS_LABEL = {
  [STATUS.BOOKING.APPROVED]: 'Approved',
  [STATUS.BOOKING.REQUESTED]: 'Pending',
}

export default function VenueAvailabilityPage() {
  const { id } = useParams()
  const [venue, setVenue] = useState(null)
  const [bookings, setBookings] = useState([])
  const [blocks, setBlocks] = useState([])
  const [banner, setBanner] = useState(null)
  const [mode, setMode] = useState('week')
  // Today, read once from the browser's own clock: a cosmetic starting point
  // only (ui-guidelines.md §7), never recomputed as the clock ticks while the
  // page is open.
  const [anchor, setAnchor] = useState(() => new Date())

  // Keyed to the venue id: a reply for a venue the user has since left can
  // arrive after the current one (docs/design/frontend.md §7).
  useEffect(() => {
    let active = true
    Promise.all([getVenue(id), listVenueBookings(id), listVenueBlocks(id)])
      .then(([venueRow, bookingRows, blockRows]) => {
        if (active) {
          setVenue(venueRow)
          setBookings(bookingRows)
          setBlocks(blockRows)
        }
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
    return () => {
      active = false
    }
  }, [id])

  const { start, end } = rangeFor(mode, anchor)

  const bookingEntries = bookings
    .filter((booking) => SHOWN_BOOKING_STATUSES.includes(booking.status))
    .map((booking) => {
      const [periodStart, periodEnd] = bookingPeriod(booking)
      return { kind: 'booking', id: booking.id, periodStart, periodEnd, name: booking.event_request_name, status: booking.status }
    })
  const blockEntries = blocks.map((block) => ({
    kind: 'block',
    id: block.id,
    periodStart: toDate(block.start),
    periodEnd: toDate(block.end),
    name: block.reason,
    status: null,
  }))

  const allEntries = [...bookingEntries, ...blockEntries]
  // One group per displayed day; an entry appears in every day it overlaps,
  // in full, the same way a multi-day event appears on every day of a real
  // calendar (ui-guidelines.md §7).
  const days = daysBetween(start, end).map((day) => {
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
    const dayEntries = allEntries
      .filter((entry) => overlaps(entry.periodStart, entry.periodEnd, day, dayEnd))
      .sort((a, b) => a.periodStart - b.periodStart || a.id - b.id)
    return { date: day, entries: dayEntries }
  })

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to={`/venues/${id}`} className="back-link" data-testid="venue-availability-back-link">
          Back to Venue
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="venue-availability-title">
            {venue ? venue.name : 'Venue'}
          </h1>
        </div>
      </div>

      {banner && (
        <p role="alert" className="banner-error" data-testid="venue-availability-banner">
          {banner}
        </p>
      )}

      {venue && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('week')}
                className={mode === 'week' ? 'btn btn-primary' : 'btn btn-secondary'}
                data-testid="venue-availability-week-button"
              >
                Week
              </button>
              <button
                type="button"
                onClick={() => setMode('month')}
                className={mode === 'month' ? 'btn btn-primary' : 'btn btn-secondary'}
                data-testid="venue-availability-month-button"
              >
                Month
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAnchor((current) => shiftAnchor(mode, current, -1))}
                className="btn btn-secondary"
                data-testid="venue-availability-prev-button"
              >
                Previous
              </button>
              <span data-testid="venue-availability-range">
                {formatDate(toISODate(start))} to {formatDate(toISODate(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)))}
              </span>
              <button
                type="button"
                onClick={() => setAnchor((current) => shiftAnchor(mode, current, 1))}
                className="btn btn-secondary"
                data-testid="venue-availability-next-button"
              >
                Next
              </button>
            </div>
          </div>

          <div className="card">
            <dl className="detail-list">
              {days.map(({ date, entries: dayEntries }) => {
                const dateKey = toISODate(date)
                return (
                  <div key={dateKey} data-testid={`venue-availability-day-${dateKey}`}>
                    <dt data-testid={`venue-availability-day-heading-${dateKey}`}>{formatDate(dateKey)}</dt>
                    <dd>
                      {dayEntries.length === 0 ? (
                        <span className="subtitle" data-testid={`venue-availability-day-empty-${dateKey}`}>
                          Free
                        </span>
                      ) : (
                        <ul className="space-y-2">
                          {dayEntries.map((entry) => {
                            // An entry spanning more than one displayed day repeats, once per
                            // day (Month can show two of its days at once), so the day it is
                            // under is part of its id to keep every id unique on the page.
                            const entryKey = `${entry.kind}-${entry.id}-${dateKey}`
                            return (
                              <li
                                key={entryKey}
                                data-testid={`venue-availability-entry-row-${entryKey}`}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <span
                                  data-testid={`venue-availability-entry-status-${entryKey}`}
                                  className={entry.kind === 'block' ? 'badge badge-neutral' : statusBadgeClass(entry.status)}
                                >
                                  {entry.kind === 'block' ? 'Block' : STATUS_LABEL[entry.status]}
                                </span>
                                <span data-testid={`venue-availability-entry-period-${entryKey}`}>
                                  {formatDateTimePeriod(toWire(entry.periodStart), toWire(entry.periodEnd))}
                                </span>
                                <span data-testid={`venue-availability-entry-name-${entryKey}`}>{entry.name}</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </>
      )}
    </div>
  )
}
