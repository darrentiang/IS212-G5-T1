import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { STATUS, formatDate, formatDateTime, formatTime, statusBadgeClass } from '../../app/format'
import { approveRequest, deleteDraft, getRequest, rejectRequest, submitDraft, updateDraft } from './api'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
// SCRUM-28: show the success banner carried from RequestNewPage's navigate(),
// and let the Draft's owner submit it (state-model.md: 'Draft -> Submitted').
// SCRUM-29: every submitted field, the submission date and organiser, and the
// decision; an Event Coordinator approves or rejects a Submitted request
// through an inline reason form (ui-guidelines.md §7).
// SCRUM-36: for an Approved or Planning event, an Event Coordinator may
// request a venue booking; it links to the bookings area's own page
// (docs/design/frontend.md §2) rather than an inline form.
// SCRUM-33: for the same two statuses, an Event Coordinator may also search the
// venues free for the event; that page belongs to the venues area.

// Same order and labels as RequestNewPage's form (ui-guidelines.md §7).
const FIELDS = [
  { name: 'name', label: 'Event name' },
  { name: 'purpose', label: 'Purpose' },
  { name: 'description', label: 'Description' },
  { name: 'date', label: 'Date', format: formatDate },
  { name: 'start_time', label: 'Start time', format: formatTime },
  { name: 'end_time', label: 'End time', format: formatTime },
  { name: 'attendance', label: 'Expected attendance' },
  { name: 'venue_requirements', label: 'Venue requirements' },
  { name: 'accessibility_needs', label: 'Accessibility needs' },
  { name: 'equipment_requirements', label: 'Equipment requirements' },
  { name: 'registration_needs', label: 'Registration needs' },
]

const DECISIONS = {
  approve: { label: 'Approve', send: approveRequest, banner: 'Request approved', reasonRequired: false },
  reject: { label: 'Reject', send: rejectRequest, banner: 'Request rejected', reasonRequired: true },
}

const testId = (name) => `request-detail-${name.replaceAll('_', '-')}`

// A Draft may be saved with fields still empty, so format only what is there.
const show = (value, format) => (value == null || value === '' ? '' : format ? format(value) : value)
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
  const { can } = useAuth() ?? {}
  const navigate = useNavigate()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)
  const [submitting, setSubmitting] = useState(false)
  // Only one inline form open at a time (ui-guidelines.md §7).
  const [openAction, setOpenAction] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
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

const openDecision = (action) => {
    setOpenAction(action)
    setReason('')
    setReasonError(null)
    setBanner(null)
    setSuccessBanner(null)
  }

  const closeDecision = () => {
    setOpenAction(null)
    setReason('')
    setReasonError(null)
  }

  const handleConfirmDecision = async (event) => {
    event.preventDefault()
    const decision = DECISIONS[openAction]
    if (decision.reasonRequired && reason.trim() === '') {
      setReasonError('Reason is required.')
      return
    }
    setReasonError(null)

    setSubmitting(true)
    try {
      const updated = await decision.send(id, reason)
      setRow(updated)
      setBanner(null)
      setSuccessBanner(decision.banner)
      closeDecision()
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      closeDecision()
      // The refusal may mean someone else decided first (AC7): show the
      // request as it now stands, the existing decision and its date included.
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const canDecide = Boolean(can?.('requests.decide')) && row?.status === STATUS.REQUEST.SUBMITTED
  const canRaiseBooking =
    Boolean(can?.('bookings.edit')) &&
    [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(row?.status)
  // SCRUM-33: venue search is offered for the same two statuses.
  const canSearchVenues =
    Boolean(can?.('venues.search')) &&
    [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(row?.status)

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

      {loading || !row ? null : (
        <div className="card space-y-6">
          <dl className="detail-list" data-testid="request-detail-fields">
            {typeof FIELDS !== 'undefined' && FIELDS.map((field) => (
              <div key={field.name}>
                <dt>{field.label}</dt>
                <dd className="whitespace-pre-wrap" data-testid={testId(field.name)}>
                  {show(row[field.name], field.format)}
                </dd>
              </div>
            ))}
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
            
            {row.submitted_at && (
              <div>
                <dt>Submitted on</dt>
                <dd data-testid="request-detail-submitted-at">{formatDateTime(row.submitted_at)}</dd>
              </div>
            )}
            {row.decision && (
              <>
                <div>
                  <dt>Decision</dt>
                  <dd data-testid="request-detail-decision">{row.decision}</dd>
                </div>
                {row.decision_reason && (
                  <div>
                    <dt>Reason</dt>
                    <dd className="whitespace-pre-wrap" data-testid="request-detail-decision-reason">
                      {row.decision_reason}
                    </dd>
                  </div>
                )}
                {row.decided_at && (
                  <div>
                    <dt>Decided on</dt>
                    <dd data-testid="request-detail-decided-at">{formatDateTime(row.decided_at)}</dd>
                  </div>
                )}
                <div>
                  <dt>Decided by</dt>
                  <dd data-testid="request-detail-decided-by">{row.decided_by}</dd>
                </div>
              </>
            )}

            {'coordinator_notes' in row && row.coordinator_notes != null && (
              <div>
                <dt>Coordinator notes</dt>
                <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
              </div>
            )}
          </dl>

          {/* SCRUM-30: a Draft's owner may edit, delete or submit it. */}
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

          {/* SCRUM-36: an Approved or Planning event may have a venue booking requested.
              SCRUM-33: and the venues free for it searched. */}
          {(canSearchVenues || canRaiseBooking) && (
            <div className="flex flex-wrap justify-end gap-2">
              {canSearchVenues && (
                <Link
                  to={`/requests/${id}/venues/search`}
                  className="btn btn-secondary"
                  data-testid="request-detail-search-venues-button"
                >
                  Search venues
                </Link>
              )}
              {canRaiseBooking && (
                <Link
                  to={`/requests/${id}/bookings/new`}
                  className="btn btn-primary"
                  data-testid="request-detail-raise-booking-button"
                >
                  Request venue booking
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* SCRUM-30: edit any field of an own Draft, including the name. */}
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

      {/* SCRUM-30: permanently delete an own Draft. */}
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

      {/* SCRUM-29: approve or reject a Submitted request. */}
      {!loading && canDecide && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => openDecision('reject')}
            className="btn btn-secondary"
            data-testid="request-detail-reject-button"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => openDecision('approve')}
            className="btn btn-primary"
            data-testid="request-detail-approve-button"
          >
            Approve
          </button>
        </div>
      )}

      {canDecide && ['approve', 'reject'].includes(openAction) && (
        <form onSubmit={handleConfirmDecision} noValidate className="card form-card space-y-4">
          <h2 className="section-title">{DECISIONS[openAction].label} Request</h2>
          <div>
            <label htmlFor={`${openAction}-reason`} className="label">
              {DECISIONS[openAction].reasonRequired ? 'Reason *' : 'Reason'}
            </label>
            <textarea
              id={`${openAction}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-required={DECISIONS[openAction].reasonRequired ? 'true' : undefined}
              className="input"
              data-testid={`request-detail-${openAction}-reason-input`}
            />
            {reasonError && (
              <p className="field-error" data-testid={`request-detail-${openAction}-reason-error`}>
                {reasonError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={closeDecision}
              className="btn btn-secondary"
              data-testid={`request-detail-${openAction}-cancel-button`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid={`request-detail-${openAction}-confirm-button`}
            >
              Confirm
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
