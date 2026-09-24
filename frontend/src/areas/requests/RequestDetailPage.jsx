import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { STATUS } from '../../app/format'
import { deleteDraft, getRequest, submitDraft, updateDraft } from './api'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
// SCRUM-28: show the success banner carried from RequestNewPage's navigate(),
// and let the Draft's owner submit it (state-model.md: 'Draft -> Submitted').
// SCRUM-30: the Draft's owner may also edit any field (including the name)
// or permanently delete it.
const EDIT_FIELDS = [
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

const editValuesFrom = (row) =>
  Object.fromEntries(EDIT_FIELDS.map((field) => [field.name, row[field.name] ?? '']))

export default function RequestDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)
  const [submitting, setSubmitting] = useState(false)
  // Only one inline form open at a time (ui-guidelines.md §7).
  const [openAction, setOpenAction] = useState(null)
  const [editValues, setEditValues] = useState(null)
  const [editError, setEditError] = useState(null)

  useEffect(() => {
    let active = true
    getRequest(id)
      .then((data) => {
        if (active) setRow(data)
      })
      .catch((error) => {
        if (active) {
          setBanner(error.message)
          setSuccessBanner(null)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  const handleSubmitDraft = async () => {
    setSubmitting(true)
    try {
      const updated = await submitDraft(id)
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Request submitted')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = () => {
    setEditValues(editValuesFrom(row))
    setEditError(null)
    setOpenAction('edit')
  }

  const setEditValue = (name, value) => setEditValues((prev) => ({ ...prev, [name]: value }))

  const handleEditConfirm = async () => {
    if (String(editValues.name).trim() === '') {
      setEditError('Event name is required.')
      return
    }
    setEditError(null)
    setSubmitting(true)
    try {
      const updated = await updateDraft(id, editValues)
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Draft updated')
      setOpenAction(null)
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setSubmitting(true)
    try {
      await deleteDraft(id)
      navigate('/requests', { state: { banner: 'Draft deleted' } })
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Link to="/requests" className="text-blue-700 hover:underline text-sm" data-testid="request-detail-back-link">
        Back to Requests
      </Link>

      <h1 className="text-xl font-semibold text-gray-900" data-testid="request-detail-title">
        Request
      </h1>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="request-detail-banner">
          {banner}
        </p>
      )}
      {!banner && successBanner && (
        <p role="status" className="border border-green-300 bg-green-50 text-green-800 rounded px-3 py-2 text-sm" data-testid="request-detail-banner">
          {successBanner}
        </p>
      )}

      {loading || banner || !row ? null : (
        <dl className="space-y-2 text-sm" data-testid="request-detail-fields">
          <div>
            <dt className="font-medium text-gray-700">Name</dt>
            <dd data-testid="request-detail-name">{row.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Status</dt>
            <dd data-testid="request-detail-status">{row.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Created by</dt>
            <dd data-testid="request-detail-created-by">{row.created_by}</dd>
          </div>
          {'coordinator_notes' in row && row.coordinator_notes != null && (
            <div>
              <dt className="font-medium text-gray-700">Coordinator notes</dt>
              <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
            </div>
          )}
        </dl>
      )}

      {!loading && !banner && row && row.status === STATUS.REQUEST.DRAFT && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => setOpenAction('delete')}
            className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
            data-testid="request-detail-delete-button"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={openEdit}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
            data-testid="request-detail-edit-button"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmitDraft}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="request-detail-submit-button"
          >
            Submit
          </button>
        </div>
      )}

      {openAction === 'edit' && editValues && (
        <div className="space-y-4 border border-gray-200 rounded p-4" data-testid="request-detail-edit-form">
          {EDIT_FIELDS.map((field) => (
            <div key={field.name}>
              <label
                htmlFor={`request-detail-edit-${field.name}`}
                className="block text-sm font-medium text-gray-700"
              >
                {field.label}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  id={`request-detail-edit-${field.name}`}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={editValues[field.name]}
                  onChange={(event) => setEditValue(field.name, event.target.value)}
                  data-testid={`request-detail-edit-${field.name.replaceAll('_', '-')}-input`}
                />
              ) : (
                <input
                  id={`request-detail-edit-${field.name}`}
                  type={field.type}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={editValues[field.name]}
                  onChange={(event) => setEditValue(field.name, event.target.value)}
                  data-testid={`request-detail-edit-${field.name.replaceAll('_', '-')}-input`}
                />
              )}
              {field.name === 'name' && editError && (
                <p className="mt-1 text-sm text-red-700" data-testid="request-detail-edit-name-error">
                  {editError}
                </p>
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
              data-testid="request-detail-edit-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleEditConfirm}
              className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              data-testid="request-detail-edit-confirm-button"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {openAction === 'delete' && (
        <div className="space-y-4 border border-gray-200 rounded p-4" data-testid="request-detail-delete-form">
          <p className="text-sm text-gray-700">Delete this draft permanently? This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
              data-testid="request-detail-delete-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleDeleteConfirm}
              className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              data-testid="request-detail-delete-confirm-button"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
