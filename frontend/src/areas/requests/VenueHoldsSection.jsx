import { STATUS, formatDateTime, statusBadgeClass } from '../../app/format'
import { occupiedText } from './occupied'

// SCRUM-84: the event's venue holds, inside the request page's Venues section
// (SCRUM-83, ui-guidelines.md §7). The Place hold button and form sit at the
// top of that section (PlaceHoldForm); the page owns the API calls and the banner.
// SCRUM-85: only a Held row offers Release, so a Released or Expired row has none.

export default function VenueHoldsSection({ holds, canRelease, submitting, onRelease }) {
  return (
    <section className="space-y-3" data-testid="request-detail-holds">
      <h3 className="section-title">Venue holds</h3>

      {holds.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-holds-empty">
            This event holds no venue.
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
                  <th>Expiry</th>
                  <th>Status</th>
                  {canRelease && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {holds.map((hold) => (
                  <tr key={hold.id} data-testid={`request-detail-hold-row-${hold.id}`}>
                    <td data-testid={`request-detail-hold-venue-${hold.id}`}>{hold.venue_name}</td>
                    <td data-testid={`request-detail-hold-period-${hold.id}`}>{occupiedText(hold)}</td>
                    <td data-testid={`request-detail-hold-expiry-${hold.id}`}>{formatDateTime(hold.expires_at)}</td>
                    <td data-testid={`request-detail-hold-status-${hold.id}`}>
                      <span className={statusBadgeClass(hold.status)}>{hold.status}</span>
                    </td>
                    {canRelease && (
                      <td>
                        {hold.status === STATUS.HOLD.HELD && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => onRelease(hold.id)}
                            className="btn btn-secondary"
                            data-testid={`request-detail-hold-release-button-${hold.id}`}
                          >
                            Release
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
