import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getRequestOptions, saveDraft, submitRequest } from './api'

// SCRUM-28: an Event Organiser submits a request directly (docs/design/state-model.md, '— -> Submitted').
// SCRUM-30: or saves it as a Draft (docs/design/state-model.md, '— -> Draft'); only the name is required to save.
// SCRUM-42: the Organiser may choose a required layout, facilities and
// accessibility features from the fixed lists; choosing none is allowed.
const FIELDS = [
  { name: 'name', label: 'Event name', type: 'text' },
  { name: 'purpose', label: 'Purpose', type: 'text' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'start_time', label: 'Start time', type: 'time' },
  { name: 'end_time', label: 'End time', type: 'time' },
  { name: 'attendance', label: 'Expected attendance', type: 'number' },
  { name: 'venue_requirements', label: 'Venue requirements', type: 'textarea' },
  { name: 'accessibility_needs', label: 'Accessibility needs', type: 'textarea' },
  { name: 'equipment_requirements', label: 'Equipment requirements', type: 'textarea' },
  { name: 'registration_needs', label: 'Registration needs', type: 'textarea' },
]

// Short fields share a row of three from tablet up; every other field takes
// the whole row (docs/design/visual-style.md, Form card).
const SHORT = new Set(['date', 'start_time', 'end_time', 'attendance'])

const EMPTY = Object.fromEntries(FIELDS.map((field) => [field.name, '']))

// The test id of one checkbox is the option's name in kebab-case
// (docs/design/ui-guidelines.md §5).
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

const toggle = (values, value) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

export default function RequestNewPage() {
  const navigate = useNavigate()
  const [values, setValues] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [banner, setBanner] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [options, setOptions] = useState({ layouts: [], facilities: [], accessibility_features: [] })
  const [layout, setLayout] = useState('')
  const [facilities, setFacilities] = useState([])
  const [accessibilityFeatures, setAccessibilityFeatures] = useState([])

  // The choices are optional, so a failure to load the lists leaves the form
  // usable with none to choose; the refusal shows in the banner.
  useEffect(() => {
    getRequestOptions()
      .then(setOptions)
      .catch((error) => setBanner(error.message))
      .finally(() => setLoading(false))
  }, [])

  const payload = () => ({
    ...values,
    layout: layout || null,
    facilities,
    accessibility_features: accessibilityFeatures,
  })

  const setValue = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))

  const handleSubmit = async (event) => {
    event.preventDefault()

    const missing = FIELDS.filter((field) => String(values[field.name]).trim() === '')
    if (missing.length > 0) {
      setFieldErrors(Object.fromEntries(missing.map((field) => [field.name, `${field.label} is required.`])))
      // One banner at a time, cleared by the user's next action
      // (docs/design/ui-guidelines.md §5): a refusal from an earlier attempt
      // must not sit above this attempt's field messages.
      setBanner(null)
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      const created = await submitRequest(payload())
      navigate(`/requests/${created.id}`, { state: { banner: 'Request submitted' } })
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveDraft = async () => {
    // AC (SCRUM-30): only the event name is required to save a draft.
    if (String(values.name).trim() === '') {
      setFieldErrors({ name: 'Event name is required.' })
      setBanner(null)
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      const created = await saveDraft(payload())
      navigate(`/requests/${created.id}`, { state: { banner: 'Draft saved' } })
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/requests" className="back-link" data-testid="request-new-back-link">
          Back to Requests
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="request-new-title">
            New request
          </h1>
        </div>
      </div>

      {banner && (
        <p
          role="alert"
          className="banner-error"
          data-testid="request-new-banner"
        >
          {banner}
        </p>
      )}

      {!loading && (
        <form className="card form-card space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 md:grid-cols-3">
            {FIELDS.map((field) => (
              <div key={field.name} className={SHORT.has(field.name) ? undefined : 'md:col-span-3'}>
                <label htmlFor={`request-new-${field.name}`} className="label">
                  {field.label} *
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={`request-new-${field.name}`}
                    aria-required="true"
                    className="input"
                    value={values[field.name]}
                    onChange={(event) => setValue(field.name, event.target.value)}
                    data-testid={`request-new-${field.name.replaceAll('_', '-')}-input`}
                  />
                ) : (
                  <input
                    id={`request-new-${field.name}`}
                    type={field.type}
                    aria-required="true"
                    className="input"
                    value={values[field.name]}
                    onChange={(event) => setValue(field.name, event.target.value)}
                    data-testid={`request-new-${field.name.replaceAll('_', '-')}-input`}
                  />
                )}
                {fieldErrors[field.name] && (
                  <p className="field-error" data-testid={`request-new-${field.name.replaceAll('_', '-')}-error`}>
                    {fieldErrors[field.name]}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="request-new-layout" className="label">
              Required room layout
            </label>
            <select
              id="request-new-layout"
              className="input"
              value={layout}
              onChange={(event) => setLayout(event.target.value)}
              data-testid="request-new-layout-input"
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
            <legend className="label">Required facilities</legend>
            {options.facilities.map((option) => (
              <label key={option} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={facilities.includes(option)}
                  onChange={() => setFacilities(toggle(facilities, option))}
                  data-testid={`request-new-facilities-${kebab(option)}-input`}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="label">Required accessibility features</legend>
            {options.accessibility_features.map((option) => (
              <label key={option} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={accessibilityFeatures.includes(option)}
                  onChange={() => setAccessibilityFeatures(toggle(accessibilityFeatures, option))}
                  data-testid={`request-new-accessibility-features-${kebab(option)}-input`}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSaveDraft}
              className="btn btn-secondary"
              data-testid="request-new-save-draft-button"
            >
              Save draft
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="request-new-submit-button"
            >
              Submit
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
