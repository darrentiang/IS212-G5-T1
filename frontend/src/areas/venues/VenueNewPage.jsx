import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { createVenue, getVenueOptions } from './api'

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
  const [banner, setBanner] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    getVenueOptions()
      .then((data) => {
        if (active) {
          setOptions(data)
          setReady(true)
        }
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
    return () => {
      active = false
    }
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
    <div className="space-y-4">
      <Link to="/venues" className="text-blue-700 hover:underline text-sm" data-testid="venue-new-back-link">
        Back to Venues
      </Link>

      <h1 className="text-xl font-semibold text-gray-900" data-testid="venue-new-title">
        Add venue
      </h1>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="venue-new-banner">
          {banner}
        </p>
      )}

      {ready ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-4 max-w-xl">
          <div className="space-y-1">
            <label htmlFor="venue-new-name" className="block text-sm text-gray-700">
              Name *
            </label>
            <input
              id="venue-new-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-required="true"
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="venue-new-name-input"
            />
            {fieldErrors.name && (
              <p className="text-sm text-red-700" data-testid="venue-new-name-error">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="venue-new-location" className="block text-sm text-gray-700">
              Location *
            </label>
            <input
              id="venue-new-location"
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              aria-required="true"
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="venue-new-location-input"
            />
            {fieldErrors.location && (
              <p className="text-sm text-red-700" data-testid="venue-new-location-error">
                {fieldErrors.location}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="venue-new-max-capacity" className="block text-sm text-gray-700">
              Maximum capacity *
            </label>
            <input
              id="venue-new-max-capacity"
              type="number"
              value={maxCapacity}
              onChange={(event) => setMaxCapacity(event.target.value)}
              aria-required="true"
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="venue-new-max-capacity-input"
            />
            {fieldErrors['max-capacity'] && (
              <p className="text-sm text-red-700" data-testid="venue-new-max-capacity-error">
                {fieldErrors['max-capacity']}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="venue-new-opening-time" className="block text-sm text-gray-700">
              Opening time
            </label>
            <input
              id="venue-new-opening-time"
              type="time"
              value={openingTime}
              onChange={(event) => setOpeningTime(event.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="venue-new-opening-time-input"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="venue-new-closing-time" className="block text-sm text-gray-700">
              Closing time
            </label>
            <input
              id="venue-new-closing-time"
              type="time"
              value={closingTime}
              onChange={(event) => setClosingTime(event.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="venue-new-closing-time-input"
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="block text-sm text-gray-700">Facilities</legend>
            {options.facilities.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-gray-700">
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

          <fieldset className="space-y-1">
            <legend className="block text-sm text-gray-700">Accessibility features</legend>
            {options.accessibility_features.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-gray-700">
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

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
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
