import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatPeriod } from '../../app/format'
import { searchVenues } from './api'

// SCRUM-33: an Event Coordinator finds the venues that are free on an
// Approved or Planning event's date and times and large enough for its
// attendance (docs/design/ui-guidelines.md §7). The API reads the event's own
// values and decides every rule; this page only shows what it returns. The
// location is an optional text filter, matched exactly by the API, and an
// empty one applies no restriction.
export default function VenueSearchPage() {
  const { id } = useParams()
  // What is typed is not applied until Apply, so typing never searches.
  const [typed, setTyped] = useState('')
  const [location, setLocation] = useState('')
  const [result, setResult] = useState(null)
  const [banner, setBanner] = useState(null)

  // Keyed to the event and the applied location: a reply for a search the user
  // has since replaced can arrive after the current one, so a stale reply is
  // ignored (docs/design/frontend.md section 7).
  useEffect(() => {
    let active = true
    searchVenues(id, location)
      .then((data) => {
        if (active) {
          setResult(data)
          setBanner(null)
        }
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
    return () => {
      active = false
    }
  }, [id, location])

  const handleApply = (event) => {
    event.preventDefault()
    setLocation(typed)
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to={`/requests/${id}`} className="back-link" data-testid="venue-search-back-link">
          Back to Request
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="venue-search-title">
            Search venues
          </h1>
        </div>
      </div>

      {banner && (
        <p role="alert" className="banner-error" data-testid="venue-search-banner">
          {banner}
        </p>
      )}

      {result && (
        <>
          <div className="card">
            <dl className="detail-list">
              <div>
                <dt>Event</dt>
                <dd data-testid="venue-search-event-name">{result.event.name}</dd>
              </div>
              <div>
                <dt>Date and time</dt>
                <dd data-testid="venue-search-period">
                  {formatPeriod(result.event.date, result.event.start_time, result.event.end_time)}
                </dd>
              </div>
              <div>
                <dt>Expected attendance</dt>
                <dd data-testid="venue-search-attendance">{result.event.attendance}</dd>
              </div>
            </dl>
          </div>

          <form className="card form-card space-y-4" onSubmit={handleApply} noValidate>
            <div>
              <label htmlFor="venue-search-location" className="label">
                Location
              </label>
              <input
                id="venue-search-location"
                type="text"
                className="input"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                data-testid="venue-search-location-input"
              />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" data-testid="venue-search-apply-button">
                Apply
              </button>
            </div>
          </form>

          {result.venues.length === 0 ? (
            <div className="card">
              <p className="empty-state" data-testid="venue-search-empty">
                No venues match this search.
              </p>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Location</th>
                      <th>Maximum capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.venues.map((venue) => (
                      <tr key={venue.id} data-testid={`venue-search-row-${venue.id}`}>
                        <td>
                          <Link to={`/venues/${venue.id}`} data-testid={`venue-search-name-${venue.id}`}>
                            {venue.name}
                          </Link>
                        </td>
                        <td data-testid={`venue-search-location-${venue.id}`}>{venue.location}</td>
                        <td data-testid={`venue-search-capacity-${venue.id}`}>{venue.max_capacity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
