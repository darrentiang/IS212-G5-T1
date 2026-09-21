import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listOpenEvents } from './api'

// SCRUM-27: confirmed events with registration only; never internal notes.
export default function RegistrationPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    let active = true
    listOpenEvents()
      .then((data) => {
        if (active) setRows(data)
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900" data-testid="registration-title">
        Registration
      </h1>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="registration-banner">
          {banner}
        </p>
      )}

      {loading ? null : rows.length === 0 ? (
        <p className="text-gray-600" data-testid="registration-empty">
          No events open for registration.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200">
                <th className="py-2 pr-4">Event</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100" data-testid={`registration-row-${row.id}`}>
                  <td className="py-2 pr-4">
                    <Link to={`/requests/${row.id}`} className="text-blue-700 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4" data-testid={`registration-status-${row.id}`}>
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
