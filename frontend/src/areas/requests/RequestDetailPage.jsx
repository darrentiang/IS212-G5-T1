import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { STATUS, statusBadgeClass } from '../../app/format'
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

// Short fields share a row of three from tablet up; every other field takes
// the whole row (docs/design/visual-style.md, Form card).
const SHORT = new Set(['date', 'start_time', 'end_time', 'attendance'])

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

  // Keyed to id: a reply for the request the user has left can
  // arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md section 7).
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
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/requests" className="back-link" data-testid="request-detail-back-link">
          Back to Requests
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="request-detail-title">
            Request
          </h1>
        </div>
      </div>

      {banner && (
        <p role="alert" className="banner-error" data-testid="request-detail-banner">
          {banner}
        </p>
      )}
      {!banner && successBanner && (
        <p role="status" className="banner-success" data-testid="request-detail-banner">
          {successBanner}
        </p>
      )}

      {loading || banner || !row ? null : (
        <div className="card space-y-6">
          <dl className="detail-list" data-testid="request-detail-fields">
            <div>
              <dt>Name</dt>
              <dd data-testid="request-detail-name">{row.name}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd data-testid="request-detail-status">
                <span className={statusBadgeClass(row.status)}>{row.status}</span>
              </dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd data-testid="request-detail-created-by">{row.created_by}</dd>
            </div>
            {'coordinator_notes' in row && row.coordinator_notes != null && (
              <div>
                <dt>Coordinator notes</dt>
                <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
              </div>
            )}
          </dl>

          {row.status === STATUS.REQUEST.DRAFT && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpenAction('delete')}
                className="btn btn-danger"
                data-testid="request-detail-delete-button"
              >
                Delete
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={openEdit}
                className="btn btn-secondary"
                data-testid="request-detail-edit-button"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitDraft}
                className="btn btn-primary"
                data-testid="request-detail-submit-button"
              >
                Submit
              </button>
            </div>
          )}
        </div>
      )}

      {openAction === 'edit' && editValues && (
        <div className="card form-card space-y-4" data-testid="request-detail-edit-form">
          <h2 className="section-title">Edit draft</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {EDIT_FIELDS.map((field) => (
              <div key={field.name} className={SHORT.has(field.name) ? undefined : 'md:col-span-3'}>
                <label htmlFor={`request-detail-edit-${field.name}`} className="label">
                  {field.label}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={`request-detail-edit-${field.name}`}
                    className="input"
                    value={editValues[field.name]}
                    onChange={(event) => setEditValue(field.name, event.target.value)}
                    data-testid={`request-detail-edit-${field.name.replaceAll('_', '-')}-input`}
                  />
                ) : (
                  <input
                    id={`request-detail-edit-${field.name}`}
                    type={field.type}
                    className="input"
                    value={editValues[field.name]}
                    onChange={(event) => setEditValue(field.name, event.target.value)}
                    data-testid={`request-detail-edit-${field.name.replaceAll('_', '-')}-input`}
                  />
                )}
                {field.name === 'name' && editError && (
                  <p className="field-error" data-testid="request-detail-edit-name-error">
                    {editError}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="btn btn-secondary"
              data-testid="request-detail-edit-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleEditConfirm}
              className="btn btn-primary"
              data-testid="request-detail-edit-confirm-button"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {openAction === 'delete' && (
        <div className="card space-y-4" data-testid="request-detail-delete-form">
          <h2 className="section-title">Delete draft</h2>
          <p>Delete this draft permanently? This cannot be undone.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="btn btn-secondary"
              data-testid="request-detail-delete-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleDeleteConfirm}
              className="btn btn-danger"
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
