import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createVenue, getVenueOptions } from './api'
import Banner from '../../app/Banner'
import { useRevealError } from '../../app/reveal'

// The test id of one checkbox is the option's name in kebab-case
// (docs/design/ui-guidelines.md §5).
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

// SCRUM-31: add a venue. The page checks only that the required fields are
// filled; every other rule is the API's and shows in the banner
// (docs/design/ui-guidelines.md §5).
export default function VenueNewPage() {
  const navigate = useNavigate()

  const [options, setOptions] = useState({ facilities: [], accessibility_features: [] })
  // The form appears once the two fixed lists are in hand: a form offering no
  // facility to tick would be a form that cannot record one
  // (docs/design/ui-guidelines.md §3).
  const [ready, setReady] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('')
  const [openingTime, setOpeningTime] = useState('')
  const [closingTime, setClosingTime] = useState('')
  const [facilities, setFacilities] = useState([])
  const [accessibilityFeatures, setAccessibilityFeatures] = useState([])
  const [fieldErrors, setFieldErrors] = useState({})
  // A failed required-field check focuses the first field it names (ui-guidelines.md §13).
  const formRef = useRef(null)
  useRevealError(formRef, fieldErrors)
  const [banner, setBanner] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getVenueOptions()
      .then((data) => {
        setOptions(data)
        setReady(true)
      })
      .catch((error) => setBanner(error.message))
  }, [])

  function toggle(values, setValues, value) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const errors = {}
    if (!name.trim()) errors.name = 'Name is required'
    if (!location.trim()) errors.location = 'Location is required'
    if (!String(maxCapacity).trim()) errors['max-capacity'] = 'Maximum capacity is required'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setBanner(null)
      return
    }

    setSubmitting(true)
    setBanner(null)
    try {
      const venue = await createVenue({
        name: name.trim(),
        location: location.trim(),
        max_capacity: maxCapacity,
        opening_time: openingTime,
        closing_time: closingTime,
        facilities,
        accessibility_features: accessibilityFeatures,
      })
      navigate(`/venues/${venue.id}`, { state: { banner: 'Venue added' } })
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/venues" className="back-link" data-testid="venue-new-back-link">
          Back to Venues
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="venue-new-title">
            Add venue
          </h1>
        </div>
      </div>

      <Banner page="venue-new" error={banner} onDismiss={() => setBanner(null)} />

      {ready ? (
        <form ref={formRef} onSubmit={handleSubmit} noValidate className="card form-card space-y-4">
          <div>
            <label htmlFor="venue-new-name" className="label">
              Name *
            </label>
            <input
              id="venue-new-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-required="true"
              className="input"
              data-testid="venue-new-name-input"
            />
            {fieldErrors.name && (
              <p className="field-error" data-testid="venue-new-name-error">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="venue-new-location" className="label">
              Location *
            </label>
            <input
              id="venue-new-location"
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              aria-required="true"
              className="input"
              data-testid="venue-new-location-input"
            />
            {fieldErrors.location && (
              <p className="field-error" data-testid="venue-new-location-error">
                {fieldErrors.location}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="venue-new-max-capacity" className="label">
              Maximum capacity *
            </label>
            <input
              id="venue-new-max-capacity"
              type="number"
              value={maxCapacity}
              onChange={(event) => setMaxCapacity(event.target.value)}
              aria-required="true"
              className="input"
              data-testid="venue-new-max-capacity-input"
            />
            {fieldErrors['max-capacity'] && (
              <p className="field-error" data-testid="venue-new-max-capacity-error">
                {fieldErrors['max-capacity']}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="venue-new-opening-time" className="label">
              Opening time
            </label>
            <input
              id="venue-new-opening-time"
              type="time"
              value={openingTime}
              onChange={(event) => setOpeningTime(event.target.value)}
              className="input"
              data-testid="venue-new-opening-time-input"
            />
          </div>

          <div>
            <label htmlFor="venue-new-closing-time" className="label">
              Closing time
            </label>
            <input
              id="venue-new-closing-time"
              type="time"
              value={closingTime}
              onChange={(event) => setClosingTime(event.target.value)}
              className="input"
              data-testid="venue-new-closing-time-input"
            />
          </div>

          <fieldset>
            <legend className="label">Facilities</legend>
            {options.facilities.map((option) => (
              <label key={option} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={facilities.includes(option)}
                  onChange={() => toggle(facilities, setFacilities, option)}
                  data-testid={`venue-new-facilities-${kebab(option)}-input`}
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
                  checked={accessibilityFeatures.includes(option)}
                  onChange={() => toggle(accessibilityFeatures, setAccessibilityFeatures, option)}
                  data-testid={`venue-new-accessibility-features-${kebab(option)}-input`}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="venue-new-save-button"
            >
              Save
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
