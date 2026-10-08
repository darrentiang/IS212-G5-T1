import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { STATUS, formatDate, formatDateTime, formatTime, statusBadgeClass } from '../../app/format'
import {
  approveRequest,
  deleteDraft,
  getRequest,
  getRequestOptions,
  rejectRequest,
  resubmitRequest,
  submitDraft,
  updateDraft,
} from './api'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
// SCRUM-28: show the success banner carried from RequestNewPage's navigate(),
// and let the Draft's owner submit it (state-model.md: 'Draft -> Submitted').
// SCRUM-29: every submitted field, the submission date and organiser, and the
// decision; an Event Coordinator approves or rejects a Submitted request
// through an inline reason form (ui-guidelines.md §7).
// SCRUM-36: for an Approved or Planning event, an Event Coordinator may
// request a venue booking; it links to the bookings area's own page
// (docs/design/frontend.md §2) rather than an inline form.
// SCRUM-42: the chosen required layout, facilities and accessibility features,
// shown as on the venue page ("None" when empty), and chosen in the Draft edit
// form. They replace the brief's free-text venue requirements and
// accessibility needs, so they sit where those were, under the brief's two headings.
// SCRUM-33: for the same two statuses, an Event Coordinator may also search the
// venues free for the event; that page belongs to the venues area.
// SCRUM-72: the Organiser who created a Rejected request revises it in a form
// that is already open and resubmits it (state-model.md: 'Rejected -> Submitted').

// Same order and labels as RequestNewPage's form (ui-guidelines.md §7): FIELDS
// come before the Venue requirements and Accessibility needs groups,
// FIELDS_AFTER_CHOICES after them.
const FIELDS = [
  { name: 'name', label: 'Event name' },
  { name: 'purpose', label: 'Purpose' },
  { name: 'description', label: 'Description' },
  { name: 'date', label: 'Date', format: formatDate },
  { name: 'start_time', label: 'Start time', format: formatTime },
  { name: 'end_time', label: 'End time', format: formatTime },
  { name: 'attendance', label: 'Expected attendance' },
]

