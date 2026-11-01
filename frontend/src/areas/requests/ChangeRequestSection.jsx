import { useState } from 'react'
import { STATUS, formatDateTime, statusBadgeClass } from '../../app/format'
import { useReveal, useRevealError } from '../../app/reveal'

// SCRUM-59: an Event Organiser's change and withdrawal requests, inside the request page.
// The Organiser raises one from the card's action row, which opens RaiseChangeRequestForm
// below the card; every request is listed, oldest first, to the Organiser, the assigned
// coordinator and the Lead (read-only). The form owns its entries and the messages under its
// fields (ui-guidelines.md §5) and sends nothing while a required one is missing; the page
// owns the API call and the banner, and answers true when the call went through.
// SCRUM-60: the assigned coordinator accepts or declines the open request from the same action
// row, which opens DecideChangeRequestForm; the decision, who and when, and any reason then
// show on the request's entry.

export const CHANGE = 'Change'
export const WITHDRAWAL = 'Withdrawal'

// The five things a change can affect, as the API names them (AC2).
const AFFECTS = [
  ['date_time', 'Date or time'],
  ['attendance', 'Expected attendance'],
  ['venue_requirements', 'Venue requirements'],
  ['equipment', 'Equipment'],
  ['other', 'Other'],
]
const REVIEW = [
  ['venue_bookings', 'Venue bookings'],
  ['equipment_reservations', 'Equipment reservations'],
]
const AFFECTS_LABEL = Object.fromEntries(AFFECTS)
const kebab = (key) => key.replaceAll('_', '-')

