import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { listVenues } from './api'
import Banner from '../../app/Banner'

// SCRUM-31: the venue list, and the way in to adding one. Add venue is shown
// only to an account with venues.edit (docs/design/permissions.md); editing and
// retiring a venue are SCRUM-75 and SCRUM-76.
export default function VenuesPage() {
  const { can } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    listVenues()
      .then((data) => setRows(data))
      .catch((error) => setBanner(error.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="venues-title">
          Venues
        </h1>
        {can('venues.edit') && (
          <Link
            to="/venues/new"
            className="btn btn-primary"
            data-testid="venues-add-button"
          >
            Add venue
          </Link>
        )}
      </div>

      <Banner page="venues" error={banner} onDismiss={() => setBanner(null)} />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="venues-empty">
            No venues yet.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Maximum capacity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`venues-row-${row.id}`}>
                    <td>
                      <Link to={`/venues/${row.id}`}>{row.name}</Link>
                    </td>
                    <td>{row.location}</td>
                    <td>{row.max_capacity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