const FIELDS_AFTER_CHOICES = [
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
// or permanently delete it. Split around the SCRUM-42 groups as above.
const EDIT_FIELDS_BEFORE_CHOICES = [
  { name: 'name', label: 'Event name', type: 'text' },
  { name: 'purpose', label: 'Purpose', type: 'text' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'start_time', label: 'Start time', type: 'time' },
  { name: 'end_time', label: 'End time', type: 'time' },
  { name: 'attendance', label: 'Expected attendance', type: 'number' },
]

const EDIT_FIELDS_AFTER_CHOICES = [
  { name: 'equipment_requirements', label: 'Equipment requirements', type: 'textarea' },
  { name: 'registration_needs', label: 'Registration needs', type: 'textarea' },
]

const EDIT_FIELDS = [...EDIT_FIELDS_BEFORE_CHOICES, ...EDIT_FIELDS_AFTER_CHOICES]

// Short fields share a row of three from tablet up; every other field takes
// the whole row (docs/design/visual-style.md, Form card).
const SHORT = new Set(['date', 'start_time', 'end_time', 'attendance'])

const editValuesFrom = (row) =>
  Object.fromEntries(EDIT_FIELDS.map((field) => [field.name, row[field.name] ?? '']))

// The edit and resubmit forms start from the same values: the fields, the
// layout ('' when none) and the two lists.
const formValuesFrom = (row) => ({
  ...editValuesFrom(row),
  layout: row.layout ?? '',
  facilities: row.facilities,
  accessibility_features: row.accessibility_features,
})

const list = (values) => (values.length > 0 ? values.join(', ') : 'None')

// The test id of one checkbox is the option's name in kebab-case
// (docs/design/ui-guidelines.md §5).
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

const toggle = (values, value) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

export default function RequestDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { can, account } = useAuth() ?? {}
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
  const [options, setOptions] = useState(null)
  const [resubmitValues, setResubmitValues] = useState(null)
  const [resubmitErrors, setResubmitErrors] = useState({})

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

  // SCRUM-72: the form is offered to the Organiser who created the request; the
  // API refuses anyone else (403/404) and a request that is not Rejected.
  const canResubmit =
    Boolean(can?.('requests.edit')) &&
    row?.status === STATUS.REQUEST.REJECTED &&
    row?.created_by === account?.username

  // The form is already open, so its lists and starting values load with the page.
  useEffect(() => {
    if (!canResubmit || resubmitValues) return undefined
    let active = true
    getRequestOptions()
      .then((data) => {
        if (!active) return
        setOptions(data)
        setResubmitValues(formValuesFrom(row))
      })
      .catch((error) => {
        if (!active) return
        setBanner(error.message)
        setSuccessBanner(null)
      })
    return () => {
      active = false
    }
  }, [canResubmit, resubmitValues, row])

  const setResubmitValue = (name, value) => setResubmitValues((prev) => ({ ...prev, [name]: value }))

  const handleResubmit = async (event) => {
    event.preventDefault()
    const missing = EDIT_FIELDS.filter((field) => String(resubmitValues[field.name]).trim() === '')
    if (missing.length > 0) {
      setResubmitErrors(Object.fromEntries(missing.map((field) => [field.name, `${field.label} is required.`])))
      setBanner(null)
      return
    }
    setResubmitErrors({})

    setSubmitting(true)
    try {
      const updated = await resubmitRequest(id, { ...resubmitValues, layout: resubmitValues.layout || null })
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Request resubmitted')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      // The refusal may mean the request is no longer Rejected (resubmitted
      // from another page): show it as it now stands, entries kept.
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // The lists are needed only to edit, so they load when Edit is opened.
  const openEdit = async () => {
    setSubmitting(true)
    try {
      setOptions(await getRequestOptions())
      setEditValues(formValuesFrom(row))
      setEditError(null)
      setOpenAction('edit')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
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
      const updated = await updateDraft(id, { ...editValues, layout: editValues.layout || null })
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

  const renderValue = (field) => (
    <div key={field.name}>
      <dt>{field.label}</dt>
      <dd className="whitespace-pre-wrap" data-testid={testId(field.name)}>
        {show(row[field.name], field.format)}
      </dd>
    </div>
  )

  // One field of the Draft edit form or of the resubmit form: the same markup,
  // with the action as test id prefix (ui-guidelines.md section 7).
  const renderFormField = (action, values, setValue, errors, required) => (field) => {
    const key = field.name.replaceAll('_', '-')
    const Control = field.type === 'textarea' ? 'textarea' : 'input'
    return (
      <div key={field.name} className={SHORT.has(field.name) ? undefined : 'md:col-span-3'}>
        <label htmlFor={`request-detail-${action}-${field.name}`} className="label">
          {field.label}
          {required ? ' *' : ''}
        </label>
        <Control
          id={`request-detail-${action}-${field.name}`}
          type={field.type === 'textarea' ? undefined : field.type}
          aria-required={required ? 'true' : undefined}
          className="input"
          value={values[field.name]}
          onChange={(event) => setValue(field.name, event.target.value)}
          data-testid={`request-detail-${action}-${key}-input`}
        />
        {errors[field.name] && (
          <p className="field-error" data-testid={`request-detail-${action}-${key}-error`}>
            {errors[field.name]}
          </p>
        )}
      </div>
    )
  }

  const renderCheckboxes = (action, values, setValue, name) =>
    options[name].map((option) => (
      <label key={option} className="flex items-center gap-2 py-1">
        <input
          type="checkbox"
          checked={values[name].includes(option)}
          onChange={() => setValue(name, toggle(values[name], option))}
          data-testid={`request-detail-${action}-${name.replaceAll('_', '-')}-${kebab(option)}-input`}
        />
        {option}
      </label>
    ))

  // The venue and accessibility choices between the two groups of fields, shared
  // by both forms.
  const renderChoices = (action, values, setValue) => (
    <>
      <fieldset className="space-y-4">
        <legend className="section-title">Venue requirements</legend>
        <div>
          <label htmlFor={`request-detail-${action}-layout`} className="label">
            Room layout
          </label>
          <select
            id={`request-detail-${action}-layout`}
            className="input"
            value={values.layout}
            onChange={(event) => setValue('layout', event.target.value)}
            data-testid={`request-detail-${action}-layout-input`}
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
          {renderCheckboxes(action, values, setValue, 'facilities')}
        </fieldset>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="section-title">Accessibility needs</legend>
        <fieldset>
          <legend className="label">Accessibility features</legend>
          {renderCheckboxes(action, values, setValue, 'accessibility_features')}
        </fieldset>
      </fieldset>
    </>
  )

  const renderEditField = renderFormField('edit', editValues ?? {}, setEditValue, editError ? { name: editError } : {}, false)

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
            {typeof FIELDS !== 'undefined' && FIELDS.map(renderValue)}
          </dl>

          <section className="space-y-3">
            <h2 className="section-title">Venue requirements</h2>
            <dl className="detail-list">
              <div>
                <dt>Room layout</dt>
                <dd data-testid="request-detail-layout">{row.layout ?? 'None'}</dd>
              </div>
              <div>
                <dt>Facilities</dt>
                <dd data-testid="request-detail-facilities">{list(row.facilities)}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Accessibility needs</h2>
            <dl className="detail-list">
              <div>
                <dt>Accessibility features</dt>
                <dd data-testid="request-detail-accessibility-features">{list(row.accessibility_features)}</dd>
              </div>
            </dl>
          </section>

          <dl className="detail-list">
            {FIELDS_AFTER_CHOICES.map(renderValue)}
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
          <div className="grid gap-4 md:grid-cols-3">{EDIT_FIELDS_BEFORE_CHOICES.map(renderEditField)}</div>
          {renderChoices('edit', editValues, setEditValue)}
          <div className="grid gap-4 md:grid-cols-3">{EDIT_FIELDS_AFTER_CHOICES.map(renderEditField)}</div>
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

      {/* SCRUM-72: a Rejected request's creator revises it and resubmits. */}
      {!loading && canResubmit && resubmitValues && options && (
        <form
          onSubmit={handleResubmit}
          noValidate
          className="card form-card space-y-4"
          data-testid="request-detail-resubmit-form"
        >
          <h2 className="section-title">Revise and resubmit</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {EDIT_FIELDS_BEFORE_CHOICES.map(
              renderFormField('resubmit', resubmitValues, setResubmitValue, resubmitErrors, true),
            )}
          </div>
          {renderChoices('resubmit', resubmitValues, setResubmitValue)}
          <div className="grid gap-4 md:grid-cols-3">
            {EDIT_FIELDS_AFTER_CHOICES.map(
              renderFormField('resubmit', resubmitValues, setResubmitValue, resubmitErrors, true),
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="request-detail-resubmit-button"
            >
              Resubmit
            </button>
          </div>
        </form>
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
