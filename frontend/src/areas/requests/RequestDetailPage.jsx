import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { STATUS, formatDate, formatDateTime, formatTime } from '../../app/format'
import { approveRequest, getRequest, rejectRequest, submitDraft } from './api'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
// SCRUM-28: show the success banner carried from RequestNewPage's navigate(),
// and let the Draft's owner submit it (state-model.md: 'Draft -> Submitted').
// SCRUM-29: every submitted field, the submission date and organiser, and the
// decision; an Event Coordinator approves or rejects a Submitted request
// through an inline reason form (ui-guidelines.md §7).

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

export default function RequestDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { can } = useAuth() ?? {}
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [openAction, setOpenAction] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)

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

      {loading || !row ? null : (
        <dl className="space-y-2 text-sm" data-testid="request-detail-fields">
          {FIELDS.map((field) => (
            <div key={field.name}>
              <dt className="font-medium text-gray-700">{field.label}</dt>
              <dd className="whitespace-pre-wrap" data-testid={testId(field.name)}>
                {show(row[field.name], field.format)}
              </dd>
            </div>
          ))}
          <div>
            <dt className="font-medium text-gray-700">Status</dt>
            <dd data-testid="request-detail-status">{row.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Created by</dt>
            <dd data-testid="request-detail-created-by">{row.created_by}</dd>
          </div>
          {row.submitted_at && (
            <div>
              <dt className="font-medium text-gray-700">Submitted on</dt>
              <dd data-testid="request-detail-submitted-at">{formatDateTime(row.submitted_at)}</dd>
            </div>
          )}
          {row.decision && (
            <>
              <div>
                <dt className="font-medium text-gray-700">Decision</dt>
                <dd data-testid="request-detail-decision">{row.decision}</dd>
              </div>
              {row.decision_reason && (
                <div>
                  <dt className="font-medium text-gray-700">Reason</dt>
                  <dd className="whitespace-pre-wrap" data-testid="request-detail-decision-reason">
                    {row.decision_reason}
                  </dd>
                </div>
              )}
              {row.decided_at && (
                <div>
                  <dt className="font-medium text-gray-700">Decided on</dt>
                  <dd data-testid="request-detail-decided-at">{formatDateTime(row.decided_at)}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium text-gray-700">Decided by</dt>
                <dd data-testid="request-detail-decided-by">{row.decided_by}</dd>
              </div>
            </>
          )}
          {row.coordinator_notes != null && (
            <div>
              <dt className="font-medium text-gray-700">Coordinator notes</dt>
              <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
            </div>
          )}
        </dl>
      )}

      {!loading && row && row.status === STATUS.REQUEST.DRAFT && (
        <div className="flex justify-end">
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

      {!loading && canDecide && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => openDecision('reject')}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
            data-testid="request-detail-reject-button"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => openDecision('approve')}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="request-detail-approve-button"
          >
            Approve
          </button>
        </div>
      )}

      {canDecide && openAction && (
        <form onSubmit={handleConfirmDecision} noValidate className="space-y-2 rounded border border-gray-200 p-3 text-sm">
          <label htmlFor={`${openAction}-reason`} className="block font-medium text-gray-700">
            {DECISIONS[openAction].reasonRequired ? 'Reason *' : 'Reason'}
          </label>
          <textarea
            id={`${openAction}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-required={DECISIONS[openAction].reasonRequired ? 'true' : undefined}
            className="block w-full rounded border border-gray-300 px-2 py-1"
            data-testid={`request-detail-${openAction}-reason-input`}
          />
          {reasonError && (
            <p className="text-red-700" data-testid={`request-detail-${openAction}-reason-error`}>
              {reasonError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={closeDecision}
              className="rounded border border-gray-300 px-4 py-2 font-medium text-gray-800 disabled:opacity-50"
              data-testid={`request-detail-${openAction}-cancel-button`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
              data-testid={`request-detail-${openAction}-confirm-button`}
            >
              {DECISIONS[openAction].label}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
