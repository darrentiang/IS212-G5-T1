import { useState } from 'react'
import { STATUS, formatDateTime, formatDateTimePeriod, formatPeriod, statusBadgeClass } from '../../app/format'

// SCRUM-84: the request page's Venue holds section, and the Place hold form
// the assigned Event Coordinator opens from it (ui-guidelines.md §7). The page
// owns the API calls and the banner; this section owns the form's entries and
// the messages under its fields (§5), and sends nothing while one is empty.

// The occupied period on one day reads like a booking's ('05 Dec 2026,
// 09:30–12:30'); one crossing midnight shows both ends in full.
function occupiedText(hold) {
  const [startDate, startTime] = hold.occupied_start.split('T')
  const [endDate, endTime] = hold.occupied_end.split('T')
  return startDate === endDate
    ? formatPeriod(startDate, startTime, endTime)
    : formatDateTimePeriod(hold.occupied_start, hold.occupied_end)
}

const EMPTY = { venue_id: '', expiry_date: '', expiry_time: '' }

const REQUIRED = [
  ['venue_id', 'Choose a venue.'],
  ['expiry_date', 'Expiry date is required.'],
  ['expiry_time', 'Expiry time is required.'],
]

export default function VenueHoldsSection({
  holds,
  canPlace,
  canRelease,
  formOpen,
  venues,
  submitting,
  onOpen,
  onCancel,
  onPlace,
  onRelease,
}) {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})

  const setValue = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))

  const open = () => {
    setValues(EMPTY)
    setErrors({})
    onOpen()
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const missing = REQUIRED.filter(([name]) => values[name].trim() === '')
    setErrors(Object.fromEntries(missing))
    if (missing.length > 0) return
    onPlace({ ...values, venue_id: Number(values.venue_id) })
  }

  const field = (name, label, control) => {
    // The venue's ids say venue, as its select's input id does (§5).
    const key = name === 'venue_id' ? 'venue' : name.replaceAll('_', '-')
    return (
      <div>
        <label htmlFor={`request-detail-hold-${key}`} className="label">
          {label} *
        </label>
        {control(`request-detail-hold-${key}`)}
        {errors[name] && (
          <p className="field-error" data-testid={`request-detail-hold-${key}-error`}>
            {errors[name]}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-4" data-testid="request-detail-holds">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Venue holds</h2>
        {canPlace && !formOpen && (
          <button
            type="button"
            disabled={submitting}
            onClick={open}
            className="btn btn-secondary"
            data-testid="request-detail-place-hold-button"
          >
            Place hold
          </button>
        )}
      </div>

      {canPlace && formOpen && (
        <form onSubmit={handleSubmit} noValidate className="card form-card space-y-4" data-testid="request-detail-hold-form">
          <h3 className="section-title">Place hold</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {field('venue_id', 'Venue', (id) => (
              <select
                id={id}
                aria-required="true"
                className="input"
                value={values.venue_id}
                onChange={(event) => setValue('venue_id', event.target.value)}
                data-testid="request-detail-hold-venue-input"
              >
                <option value="">Select a venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            ))}
            {field('expiry_date', 'Expiry date', (id) => (
              <input
                id={id}
                type="date"
                aria-required="true"
                className="input"
                value={values.expiry_date}
                onChange={(event) => setValue('expiry_date', event.target.value)}
                data-testid="request-detail-hold-expiry-date-input"
              />
            ))}
            {field('expiry_time', 'Expiry time', (id) => (
              <input
                id={id}
                type="time"
                aria-required="true"
                className="input"
                value={values.expiry_time}
                onChange={(event) => setValue('expiry_time', event.target.value)}
                data-testid="request-detail-hold-expiry-time-input"
              />
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onCancel}
              className="btn btn-secondary"
              data-testid="request-detail-hold-cancel-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="request-detail-hold-confirm-button"
            >
              Place hold
            </button>
          </div>
        </form>
      )}

      {holds.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-holds-empty">
            This event holds no venue.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Occupied period</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  {canRelease && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {holds.map((hold) => (
                  <tr key={hold.id} data-testid={`request-detail-hold-row-${hold.id}`}>
                    <td data-testid={`request-detail-hold-venue-${hold.id}`}>{hold.venue_name}</td>
                    <td data-testid={`request-detail-hold-period-${hold.id}`}>{occupiedText(hold)}</td>
                    <td data-testid={`request-detail-hold-expiry-${hold.id}`}>{formatDateTime(hold.expires_at)}</td>
                    <td data-testid={`request-detail-hold-status-${hold.id}`}>
                      <span className={statusBadgeClass(hold.status)}>{hold.status}</span>
                    </td>
                    {canRelease && (
                      <td>
                        {hold.status === STATUS.HOLD.HELD && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => onRelease(hold.id)}
                            className="btn btn-secondary"
                            data-testid={`request-detail-hold-release-button-${hold.id}`}
                          >
                            Release
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
