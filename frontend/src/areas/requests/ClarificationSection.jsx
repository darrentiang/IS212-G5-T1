import { useState } from 'react'
import { formatDateTime } from '../../app/format'
import { useReveal, useRevealError } from '../../app/reveal'

// SCRUM-45: a request's clarifications and replies, inside the request page. The assigned
// Event Coordinator asks from the card's action row, beside Approve and Reject, which opens
// AskClarificationForm below the card; the Organiser who wrote the request answers the open
// one in a form beneath it. Each form owns its entry and the message under its
// field (ui-guidelines.md §5) and sends nothing while it is blank; the page owns the
// API calls and the banner, and answers true when the call went through.

export function AskClarificationForm({ submitting, onClose, onAsk }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState(null)
  const formRef = useReveal(true)
  useRevealError(formRef, error)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (message.trim() === '') {
      setError('Say what is missing or unclear.')
      return
    }
    setError(null)
    if (await onAsk(message)) onClose()
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="card form-card space-y-4"
      data-testid="request-detail-clarification-form"
    >
      <div>
        <label htmlFor="request-detail-clarification-message-input" className="label">
          Message *
        </label>
        <textarea
          id="request-detail-clarification-message-input"
          className="input"
          rows={3}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setError(null)
          }}
          aria-required="true"
          aria-invalid={error ? 'true' : undefined}
          data-testid="request-detail-clarification-message-input"
        />
        {error && (
          <p className="field-error" data-testid="request-detail-clarification-message-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onClose}
          className="btn btn-secondary"
          data-testid="request-detail-clarification-cancel-button"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          data-testid="request-detail-clarification-send-button"
        >
          Send
        </button>
      </div>
    </form>
  )
}

function ReplyForm({ submitting, onReply }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState(null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (message.trim() === '') {
      setError('Write a reply.')
      return
    }
    setError(null)
    if (await onReply(message)) setMessage('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-3"
      data-testid="request-detail-clarification-reply-form"
    >
      <div>
        <label htmlFor="request-detail-clarification-reply-input" className="label">
          Your reply *
        </label>
        <textarea
          id="request-detail-clarification-reply-input"
          className="input"
          rows={3}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setError(null)
          }}
          aria-required="true"
          aria-invalid={error ? 'true' : undefined}
          data-testid="request-detail-clarification-reply-input"
        />
        {error && (
          <p className="field-error" data-testid="request-detail-clarification-reply-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary"
          data-testid="request-detail-clarification-reply-button"
        >
          Send reply
        </button>
      </div>
    </form>
  )
}

export default function ClarificationSection({ clarifications, canReply, submitting, onReply }) {
  const open = clarifications.find((row) => row.open)

  return (
    <section className="space-y-3" data-testid="request-detail-clarifications">
      <h2 className="section-title">Clarifications</h2>
      <ol className="space-y-3">
        {clarifications.map((row) => (
          <li key={row.id} className="card space-y-2" data-testid={`request-detail-clarification-row-${row.id}`}>
            <p className="whitespace-pre-wrap" data-testid={`request-detail-clarification-message-${row.id}`}>
              {row.message}
            </p>
            <p className="text-sm" data-testid={`request-detail-clarification-by-${row.id}`}>
              {row.requested_by}, {formatDateTime(row.requested_at)}
            </p>
            {row.reply !== null && (
              <>
                <p className="whitespace-pre-wrap" data-testid={`request-detail-clarification-reply-${row.id}`}>
                  {row.reply}
                </p>
                <p className="text-sm" data-testid={`request-detail-clarification-reply-by-${row.id}`}>
                  {row.replied_by}, {formatDateTime(row.replied_at)}
                </p>
              </>
            )}
            {canReply && open?.id === row.id && <ReplyForm submitting={submitting} onReply={onReply} />}
          </li>
        ))}
      </ol>
    </section>
  )
}
