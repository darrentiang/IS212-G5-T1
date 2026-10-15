import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { STATUS, formatPeriod } from '../../app/format'
import { getVenueOptions, searchVenues } from './api'
import Banner from '../../app/Banner'
import { useAuth } from '../../app/auth'
import { useReveal } from '../../app/reveal'

// The test id of one checkbox is the option's name in kebab-case
// (docs/design/ui-guidelines.md §5).
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

// No filter selected: the search is then the SCRUM-33 search as it stands.
const NO_FILTERS = { location: '', accessibilityFeatures: [], layout: '', facilities: [] }

// SCRUM-33: an Event Coordinator finds the venues that are free on an
// Approved or Planning event's date and times and large enough for its
// attendance (docs/design/ui-guidelines.md §7). The API reads the event's own
// values and decides every rule; this page only shows what it returns. The
// location is an optional text filter, matched exactly by the API, and an
// empty one applies no restriction.
// SCRUM-34: the coordinator may also tick accessibility features; a venue is
// shown only if it records every one ticked.
// SCRUM-35: and choose one room layout and tick facilities; a venue is shown
// only if it supports that layout and records every facility ticked.
// Nothing is chosen at first, and the event's own requirements are never chosen
// for the coordinator. One Apply sends every filter together, so clearing one is
// emptying it and applying again: only that restriction goes.
// SCRUM-82 AC6: each result offers Request booking, which opens the booking page
// with that venue chosen, and Place hold, which opens the request page's Place
// hold form with that venue chosen. Each is shown by the same rule as the
// matching button in the request page's Venues section; the API still decides.
export default function VenueSearchPage() {
  const { id } = useParams()
  const { can, account } = useAuth() ?? {}
  // What is typed or ticked (draft) is not applied until Apply, so editing never searches.
  const [draft, setDraft] = useState(NO_FILTERS)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [options, setOptions] = useState({ layouts: [], facilities: [], accessibility_features: [] })
  const [result, setResult] = useState(null)
  const [banner, setBanner] = useState(null)
  // How many times Apply was pressed, and which press the shown results
  // answer: the results an Apply brings are scrolled into view, focus staying
  // on Apply; the first search, on opening the page, scrolls nothing
  // (ui-guidelines.md §13).
  const applied = useRef(0)
  const [answered, setAnswered] = useState(0)
  const resultsRef = useReveal(answered || null, null)

  // The recognised options are fetched once; nothing here can race another fetch.
  useEffect(() => {
    getVenueOptions()
      .then((data) => setOptions(data))
      .catch((error) => setBanner(error.message))
  }, [])

  // Keyed to the event and the applied filters: a reply for a search the user
  // has since replaced can arrive after the current one, so a stale reply is
  // ignored (docs/design/frontend.md section 7).
  useEffect(() => {
    let active = true
    searchVenues(id, filters)
      .then((data) => {
        if (active) {
          setResult(data)
          setBanner(null)
          setAnswered(applied.current)
        }
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
    return () => {
      active = false
    }
  }, [id, filters])

  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }))

  const toggle = (field, name) =>
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(name)
        ? current[field].filter((chosen) => chosen !== name)
        : [...current[field], name],
    }))

  const handleApply = (event) => {
    event.preventDefault()
    applied.current += 1
    setFilters(draft)
  }

  // SCRUM-82: Request venue booking's rule (bookings.edit, event Approved or
  // Planning) and Place hold's (also the event's assigned coordinator).
  const open = [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(result?.event.status)
  const canRequest = Boolean(can?.('bookings.edit')) && open
  const canHold = canRequest && result.event.assigned_coordinator === account?.username
  const hasActions = canRequest

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

      <Banner page="venue-search" error={banner} onDismiss={() => setBanner(null)} />

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
                value={draft.location}
                onChange={(event) => setField('location', event.target.value)}
                data-testid="venue-search-location-input"
              />
            </div>
            <div>
              <label htmlFor="venue-search-layout" className="label">
                Room layout
              </label>
              <select
                id="venue-search-layout"
                className="input"
                value={draft.layout}
                onChange={(event) => setField('layout', event.target.value)}
                data-testid="venue-search-layout-input"
              >
                <option value="">None</option>
                {options.layouts.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="label">Facilities</legend>
              {options.facilities.map((option) => (
                <label key={option} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={draft.facilities.includes(option)}
                    onChange={() => toggle('facilities', option)}
                    data-testid={`venue-search-facilities-${kebab(option)}-input`}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="label">Accessibility features</legend>
              {options.accessibility_features.map((option) => (
                <label key={option} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={draft.accessibilityFeatures.includes(option)}
                    onChange={() => toggle('accessibilityFeatures', option)}
                    data-testid={`venue-search-accessibility-features-${kebab(option)}-input`}
                  />
                  {option}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" data-testid="venue-search-apply-button">
                Apply
              </button>
            </div>
          </form>

          <div ref={resultsRef}>
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
                        {hasActions && <th>Action</th>}
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
                          {hasActions && (
                            <td>
                              <div className="flex flex-wrap gap-2">
                                {canRequest && (
                                  <Link
                                    to={`/requests/${id}/bookings/new?venue=${venue.id}`}
                                    className="btn btn-primary"
                                    data-testid={`venue-search-request-booking-button-${venue.id}`}
                                  >
                                    Request booking
                                  </Link>
                                )}
                                {canHold && (
                                  <Link
                                    to={`/requests/${id}?hold=${venue.id}`}
                                    className="btn btn-secondary"
                                    data-testid={`venue-search-place-hold-button-${venue.id}`}
                                  >
                                    Place hold
                                  </Link>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
