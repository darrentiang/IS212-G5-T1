import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EquipmentRequirementsPage from '../EquipmentRequirementsPage'
import * as api from '../api'
vi.mock('../api')
let features
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (key) => features.includes(key) }) }))
const row = { id: 10, equipment_type_id: 1, equipment_type_name: 'Projector', quantity: 2, technical_requirements: 'HDMI', status: 'Requested', arrangement_note: '', decline_reason: null, decided_by: null, decided_at: null, has_unreleased_reservation: false }
const other = { ...row, id: 11, equipment_type_id: 2, equipment_type_name: 'Microphones', quantity: 4 }
const context = { id: 1, name: 'Review event', date: '2026-12-15', start_time: '10:00', end_time: '12:00', status: 'Planning', requirements: [row, other], approved_venue_bookings: [] }
const el = (suffix) => screen.getByTestId(`equipment-requirements-${suffix}`)
const click = (suffix) => userEvent.click(el(suffix))
const missing = (suffix) => expect(screen.queryByTestId(`equipment-requirements-${suffix}`)).toBeNull()
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function Jump() { const navigate = useNavigate(); return <button onClick={() => navigate('/requests/2/equipment')}>Next event</button> }
function page(strict = false) {
  const content = <MemoryRouter initialEntries={['/requests/1/equipment']}><Jump /><Routes><Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} /></Routes></MemoryRouter>
  return render(strict ? <StrictMode>{content}</StrictMode> : content)
}
async function ready() { await screen.findByText('Review event') }
beforeEach(() => {
  features = ['equipment.requirements.review']
  api.getEquipmentRequirements.mockResolvedValue(structuredClone(context))
  api.listEquipment.mockResolvedValue([{ id: 1, name: 'Projector' }, { id: 2, name: 'Microphones' }])
})
afterEach(() => vi.resetAllMocks())
describe('SCRUM-81 equipment review', () => {
  // @story: SCRUM-81
  // @ac: 2, 3, 5, 6
  it('confirms approval, sends only the decision, updates only its row and displays attribution', async () => {
    api.decideEquipmentRequirement.mockResolvedValue({ ...row, status: 'Approved', decided_by: 'tech1', decided_at: '2026-10-18T10:00:00' })
    page(); await ready(); await click('approve-10')
    expect(el('review-cancel-button')).toHaveFocus()
    expect(api.decideEquipmentRequirement).not.toHaveBeenCalled()
    await click('review-save-button')
    expect(api.decideEquipmentRequirement).toHaveBeenCalledWith('1', 10, { decision: 'Approved' })
    expect(el('status-10')).toHaveTextContent('Approved'); expect(el('status-11')).toHaveTextContent('Requested')
    expect(el('decision-10')).toHaveTextContent('tech1 — 18 Oct 2026, 10:00')
    expect(el('banner')).toHaveTextContent('Equipment requirement approved'); missing('review-form'); missing('approve-10')
    await click('banner-dismiss'); missing('banner')
  })
  // @story: SCRUM-81
  // @ac: 2, 3, 7
  it('requires a nonblank reason then corrects an approval to decline', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row, status: 'Approved' }] })
    api.decideEquipmentRequirement.mockResolvedValue({ ...row, status: 'Declined', decline_reason: 'HDMI unavailable' })
    page(); await ready(); await click('decline-10')
    await click('review-save-button'); expect(el('review-reason-error')).toHaveTextContent('reason is required')
    await userEvent.type(el('review-reason-input'), '   '); await click('review-save-button')
    expect(api.decideEquipmentRequirement).not.toHaveBeenCalled(); expect(el('review-reason-input')).toHaveFocus()
    await userEvent.clear(el('review-reason-input')); await userEvent.type(el('review-reason-input'), 'HDMI unavailable'); await click('review-save-button')
    expect(api.decideEquipmentRequirement).toHaveBeenCalledWith('1', 10, { decision: 'Declined', reason: 'HDMI unavailable' })
    expect(el('status-10')).toHaveTextContent('Declined'); expect(el('decline-reason-10')).toHaveTextContent('HDMI unavailable')
    expect(el('banner')).toHaveTextContent('Equipment requirement declined'); missing('decline-10')
  })
  // @story: SCRUM-81
  // @ac: 2, 3
  it('reapproves a declined requirement and clears the current decline reason', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row, status: 'Declined', decline_reason: 'Unavailable' }] })
    api.decideEquipmentRequirement.mockResolvedValue({ ...row, status: 'Approved' })
    page(); await ready(); expect(el('decline-reason-10')).toHaveTextContent('Unavailable')
    await click('approve-10'); await click('review-save-button')
    expect(el('decline-reason-10')).toHaveTextContent('None')
    expect(el('status-10')).toHaveTextContent('Approved')
  })
  // @story: SCRUM-81
  // @ac: 4, 5, 6
  it.each(['Requested', 'Approved', 'Declined'])('updates only the note on a reserved %s row', async (status) => {
    const current = { ...row, status, has_unreleased_reservation: true, arrangement_note: 'Old note', decline_reason: status === 'Declined' ? 'Unavailable' : null }
    api.getEquipmentRequirements.mockResolvedValue({ ...context, status: 'Approved', requirements: [current, other] })
    api.updateEquipmentArrangementNote.mockResolvedValue({ ...current, arrangement_note: 'Store A' })
    page(); await ready(); missing('approve-10'); missing('decline-10')
    expect(el('review-locked-10')).toHaveTextContent('locked')
    await click('edit-note-10'); expect(el('review-note-input')).toHaveValue('Old note')
    await userEvent.clear(el('review-note-input')); await userEvent.type(el('review-note-input'), 'Store A'); await click('review-save-button')
    expect(api.updateEquipmentArrangementNote).toHaveBeenCalledWith('1', 10, { arrangement_note: 'Store A' })
    expect(el('note-10')).toHaveTextContent('Store A'); expect(el('status-10')).toHaveTextContent(status)
    expect(el('status-11')).toHaveTextContent('Requested'); expect(el('banner')).toHaveTextContent('Arrangement note updated')
    expect(api.decideEquipmentRequirement).not.toHaveBeenCalled()
  })
  // @story: SCRUM-81
  // @ac: 2, 4, 7
  it.each(['Safety Check', 'Submitted', 'Completed'])('hides Technical Support mutations in %s', async (status) => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, status })
    page(); await ready(); missing('approve-10'); missing('decline-10'); missing('edit-note-10')
    expect(el('status-10')).toHaveTextContent('Requested')
  })
  // @story: SCRUM-81
  // @ac: 5, 7
  it('shows review information to a Coordinator without Technical Support controls', async () => {
    features = ['equipment.requirements.edit']
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row, status: 'Declined', decline_reason: 'Unavailable', arrangement_note: 'Alternative discussed', decided_by: 'tech1', decided_at: '2026-10-18T10:00' }] })
    page(); await ready(); expect(el('decline-reason-10')).toHaveTextContent('Unavailable'); expect(el('note-10')).toHaveTextContent('Alternative discussed')
    missing('approve-10'); missing('decline-10'); missing('edit-note-10')
  })
  // @story: SCRUM-81
  // @ac: 7
  it.each(['decline', 'note'])('retains typed %s values and the stored row on API refusal', async (mode) => {
    api.decideEquipmentRequirement.mockRejectedValue(new Error('Review refused'))
    api.updateEquipmentArrangementNote.mockRejectedValue(new Error('Review refused'))
    page(); await ready(); await click(mode === 'note' ? 'edit-note-10' : 'decline-10')
    await userEvent.type(el(mode === 'note' ? 'review-note-input' : 'review-reason-input'), 'Typed value'); await click('review-save-button')
    expect(el('banner')).toHaveTextContent('Review refused'); expect(el('status-10')).toHaveTextContent('Requested')
    expect(el(mode === 'note' ? 'review-note-input' : 'review-reason-input')).toHaveValue('Typed value')
    expect(el('review-save-button')).not.toBeDisabled()
  })
  // @story: SCRUM-81
  // @ac: 2, 4
  it('cancels and switches actions with only one inline form', async () => {
    features.push('equipment.requirements.edit')
    page(); await ready(); await click('approve-10'); await click('review-cancel-button'); missing('review-form')
    await click('edit-note-10'); await click('decline-11')
    expect(screen.getAllByTestId('equipment-requirements-review-form')).toHaveLength(1)
    await click('edit-10'); missing('review-form'); expect(el('form')).toBeInTheDocument()
    expect(api.decideEquipmentRequirement).not.toHaveBeenCalled()
  })
  // @story: SCRUM-81
  // @ac: 2, 4, 7
  it('hides an open review form when review permission is removed', async () => {
    const view = page(); await ready(); await click('decline-10')
    features = []
    view.rerender(<MemoryRouter initialEntries={['/requests/1/equipment']}><Jump /><Routes><Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} /></Routes></MemoryRouter>)
    missing('review-form'); missing('decline-10')
  })
  // @story: SCRUM-81
  // @ac: 6, 7
  it.each(['approve', 'note', 'reject'])('ignores a late %s write after navigating to another event', async (mode) => {
    const old = pending()
    api.decideEquipmentRequirement.mockReturnValue(old.promise); api.updateEquipmentArrangementNote.mockReturnValue(old.promise)
    api.getEquipmentRequirements.mockResolvedValueOnce(context).mockResolvedValue({ ...context, id: 2, name: 'Next review event', requirements: [] })
    page(); await ready(); await click(mode === 'note' ? 'edit-note-10' : 'approve-10')
    if (mode === 'note') await userEvent.type(el('review-note-input'), 'Store A')
    await click('review-save-button'); expect(el('review-save-button')).toBeDisabled(); expect(el('edit-note-11')).toBeDisabled()
    await userEvent.click(screen.getByText('Next event')); await screen.findByText('Next review event')
    await act(async () => { if (mode === 'reject') old.reject(new Error('Old failure')); else old.resolve({ ...row, status: 'Approved' }) })
    expect(el('empty')).toBeInTheDocument(); missing('banner')
  })
})
