import { Fragment, useEffect, useState } from 'react'
import { useAuth } from '../../app/auth'
import { listEquipment, updateTotalUnits } from './api'
import Banner from '../../app/Banner'
import { useReveal } from '../../app/reveal'

// SCRUM-49: the equipment inventory — every recognised type and its total
// units (ui-guidelines.md §7, "Equipment inventory"). Only an account with
// equipment.edit (Technical Support Staff) is offered Change total on a row;
// the control is hidden for everyone else, and the API refuses regardless
// (ADR-002). The type's name is plain text: there is no detail page.
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
  // The Change total form opens as the row below its button, brought into
  // view with its field focused (ui-guidelines.md §13).
  const editRef = useReveal(canEdit && editingId)

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

      <Banner
        page="equipment"
        error={banner}
        success={success}
        onDismiss={() => {
          setBanner(null)
          setSuccess(null)
        }}
      />

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
                          <form ref={editRef} onSubmit={handleSave} noValidate className="space-y-4">
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
