import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth'
import { listVenues } from './api'

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900" data-testid="venues-title">
          Venues
        </h1>
        {can('venues.edit') && (
          <Link
            to="/venues/new"
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            data-testid="venues-add-button"
          >
            Add venue
          </Link>
        )}
      </div>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="venues-banner">
          {banner}
        </p>
      )}

      {loading ? null : rows.length === 0 ? (
        <p className="text-gray-600" data-testid="venues-empty">
          No venues yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">Maximum capacity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100" data-testid={`venues-row-${row.id}`}>
                  <td className="py-2 pr-4">
                    <Link to={`/venues/${row.id}`} className="text-blue-700 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{row.location}</td>
                  <td className="py-2 pr-4">{row.max_capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
