import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { listVenues, raiseBooking } from './api'

// SCRUM-36: an Event Coordinator raises a booking request for one venue
// against one event (docs/design/state-model.md, '— -> Requested'). Lands on
// the venue's own page, where the new request appears in Booking requests
// (ui-guidelines.md §7) — this page has no detail view of its own.
export default function BookingNewPage() {
  const { requestId } = useParams()
  const navigate = useNavigate()
  const [venues, setVenues] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [venueId, setVenueId] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    listVenues()
      .then((data) => {
        // A retired venue cannot be booked (AC10): hide it from the picker
        // rather than let the user pick it only to be refused.
        if (active) setVenues(data.filter((venue) => venue.is_active))
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

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

      {banner && (
        <p role="alert" className="banner-error" data-testid="booking-new-banner">
          {banner}
        </p>
      )}

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
              onChange={(event) => setVenueId(event.target.value)}
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
