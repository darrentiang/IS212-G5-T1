import { useState } from 'react'
import { useReveal } from '../../app/reveal'

// SCRUM-84: the Place hold form the assigned Event Coordinator opens from the
// top of the request page's Venues section (SCRUM-83, ui-guidelines.md §7).
// It owns its entries and the messages under its fields (§5), and sends
// nothing while one is empty; the page owns the API call and the banner.
// SCRUM-82 AC6: venueId, when given, is the venue already chosen.

const EMPTY = { venue_id: '', expiry_date: '', expiry_time: '' }

const REQUIRED = [
  ['venue_id', 'Choose a venue.'],
  ['expiry_date', 'Expiry date is required.'],
  ['expiry_time', 'Expiry time is required.'],
]

export default function PlaceHoldForm({ venues, venueId = '', submitting, onCancel, onPlace }) {
  // Mounted only while open, so every opening starts empty but for a chosen venue.
  const [values, setValues] = useState({ ...EMPTY, venue_id: venueId })
  const [errors, setErrors] = useState({})
  // Opens below the Venues section's buttons with its Venue focused (ui-guidelines.md §13).
  const formRef = useReveal(true)

  const setValue = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))

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
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="card form-card space-y-4" data-testid="request-detail-hold-form">
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
  )
}
