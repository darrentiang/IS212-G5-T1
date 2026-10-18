import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import EquipmentRequirementsPage from '../EquipmentRequirementsPage'
import * as api from '../api'
vi.mock('../api')
let features
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (feature) => features.includes(feature) }) }))
const catalogue = [{ id: 1, name: 'Projector' }, { id: 2, name: 'Microphones' }]
const item = { id: 10, equipment_type_id: 1, equipment_type_name: 'Projector', quantity: 2, technical_requirements: 'HDMI', status: 'Requested' }
const context = { id: 1, name: 'Event one', date: '2026-12-15', start_time: '10:00', end_time: '12:00', status: 'Planning', requirements: [item], approved_venue_bookings: [] }
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function Jump() { const navigate = useNavigate(); return <button onClick={() => navigate('/requests/2/equipment')}>Other event</button> }
function page(strict = false) {
  const tree = <MemoryRouter initialEntries={['/requests/1/equipment']}><Jump /><Routes><Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} /></Routes></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
const testId = (suffix) => screen.getByTestId(`equipment-requirements-${suffix}`)
const click = async (suffix) => userEvent.click(testId(suffix))
async function ready() { await screen.findByText('Event one') }
async function edit() { await ready(); await click('edit-10') }
async function add() { await ready(); await click('add-button'); await userEvent.selectOptions(testId('type-input'), '2'); await userEvent.type(testId('quantity-input'), '4') }
beforeEach(() => {
  features = ['equipment.requirements.edit', 'requests.view']
  api.getEquipmentRequirements.mockResolvedValue(structuredClone(context))
  api.listEquipment.mockResolvedValue(catalogue)
})
afterEach(() => vi.resetAllMocks())
describe('equipment requirements', () => {
  // @story: SCRUM-48
  // @ac: 6
  it('renders event context, Requested values, empty venues and permitted event link', async () => {
    page(); await ready()
    expect(testId('timing')).toHaveTextContent('15 Dec 2026, 10:00–12:00')
    expect(testId('status')).toHaveTextContent('Planning')
    expect(testId('no-venues')).toHaveTextContent('No Approved venue bookings.')
    expect(testId('event-link')).toHaveAttribute('href', '/requests/1')
    expect(testId('technical-10')).toHaveTextContent('HDMI')
  })
  // @story: SCRUM-48
  // @ac: 1, 6
  it('shows multiple Approved venues, blank optional text, and no Coordinator actions for Technical Support', async () => {
    features = []
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...item, technical_requirements: '' }], approved_venue_bookings: [{ ...context, id: 5, venue_name: 'Venue A' }, { ...context, id: 6, venue_name: 'Venue B' }] })
    page(); await ready()
    expect(testId('venue-5')).toHaveTextContent('Venue A')
    expect(testId('venue-6')).toHaveTextContent('Venue B')
    expect(testId('technical-10')).toHaveTextContent('None')
    expect(screen.queryByTestId('equipment-requirements-event-link')).toBeNull()
    expect(screen.queryByTestId('equipment-requirements-add-button')).toBeNull()
    expect(screen.queryByTestId('equipment-requirements-edit-10')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 1
  it.each(['Safety Check', 'Submitted'])('offers no mutations in %s', async (status) => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, status })
    page(); await ready(); expect(screen.queryByTestId('equipment-requirements-add-button')).toBeNull()
    expect(screen.queryByTestId('equipment-requirements-remove-10')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 3
  it('does not offer change/remove for reviewed requirements or add when every type is recorded', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...item, status: 'Approved' }, { ...item, id: 11, equipment_type_id: 2, status: 'Declined' }] })
    page(); await ready()
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    expect(screen.queryByTestId('equipment-requirements-add-button')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 2
  it('adds a recognised type, sends strings, accepts blank optional text and closes the form', async () => {
    api.addEquipmentRequirement.mockResolvedValue({ ...item, id: 11, equipment_type_id: 2, equipment_type_name: 'Microphones', quantity: 4, technical_requirements: '' })
    page(); await add()
    expect(screen.queryByRole('option', { name: 'Projector' })).toBeNull()
    await click('save-button')
    expect(api.addEquipmentRequirement).toHaveBeenCalledWith('1', { equipment_type_id: 2, quantity: '4', technical_requirements: '' })
    expect(testId('quantity-11')).toHaveTextContent('4')
    expect(testId('banner')).toHaveTextContent('Equipment requirement recorded')
    expect(screen.queryByTestId('equipment-requirements-form')).toBeNull()
    await click('banner-dismiss'); expect(screen.queryByRole('status')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 3
  it('corrects quantity and optional text without changing another requirement', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [item, { ...item, id: 11, equipment_type_id: 2, equipment_type_name: 'Microphones', quantity: 4 }] })
    api.updateEquipmentRequirement.mockResolvedValue({ ...item, quantity: 3, technical_requirements: '' })
    page(); await edit()
    expect(testId('quantity-input')).toHaveValue(2)
    await userEvent.clear(testId('quantity-input')); await userEvent.type(testId('quantity-input'), '3')
    await userEvent.clear(testId('technical-input')); await click('save-button')
    expect(api.updateEquipmentRequirement).toHaveBeenCalledWith('1', 10, { quantity: '3', technical_requirements: '' })
    expect(testId('quantity-10')).toHaveTextContent('3'); expect(testId('quantity-11')).toHaveTextContent('4')
    expect(testId('banner')).toHaveTextContent('updated')
  })
  // @story: SCRUM-48
  // @ac: 3
  it('removes the final requirement only after confirmation and shows empty state', async () => {
    api.removeEquipmentRequirement.mockResolvedValue(null)
    page(); await ready(); await click('remove-10')
    expect(screen.getByText('Remove Projector from this event?')).toBeInTheDocument()
    expect(api.removeEquipmentRequirement).not.toHaveBeenCalled()
    await click('confirm-remove-button')
    expect(api.removeEquipmentRequirement).toHaveBeenCalledWith('1', 10)
    expect(testId('empty')).toHaveTextContent('No equipment requirements.')
    expect(testId('banner')).toHaveTextContent('removed')
  })
  // @story: SCRUM-48
  // @ac: 3
  it('cancels an inline action without sending a mutation', async () => {
    page(); await edit(); await click('cancel-button')
    expect(screen.queryByTestId('equipment-requirements-form')).toBeNull()
    expect(api.updateEquipmentRequirement).not.toHaveBeenCalled()
  })
  // @story: SCRUM-48
  // @ac: 2, 5
  it('requires quantity before submission and keeps the form open', async () => {
    page(); await edit(); await userEvent.clear(testId('quantity-input')); await click('save-button')
    expect(screen.getByText('Equipment type and quantity are required.')).toBeInTheDocument()
    expect(api.updateEquipmentRequirement).not.toHaveBeenCalled()
    expect(testId('quantity-input')).toHaveFocus()
  })
  // @story: SCRUM-48
  // @ac: 2, 5
  it('requires a selected type as well as quantity', async () => {
    page(); await ready(); await click('add-button'); await userEvent.type(testId('quantity-input'), '2'); await click('save-button')
    expect(api.addEquipmentRequirement).not.toHaveBeenCalled()
    expect(screen.getByText('Equipment type and quantity are required.')).toBeInTheDocument()
  })
  // @story: SCRUM-48
  // @ac: 2, 5
  it('edits accept fractional text for server refusal, preserve typed values and stored row', async () => {
    api.updateEquipmentRequirement.mockRejectedValue(new Error('Quantity must be a positive whole number.'))
    page(); await edit(); await userEvent.clear(testId('quantity-input')); await userEvent.type(testId('quantity-input'), '1.5'); await click('save-button')
    expect(testId('banner')).toHaveTextContent('positive whole')
    expect(testId('quantity-input')).toHaveValue(1.5)
    expect(testId('quantity-10')).toHaveTextContent('2')
    expect(api.updateEquipmentRequirement).toHaveBeenCalledWith('1', 10, { quantity: '1.5', technical_requirements: 'HDMI' })
  })
  // @story: SCRUM-48
  // @ac: 3, 5
  it('shows removal refusal without losing the requirement', async () => {
    api.removeEquipmentRequirement.mockRejectedValue(new Error('Only Requested requirements can be removed.'))
    page(); await ready(); await click('remove-10'); await click('confirm-remove-button')
    expect(testId('banner')).toHaveTextContent('Only Requested')
    expect(testId('row-10')).toBeInTheDocument()
    expect(testId('confirm-remove-button')).not.toBeDisabled()
  })
  // @story: SCRUM-48
  // @ac: 1, 2
  it('loads empty requirements in Approved and can record them', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ ...context, status: 'Approved', requirements: [] })
    page(); await ready(); expect(testId('empty')).toBeInTheDocument(); await click('add-button')
    expect(testId('type-input')).toHaveFocus()
  })
  // @story: SCRUM-48
  // @ac: 5
  it('shows a refused load without displaying old or empty data, even after dismiss', async () => {
    api.getEquipmentRequirements.mockRejectedValue(new Error('Forbidden'))
    page(); await screen.findByText('Forbidden'); await click('banner-dismiss')
    expect(screen.queryByTestId('equipment-requirements-empty')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 6
  it.each(['resolve', 'reject'])('ignores an obsolete StrictMode load that will %s', async (outcome) => {
    const old = pending()
    api.getEquipmentRequirements.mockReturnValueOnce(old.promise).mockResolvedValue(context)
    page(true); await ready()
    await act(async () => { if (outcome === 'resolve') old.resolve({ ...context, name: 'Obsolete' }); else old.reject(new Error('Old failure')) })
    expect(screen.getByText('Event one')).toBeInTheDocument(); expect(screen.queryByText('Obsolete')).toBeNull(); expect(screen.queryByText('Old failure')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 6
  it('does not apply a late load reply to the event the user left', async () => {
    const old = pending()
    api.getEquipmentRequirements.mockReturnValueOnce(old.promise).mockResolvedValue({ ...context, id: 2, name: 'Event two', requirements: [] })
    page()
    await userEvent.click(screen.getByText('Other event')); await screen.findByText('Event two')
    await act(async () => { old.resolve({ ...context, name: 'Obsolete' }) })
    expect(screen.getByText('Event two')).toBeInTheDocument(); expect(screen.queryByText('Obsolete')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 5
  it.each(['add', 'edit', 'remove', 'edit-rejected'])('does not apply a late %s mutation to another event', async (mode) => {
    const old = pending()
    api.addEquipmentRequirement.mockReturnValue(old.promise)
    api.updateEquipmentRequirement.mockReturnValue(old.promise)
    api.removeEquipmentRequirement.mockReturnValue(old.promise)
    api.getEquipmentRequirements.mockResolvedValueOnce(context).mockResolvedValue({ ...context, id: 2, name: 'Event two', requirements: [] })
    page(); await ready()
    if (mode === 'add') { await add(); await click('save-button') }
    else { await click(mode === 'remove' ? 'remove-10' : 'edit-10'); await click(mode === 'remove' ? 'confirm-remove-button' : 'save-button') }
    expect(testId(mode === 'remove' ? 'confirm-remove-button' : 'save-button')).toBeDisabled()
    await userEvent.click(screen.getByText('Other event')); await screen.findByText('Event two')
    await act(async () => { if (mode === 'edit-rejected') old.reject(new Error('Old mutation failed')); else old.resolve({ ...item, quantity: 9 }) })
    expect(testId('empty')).toBeInTheDocument(); expect(screen.queryByTestId('equipment-requirements-banner')).toBeNull()
  })
})
