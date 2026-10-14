import { Fragment, useEffect, useState } from 'react'
import { useAuth } from '../../app/auth'
import { checkAvailability, listEquipment, updateTotalUnits } from './api'

// SCRUM-49: the equipment inventory — every recognised type and its total
// units (ui-guidelines.md §7, "Equipment inventory"). Only an account with
// equipment.edit (Technical Support Staff) is offered Change total on a row;
// the control is hidden for everyone else, and the API refuses regardless
// (ADR-002). The type's name is plain text: there is no detail page.
// SCRUM-50: an account with equipment.check (Technical Support Staff) also
// has a Check availability form: a type, a start and an end, and a result card.
// The save's acknowledgment never depends on the list refresh that follows
// it: a refused refresh replaces the table with an unavailable notice rather
// than leaving previous rows looking current.
export default function EquipmentPage() {
  const { can } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [success, setSuccess] = useState(null)
  // The row whose inline form is open — one form at a time (§7).
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  // Set when the refresh after a successful save refused: the table is then
  // shown as unavailable instead of as if its rows were current.
  const [stale, setStale] = useState(false)

  const canEdit = can('equipment.edit')
  const canCheck = can('equipment.check')

  // SCRUM-50: the availability check. A refusal goes to the page banner.
  const [checkType, setCheckType] = useState('')
  const [checkStart, setCheckStart] = useState('')
  const [checkEnd, setCheckEnd] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null)

  const handleCheck = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    setCheckResult(null)
    setChecking(true)
    try {
      setCheckResult(await checkAvailability(checkType || String(rows[0].id), { start: checkStart, end: checkEnd }))
    } catch (error) {
      setBanner(error.message)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    // StrictMode may start a second load after cleaning up the first effect.
    // A late reply from the discarded load must not replace newer inventory.
    let active = true
    listEquipment()
      .then((data) => {
        if (!active) return
        setRows(data)
        setStale(false)
      })
      .catch((error) => {
        if (!active) return
        setBanner(error.message)
        setStale(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const openEdit = (row) => {
    setEditingId(row.id)
    setEditValue(String(row.total_units))
    setEditError(null)
    setBanner(null)
    setSuccess(null)
  }

  const closeEdit = () => {
    setEditingId(null)
    setEditValue('')
    setEditError(null)
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    // The page checks the required field and sends nothing (§5); every other
    // rule is the API's, and its refusal comes back to the banner.
    if (!editValue.trim()) {
      setEditError('Total units is required')
      return
    }
    setEditError(null)
    setSubmitting(true)
    try {
      const updated = await updateTotalUnits(editingId, { total_units: editValue.trim() })
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      closeEdit()
      // The acknowledgment is given here and never depends on the refresh.
      setSuccess('Total units updated')
      try {
        const fresh = await listEquipment()
        setRows(fresh)
        setStale(false)
      } catch {
        setStale(true)
      }
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReload = async () => {
    setBanner(null)
    setLoading(true)
    try {
      const fresh = await listEquipment()
      setRows(fresh)
      setStale(false)
    } catch (error) {
      setBanner(error.message)
      setStale(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="equipment-title">
          Equipment inventory
        </h1>
      </div>

      {banner && (
        <p role="alert" className="banner-error" data-testid="equipment-banner">
          {banner}
        </p>
      )}
      {!banner && success && (
        <p role="status" className="banner-success" data-testid="equipment-banner">
          {success}
        </p>
      )}

      {!loading && !stale && canCheck && rows.length > 0 && (
        <form
          onSubmit={handleCheck}
          noValidate
          className="card form-card space-y-4"
          data-testid="equipment-check-form"
        >
          <h2 className="section-title">Check availability</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="equipment-check-type" className="label">
                Equipment type
              </label>
              <select
                id="equipment-check-type"
                className="input"
                value={checkType}
                onChange={(event) => setCheckType(event.target.value)}
                data-testid="equipment-check-type-input"
              >
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="equipment-check-start" className="label">
                Start *
              </label>
              <input
                id="equipment-check-start"
                type="datetime-local"
                className="input"
                value={checkStart}
                onChange={(event) => setCheckStart(event.target.value)}
                aria-required="true"
                data-testid="equipment-check-start-input"
              />
            </div>
            <div>
              <label htmlFor="equipment-check-end" className="label">
                End *
              </label>
              <input
                id="equipment-check-end"
                type="datetime-local"
                className="input"
                value={checkEnd}
                onChange={(event) => setCheckEnd(event.target.value)}
                aria-required="true"
                data-testid="equipment-check-end-input"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={checking}
              className="btn btn-primary"
              data-testid="equipment-check-button"
            >
              Check availability
            </button>
          </div>
        </form>
      )}

      {checkResult && (
        <div className="card space-y-3" data-testid="equipment-check-result">
          <h2 className="section-title">
            {checkResult.equipment_type.name}, {checkResult.start} to {checkResult.end}
          </h2>
          <dl className="detail-list">
            <div>
              <dt>Total units</dt>
              <dd data-testid="equipment-check-total">{checkResult.total_units}</dd>
            </div>
            <div>
              <dt>Reserved for the period</dt>
              <dd data-testid="equipment-check-reserved">{checkResult.reserved_units}</dd>
            </div>
            <div>
              <dt>Out of service</dt>
              <dd data-testid="equipment-check-out-of-service">{checkResult.out_of_service_units}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd data-testid="equipment-check-available">{checkResult.available_units}</dd>
            </div>
          </dl>
        </div>
      )}

      {loading ? null : stale ? (
        <div className="card space-y-4">
          <p role="alert" className="banner-error" data-testid="equipment-unavailable">
            The inventory could not be reloaded.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="equipment-reload-button"
            onClick={handleReload}
            disabled={submitting}
          >
            Reload
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="equipment-empty">
            No equipment types yet.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Equipment type</th>
                  <th>Total units</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr data-testid={`equipment-row-${row.id}`}>
                      <td data-testid={`equipment-name-${row.id}`}>{row.name}</td>
                      <td data-testid={`equipment-units-${row.id}`}>
                        {row.total_units} {row.total_units === 1 ? 'unit' : 'units'}
                      </td>
                      <td>
                        {canEdit && editingId !== row.id && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            data-testid={`equipment-edit-button-${row.id}`}
                            onClick={() => openEdit(row)}
                            disabled={submitting}
                          >
                            Change total
                          </button>
                        )}
                      </td>
                    </tr>
                    {canEdit && editingId === row.id && (
                      <tr>
                        <td colSpan={3}>
                          <form onSubmit={handleSave} noValidate className="space-y-4">
                            <label htmlFor="equipment-edit-units" className="label">
                              Total units *
                            </label>
                            <input
                              id="equipment-edit-units"
                              type="number"
                              value={editValue}
                              onChange={(event) => setEditValue(event.target.value)}
                              aria-required="true"
                              className="input"
                              data-testid="equipment-edit-units-input"
                              disabled={submitting}
                            />
                            {editError && (
                              <p className="field-error" data-testid="equipment-edit-units-error">
                                {editError}
                              </p>
                            )}
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                data-testid="equipment-edit-cancel-button"
                                onClick={closeEdit}
                                disabled={submitting}
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="btn btn-primary"
                                data-testid="equipment-edit-save-button"
                                disabled={submitting}
                              >
                                Save
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
