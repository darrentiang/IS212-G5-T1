import { Link } from 'react-router'

// SCRUM-83: the request page's one Venues section (ui-guidelines.md §7). Search
// venues (SCRUM-33), Place hold (SCRUM-84) and Request venue booking (SCRUM-36)
// sit together at its top, each shown by the same rule as before; the page
// passes the Place hold form, the event's bookings and its holds as children.

export default function VenuesSection({
  requestId,
  canSearch,
  canRaise,
  canPlaceHold,
  holdFormOpen,
  submitting,
  onPlaceHold,
  children,
}) {
  const showPlaceHold = canPlaceHold && !holdFormOpen
  return (
    <section className="space-y-4" data-testid="request-detail-venues">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Venues</h2>
        {(canSearch || canRaise || showPlaceHold) && (
          <div className="flex flex-wrap justify-end gap-2">
            {canSearch && (
              <Link
                to={`/requests/${requestId}/venues/search`}
                className="btn btn-secondary"
                data-testid="request-detail-search-venues-button"
              >
                Search venues
              </Link>
            )}
            {showPlaceHold && (
              <button
                type="button"
                disabled={submitting}
                onClick={onPlaceHold}
                className="btn btn-secondary"
                data-testid="request-detail-place-hold-button"
              >
                Place hold
              </button>
            )}
            {canRaise && (
              <Link
                to={`/requests/${requestId}/bookings/new`}
                className="btn btn-primary"
                data-testid="request-detail-raise-booking-button"
              >
                Request venue booking
              </Link>
            )}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}
