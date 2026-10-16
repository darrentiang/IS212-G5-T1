import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Banner from '../../app/Banner'
import { formatPeriod, statusBadgeClass } from '../../app/format'
import { listEquipmentEvents } from './api'

// Scoped entry point: Technical Support does not need requests.view.
export default function EquipmentRequestsPage() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEffect(() => {
    let active = true
    listEquipmentEvents().then((data) => {
      if (active) setRows(data)
    }).catch((failure) => {
      if (active) setError(failure.message)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])
  return (
    <div className="space-y-8">
      <h1 className="page-title" data-testid="equipment-requests-title">Equipment requests</h1>
      <Banner page="equipment-requests" error={error} onDismiss={() => setError(null)} />
      {!loading && rows && (
        <section className="card space-y-4">
          {rows.length === 0 ? <p data-testid="equipment-requests-empty">No events available.</p> : (
            <ul className="space-y-4">{rows.map((row) => (
              <li key={row.id}>
                <Link className="link" data-testid={`equipment-requests-event-${row.id}`} to={`/requests/${row.id}/equipment`}>{row.name}</Link>
                <p>{formatPeriod(row.date, row.start_time, row.end_time)} · <span className={statusBadgeClass(row.status)} data-testid={`equipment-requests-status-${row.id}`}>{row.status}</span></p>
              </li>
            ))}</ul>
          )}
        </section>
      )}
    </div>
  )
}
