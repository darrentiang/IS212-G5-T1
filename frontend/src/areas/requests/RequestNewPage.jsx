import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { submitRequest } from './api'

// SCRUM-28: an Event Organiser submits a request directly (docs/design/state-model.md, '— -> Submitted').
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

const EMPTY = Object.fromEntries(FIELDS.map((field) => [field.name, '']))

export default function RequestNewPage() {
  const navigate = useNavigate()
  const [values, setValues] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState({})
  const [banner, setBanner] = useState(null)
  const [submitting, setSubmitting] = useState(false)

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
      const created = await submitRequest(values)
      navigate(`/requests/${created.id}`, { state: { banner: 'Request submitted' } })
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/requests" className="text-blue-700 hover:underline text-sm" data-testid="request-new-back-link">
        Back to Requests
      </Link>

      <h1 className="text-xl font-semibold text-gray-900" data-testid="request-new-title">
        New request
      </h1>

      {banner && (
        <p
          role="alert"
          className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm"
          data-testid="request-new-banner"
        >
          {banner}
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={`request-new-${field.name}`} className="block text-sm font-medium text-gray-700">
              {field.label} *
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={`request-new-${field.name}`}
                aria-required="true"
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={values[field.name]}
                onChange={(event) => setValue(field.name, event.target.value)}
                data-testid={`request-new-${field.name.replaceAll('_', '-')}-input`}
              />
            ) : (
              <input
                id={`request-new-${field.name}`}
                type={field.type}
                aria-required="true"
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={values[field.name]}
                onChange={(event) => setValue(field.name, event.target.value)}
                data-testid={`request-new-${field.name.replaceAll('_', '-')}-input`}
              />
            )}
            {fieldErrors[field.name] && (
              <p
                className="mt-1 text-sm text-red-700"
                data-testid={`request-new-${field.name.replaceAll('_', '-')}-error`}
              >
                {fieldErrors[field.name]}
              </p>
            )}
          </div>
        ))}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="request-new-submit-button"
          >
            Submit
          </button>
        </div>
      </form>
    </div>
  )
}
