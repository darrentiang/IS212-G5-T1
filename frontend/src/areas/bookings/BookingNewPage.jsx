import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatDateTimePeriod, formatPeriod, formatTime } from '../../app/format'
import { checkVenue, listVenues, raiseBooking } from './api'
import Banner from '../../app/Banner'

// SCRUM-42: one line per mismatch, with the values AC3 names. The test id
// suffix is the warning's type, plus the missing option for a named one
// (docs/design/ui-guidelines.md §7). SCRUM-38 AC7: one line per approved
// booking or block already holding the venue over the event's period, keyed
// by its id, since a venue may have several. SCRUM-84 AC4: one line per other
// event's Held hold, after the approved bookings, keyed by the hold's id.
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')
const hours = (warning) => `${formatTime(warning.opening_time)} to ${formatTime(warning.closing_time)}`

const WARNINGS = {
  capacity: {
    key: () => 'capacity',
    text: (w) => `Expected attendance ${w.attendance} is above the venue's maximum capacity of ${w.max_capacity}.`,
  },
  start_time: {
    key: () => 'start-time',
    text: (w) => `Start time ${formatTime(w.start_time)} is outside the venue's operating hours, ${hours(w)}.`,
  },
  end_time: {
    key: () => 'end-time',
    text: (w) => `End time ${formatTime(w.end_time)} is outside the venue's operating hours, ${hours(w)}.`,
  },
  layout: {
    key: (w) => `layout-${kebab(w.name)}`,
    text: (w) => `The venue does not record the ${w.name} layout.`,
  },
  facility: {
    key: (w) => `facility-${kebab(w.name)}`,
    text: (w) => `The venue does not record the facility ${w.name}.`,
  },
  accessibility_feature: {
    key: (w) => `accessibility-feature-${kebab(w.name)}`,
    text: (w) => `The venue does not record the accessibility feature ${w.name}.`,
  },
  approved_booking: {
    key: (w) => `approved-booking-${w.id}`,
    text: (w) =>
      `The venue already holds an approved booking for ${w.event_request_name}, ${formatPeriod(w.date, w.start_time, w.end_time)}.`,
  },
  hold: {
    key: (w) => `hold-${w.id}`,
    text: (w) => `The venue is held for ${w.event_request_name}, ${formatPeriod(w.date, w.start_time, w.end_time)}.`,
  },
  block: {
    key: (w) => `block-${w.id}`,
    text: (w) => `The venue is blocked ${formatDateTimePeriod(w.start, w.end)} (${w.reason}).`,
  },
}

// SCRUM-36: an Event Coordinator raises a booking request for one venue
// against one event (docs/design/state-model.md, '— -> Requested'). Lands on
// the venue's own page, where the new request appears in Booking requests
// (ui-guidelines.md §7) — this page has no detail view of its own.
// SCRUM-42: choosing or changing the venue checks it against the event and
// shows a warning per mismatch above Raise; the coordinator may still raise,
// or go back to the request (the back link is the Cancel, AC5).
export default function BookingNewPage() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const [venues, setVenues] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [venueId, setVenueId] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [warnings, setWarnings] = useState([])

  useEffect(() => {
    listVenues()
      // A retired venue cannot be booked (AC10): hide it from the picker
      // rather than let the user pick it only to be refused.
      .then((data) => setVenues(data.filter((venue) => venue.is_active)))
      .catch((error) => setBanner(error.message))
      .finally(() => setLoading(false))
  }, [])

  // Keyed to the chosen venue: a reply for a venue the user has moved away
  // from can arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md §7).
  useEffect(() => {
    if (!venueId) return undefined
    let active = true
    checkVenue(requestId, venueId)
      .then((data) => {
        if (active) setWarnings(data)
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
    return () => {
      active = false
    }
  }, [requestId, venueId])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!venueId) {
      setFieldError('Choose a venue.')
      setBanner(null)
      return
    }
    setFieldError(null)

    setSubmitting(true)
    try {
      await raiseBooking(requestId, venueId)
      navigate(`/venues/${venueId}`, { state: { banner: 'Venue booking requested' } })
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to={`/requests/${requestId}`} className="back-link" data-testid="booking-new-back-link">
          Back to Request
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="booking-new-title">
            Request venue booking
          </h1>
        </div>
      </div>

      <Banner page="booking-new" error={banner} onDismiss={() => setBanner(null)} />

      {!loading && (
        <form className="card form-card space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="booking-new-venue" className="label">
              Venue *
            </label>
            <select
              id="booking-new-venue"
              aria-required="true"
              className="input"
              value={venueId}
              onChange={(event) => {
                // Warnings belong to one venue: a new choice clears them.
                setWarnings([])
                setVenueId(event.target.value)
              }}
              data-testid="booking-new-venue-input"
            >
              <option value="">Select a venue</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
            {fieldError && (
              <p className="field-error" data-testid="booking-new-venue-error">
                {fieldError}
              </p>
            )}
          </div>

          {warnings.length > 0 && (
            <div className="warning-list" aria-live="polite" data-testid="booking-new-warnings">
              <p>This venue may not suit the event</p>
              <ul className="space-y-1">
                {warnings.map((warning) => {
                  const kind = WARNINGS[warning.type]
                  const key = kind.key(warning)
                  return (
                    <li key={key} data-testid={`booking-new-warning-${key}`}>
                      {kind.text(warning)}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="booking-new-raise-button"
            >
              Raise
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
