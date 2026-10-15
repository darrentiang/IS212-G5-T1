import { useReveal } from '../../app/reveal'
import { STATUS, statusBadgeClass } from '../../app/format'
import { occupiedText } from './occupied'

// SCRUM-83: every venue booking request raised for the event, inside the
// request page's Venues section (ui-guidelines.md §7): its venue, occupied
// period and status, and the reason once Cancelled. An Approved row offers
// Cancel booking to the event's assigned coordinator while the event is
// Approved or Planning; a Requested row offers Withdraw (SCRUM-77) to the
// coordinator who raised it; any other row offers nothing. Cancel booking
// opens its form as the row directly below its own (§13 pattern A); the page
// owns the API calls, the banner and the form's entries.

export default function VenueBookingsSection({
  bookings,
  canCancel,
  canWithdraw,
  hasActions,
  cancellingId,
  reason,
  reasonError,
  submitting,
  onOpenCancel,
  onReasonChange,
  onConfirmCancel,
  onCloseCancel,
  onWithdraw,
}) {
  const formRef = useReveal(cancellingId)
  const columns = hasActions ? 4 : 3

  const handleSubmit = (event) => {
    event.preventDefault()
    onConfirmCancel()
  }

  return (
    <section className="space-y-3" data-testid="request-detail-bookings">
      <h3 className="section-title">Venue bookings</h3>

      {bookings.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-bookings-empty">
            No venue booking has been requested for this event.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Occupied period</th>
                  <th>Status</th>
                  {hasActions && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <BookingRows
                    key={booking.id}
                    booking={booking}
                    columns={columns}
                    hasActions={hasActions}
                    cancellable={canCancel(booking)}
                    withdrawable={canWithdraw(booking)}
                    formOpen={cancellingId === booking.id}
                    formRef={formRef}
                    reason={reason}
                    reasonError={reasonError}
                    submitting={submitting}
                    onOpenCancel={onOpenCancel}
                    onReasonChange={onReasonChange}
                    onSubmit={handleSubmit}
                    onCloseCancel={onCloseCancel}
                    onWithdraw={onWithdraw}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

function BookingRows({
  booking,
  columns,
  hasActions,
  cancellable,
  withdrawable,
  formOpen,
  formRef,
  reason,
  reasonError,
  submitting,
  onOpenCancel,
  onReasonChange,
  onSubmit,
  onCloseCancel,
  onWithdraw,
}) {
  const id = booking.id
  return (
    <>
      <tr data-testid={`request-detail-booking-row-${id}`}>
        <td data-testid={`request-detail-booking-venue-${id}`}>{booking.venue_name}</td>
        <td data-testid={`request-detail-booking-period-${id}`}>{occupiedText(booking)}</td>
        <td>
          <span className={statusBadgeClass(booking.status)} data-testid={`request-detail-booking-status-${id}`}>
            {booking.status}
          </span>
          {booking.status === STATUS.BOOKING.CANCELLED && (
            <p className="whitespace-pre-wrap">
              Reason: <span data-testid={`request-detail-booking-cancel-reason-${id}`}>{booking.cancel_reason}</span>
            </p>
          )}
        </td>
        {hasActions && (
          <td>
            {cancellable && !formOpen && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => onOpenCancel(id)}
                className="btn btn-danger"
                data-testid={`request-detail-booking-cancel-button-${id}`}
              >
                Cancel booking
              </button>
            )}
            {withdrawable && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => onWithdraw(booking)}
                className="btn btn-secondary"
                data-testid={`request-detail-booking-withdraw-button-${id}`}
              >
                Withdraw
              </button>
            )}
          </td>
        )}
      </tr>
      {formOpen && (
        <tr>
          <td colSpan={columns} className="p-0">
            <form
              ref={formRef}
              onSubmit={onSubmit}
              noValidate
              className="form-card space-y-4 m-4"
              data-testid="request-detail-booking-cancel-form"
            >
              <h4 className="section-title">Cancel booking at {booking.venue_name}</h4>
              <div>
                <label htmlFor="request-detail-booking-cancel-reason" className="label">
                  Reason *
                </label>
                <textarea
                  id="request-detail-booking-cancel-reason"
                  value={reason}
                  onChange={(event) => onReasonChange(event.target.value)}
                  aria-required="true"
                  className="input"
                  data-testid="request-detail-booking-cancel-reason-input"
                />
                {reasonError && (
                  <p className="field-error" data-testid="request-detail-booking-cancel-reason-error">
                    {reasonError}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onCloseCancel}
                  className="btn btn-secondary"
                  data-testid="request-detail-booking-cancel-cancel-button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-danger"
                  data-testid="request-detail-booking-cancel-confirm-button"
                >
                  Confirm cancel
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}