export function RaiseChangeRequestForm({ kind, submitting, onClose, onRaise }) {
  const isChange = kind === CHANGE
  const [description, setDescription] = useState('')
  const [affects, setAffects] = useState([])
  const [errors, setErrors] = useState({})
  const formRef = useReveal(true)
  useRevealError(formRef, errors)

  const toggle = (key) => {
    setAffects((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
    setErrors((current) => ({ ...current, affects: null }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    // The page checks only that a change is described and says what it affects; every other
    // rule is the API's and shows in the banner (ui-guidelines.md §5).
    const found = {}
    if (isChange && description.trim() === '') found.description = 'Describe the change.'
    if (isChange && affects.length === 0) found.affects = 'Choose what the change affects.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (await onRaise({ kind, description, affects: isChange ? affects : [] })) onClose()
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="card form-card space-y-4"
      data-testid="request-detail-change-form"
    >
      <h2 className="section-title">{isChange ? 'Request a change' : 'Request withdrawal'}</h2>
      <div>
        <label htmlFor="request-detail-change-description-input" className="label">
          {isChange ? 'Description *' : 'Text (optional)'}
        </label>
        <textarea
          id="request-detail-change-description-input"
          className="input"
          rows={3}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value)
            setErrors((current) => ({ ...current, description: null }))
          }}
          aria-required={isChange ? 'true' : undefined}
          aria-invalid={errors.description ? 'true' : undefined}
          data-testid="request-detail-change-description-input"
        />
        {errors.description && (
          <p className="field-error" data-testid="request-detail-change-description-error">
            {errors.description}
          </p>
        )}
      </div>
      {isChange && (
        <fieldset>
          <legend className="label">What it affects *</legend>
          <div className="flex flex-wrap gap-4">
            {AFFECTS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={affects.includes(key)}
                  onChange={() => toggle(key)}
                  data-testid={`request-detail-change-affects-${kebab(key)}-input`}
                />
                {label}
              </label>
            ))}
          </div>
          {errors.affects && (
            <p className="field-error" data-testid="request-detail-change-affects-error">
              {errors.affects}
            </p>
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onClose}
          className="btn btn-secondary"
          data-testid="request-detail-change-cancel-button"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          data-testid="request-detail-change-send-button"
        >
          Send
        </button>
      </div>
    </form>
  )
}

// SCRUM-60: accept or decline the open request. Declining takes a reason; accepting a change
// shows what it says needs reviewing, ticked as it stands, for the coordinator to correct;
// accepting a withdrawal says the event will be cancelled. Only a missing reason is checked here.
export function DecideChangeRequestForm({ request, decision, submitting, onClose, onDecide }) {
  const accepting = decision === 'Accept'
  const [reason, setReason] = useState('')
  const [review, setReview] = useState({ ...request.needs_review })
  const [error, setError] = useState(null)
  // Accepting a withdrawal has no field to focus.
  const formRef = useReveal(true, accepting && request.kind === WITHDRAWAL ? null : undefined)
  useRevealError(formRef, error)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!accepting && reason.trim() === '') {
      setError('Give a reason for declining.')
      return
    }
    setError(null)
    const body = accepting
      ? { decision, ...(request.kind === CHANGE ? { needs_review: review } : {}) }
      : { decision, reason }
    if (await onDecide(request.id, body)) onClose()
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="card form-card space-y-4"
      data-testid="request-detail-decide-form"
    >
      <h2 className="section-title">{accepting ? 'Accept the request' : 'Decline the request'}</h2>
      {!accepting && (
        <div>
          <label htmlFor="request-detail-decide-reason-input" className="label">
            Reason *
          </label>
          <textarea
            id="request-detail-decide-reason-input"
            className="input"
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setError(null)
            }}
            aria-required="true"
            aria-invalid={error ? 'true' : undefined}
            data-testid="request-detail-decide-reason-input"
          />
          {error && (
            <p className="field-error" data-testid="request-detail-decide-reason-error">
              {error}
            </p>
          )}
        </div>
      )}
      {accepting && request.kind === CHANGE && (
        <fieldset>
          <legend className="label">Needs reviewing</legend>
          <div className="flex flex-wrap gap-4">
            {REVIEW.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={review[key]}
                  onChange={() => setReview((current) => ({ ...current, [key]: !current[key] }))}
                  data-testid={`request-detail-decide-review-${kebab(key)}-input`}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {accepting && request.kind === WITHDRAWAL && (
        <p data-testid="request-detail-decide-withdrawal-note">Accepting cancels the event.</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onClose}
          className="btn btn-secondary"
          data-testid="request-detail-decide-cancel-button"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          data-testid="request-detail-decide-confirm-button"
        >
          Confirm
        </button>
      </div>
    </form>
  )
}

// What a request says needs reviewing: the venue bookings, the equipment reservations, both or neither.
const reviewText = (needsReview) => {
  const needed = []
  if (needsReview.venue_bookings) needed.push('Venue bookings')
  if (needsReview.equipment_reservations) needed.push('Equipment reservations')
  return needed.length > 0 ? needed.join(' and ') : 'Nothing needs reviewing'
}

export default function ChangeRequestSection({ changeRequests }) {
  return (
    <section className="space-y-3" data-testid="request-detail-change-requests">
      <h2 className="section-title">Change requests</h2>
      <ol className="space-y-3">
        {changeRequests.map((row) => (
          <li key={row.id} className="card space-y-2" data-testid={`request-detail-change-row-${row.id}`}>
            <p className="flex flex-wrap items-center gap-2">
              <strong data-testid={`request-detail-change-kind-${row.id}`}>
                {row.kind === WITHDRAWAL ? 'Withdrawal request' : 'Change request'}
              </strong>
              <span className={statusBadgeClass(row.status)} data-testid={`request-detail-change-status-${row.id}`}>
                {row.status}
              </span>
              {row.status === STATUS.CHANGE.CLOSED && (
                <span className="text-sm" data-testid={`request-detail-change-closed-${row.id}`}>
                  Closed without a decision
                </span>
              )}
            </p>
            {row.description && (
              <p className="whitespace-pre-wrap" data-testid={`request-detail-change-description-${row.id}`}>
                {row.description}
              </p>
            )}
            {row.kind === CHANGE && (
              <>
                <p data-testid={`request-detail-change-affects-${row.id}`}>
                  Affects: {row.affects.map((key) => AFFECTS_LABEL[key]).join(', ')}
                </p>
                <p data-testid={`request-detail-change-review-${row.id}`}>{reviewText(row.needs_review)}</p>
              </>
            )}
            <p className="text-sm" data-testid={`request-detail-change-raised-${row.id}`}>
              {row.raised_by}, {formatDateTime(row.raised_at)}
            </p>
            {row.decided_by && (
              <p className="text-sm" data-testid={`request-detail-change-decided-${row.id}`}>
                {row.status} by {row.decided_by}, {formatDateTime(row.decided_at)}
              </p>
            )}
            {row.decision_reason && (
              <p className="whitespace-pre-wrap" data-testid={`request-detail-change-reason-${row.id}`}>
                {row.decision_reason}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
