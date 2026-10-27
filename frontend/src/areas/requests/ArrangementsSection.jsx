import { formatPeriod } from '../../app/format'

// SCRUM-46: the Event Organiser's view of their event's arrangements, below
// the details on the request page (ui-guidelines.md §7). The server decides
// what is sent: `arrangements` is missing for anyone but the Organiser who
// wrote the request, and null for a Draft, Rejected or Cancelled event, so
// this section renders nothing for them. Before Confirmed it only says the
// arrangements are in progress; the Approved venue bookings and equipment
// requirements are listed once the event is Confirmed or Completed.
export default function ArrangementsSection({ arrangements }) {
  if (!arrangements) return null

  if (arrangements.in_progress) {
    return (
      <section className="space-y-3" data-testid="request-detail-arrangements">
        <h2 className="section-title">Arrangements</h2>
        <div className="card">
          <p data-testid="request-detail-arrangements-in-progress">Arrangements are in progress.</p>
        </div>
      </section>
    )
  }

  const { venue_bookings: bookings, equipment } = arrangements
  return (
    <section className="space-y-3" data-testid="request-detail-arrangements">
      <h2 className="section-title">Arrangements</h2>

      <h3 className="section-title">Venues</h3>
      {bookings.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-arrangements-bookings-empty">
            No venue booking is approved for this event.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Location</th>
                  <th>Date and time</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} data-testid={`request-detail-arrangement-booking-${booking.id}`}>
                    <td data-testid={`request-detail-arrangement-booking-venue-${booking.id}`}>{booking.venue}</td>
                    <td data-testid={`request-detail-arrangement-booking-location-${booking.id}`}>{booking.location}</td>
                    <td data-testid={`request-detail-arrangement-booking-period-${booking.id}`}>
                      {formatPeriod(booking.date, booking.start_time, booking.end_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 className="section-title">Equipment</h3>
      {equipment.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-arrangements-equipment-empty">
            No equipment is approved for this event.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>Quantity</th>
                </tr>
              </thead>
              <tbody>
                {equipment.map((item) => (
                  <tr key={item.id} data-testid={`request-detail-arrangement-equipment-${item.id}`}>
                    <td data-testid={`request-detail-arrangement-equipment-type-${item.id}`}>{item.equipment_type}</td>
                    <td data-testid={`request-detail-arrangement-equipment-quantity-${item.id}`}>{item.quantity}</td>
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
