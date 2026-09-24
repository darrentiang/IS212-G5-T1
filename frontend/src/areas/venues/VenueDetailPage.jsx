import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { formatTime } from '../../app/format'
import { getVenue } from './api'

// Operating hours are two values, each through formatTime: format.js has no
// function for a time range without a date (docs/design/ui-guidelines.md §9).
const time = (value) => (value ? formatTime(value) : 'None')
const list = (values) => (values && values.length > 0 ? values.join(', ') : 'None')

// SCRUM-31: every field recorded for one venue, or the API refusal.
export default function VenueDetailPage() {
  const { id } = useParams()
  const routerLocation = useLocation()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  // The success banner shows on the page the user lands on after saving
  // (docs/design/ui-guidelines.md §4).
  const success = routerLocation.state?.banner ?? null

  // Keyed to id: a reply for the venue the user has left can
  // arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md section 7).
  useEffect(() => {
    let active = true
    getVenue(id)
      .then((data) => {
        if (active) setRow(data)
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
  }, [id])

  return (
    <div className="space-y-4">
      <Link to="/venues" className="text-blue-700 hover:underline text-sm" data-testid="venue-detail-back-link">
        Back to Venues
      </Link>

      <h1 className="text-xl font-semibold text-gray-900" data-testid="venue-detail-title">
        Venue
      </h1>

      {banner ? (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="venue-detail-banner">
          {banner}
        </p>
      ) : (
        success && (
          <p role="status" className="border border-green-300 bg-green-50 text-green-800 rounded px-3 py-2 text-sm" data-testid="venue-detail-banner">
            {success}
          </p>
        )
      )}

      {loading || banner || !row ? null : (
        <dl className="space-y-2 text-sm" data-testid="venue-detail-fields">
          <div>
            <dt className="font-medium text-gray-700">Name</dt>
            <dd data-testid="venue-detail-name">{row.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Location</dt>
            <dd data-testid="venue-detail-location">{row.location}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Maximum capacity</dt>
            <dd data-testid="venue-detail-max-capacity">{row.max_capacity}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Opening time</dt>
            <dd data-testid="venue-detail-opening-time">{time(row.opening_time)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Closing time</dt>
            <dd data-testid="venue-detail-closing-time">{time(row.closing_time)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Facilities</dt>
            <dd data-testid="venue-detail-facilities">{list(row.facilities)}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Accessibility features</dt>
            <dd data-testid="venue-detail-accessibility-features">{list(row.accessibility_features)}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
