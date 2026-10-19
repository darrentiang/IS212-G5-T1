import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EquipmentRequirementsPage from '../EquipmentRequirementsPage'
import * as api from '../api'
vi.mock('../api')
let features
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (key) => features.includes(key) }) }))
const row = { id: 10, equipment_type_id: 1, equipment_type_name: 'Projector', quantity: 4, technical_requirements: 'HDMI', status: 'Approved', arrangement_note: '', decline_reason: null, decided_by: 'tech1', decided_at: null, has_unreleased_reservation: false }
const record = { id: 20, event_request_id: 1, equipment_type_id: 1, equipment_type_name: 'Projector', quantity: 4, date: '2030-01-01', start_time: '10:00', end_time: '12:00', status: 'Reserved' }
const context = { id: 1, name: 'Reservation event', date: record.date, start_time: record.start_time, end_time: record.end_time, status: 'Planning', requirements: [row], reservations: [], approved_venue_bookings: [] }
const el = (suffix) => screen.getByTestId(`equipment-requirements-${suffix}`)
const click = (suffix) => userEvent.click(el(suffix))
const missing = (suffix) => expect(screen.queryByTestId(`equipment-requirements-${suffix}`)).toBeNull()
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function Jump() { const navigate = useNavigate(); return <button onClick={() => navigate('/requests/2/equipment')}>Next event</button> }
function tree() { return <MemoryRouter initialEntries={['/requests/1/equipment']}><Jump /><Routes><Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} /></Routes></MemoryRouter> }
async function ready() { await screen.findByText('Reservation event') }
beforeEach(() => {
  features = ['equipment.reserve', 'equipment.requirements.review']
  api.getEquipmentRequirements.mockResolvedValue(structuredClone(context))
  api.listEquipment.mockResolvedValue([{ id: 1, name: 'Projector' }])
  api.reserveEquipment.mockResolvedValue({ reservation: record, requirement: { ...row, has_unreleased_reservation: true } })
  api.releaseEquipment.mockResolvedValue({ reservation: { ...record, status: 'Released' }, requirement: row })
})
afterEach(() => vi.resetAllMocks())
// @story: SCRUM-51
// @ac: 1, 2, 5, 6
it('confirms full-quantity reserve without a quantity field and immediately applies review lock and history', async () => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [row, { ...row, id: 11, equipment_type_id: 2, equipment_type_name: 'Microphones', quantity: 2, status: 'Requested' }] })
  render(tree()); await ready(); expect(el('reservations-empty')).toHaveTextContent('No equipment reservations.')
  await click('reserve-10'); expect(el('reservation-cancel-button')).toHaveFocus()
  expect(within(el('reservation-form')).queryByRole('spinbutton')).toBeNull()
  expect(api.reserveEquipment).not.toHaveBeenCalled()
  await click('reservation-save-button')
  expect(api.reserveEquipment).toHaveBeenCalledWith('1', 10)
  expect(el('banner')).toHaveTextContent('Equipment reserved'); missing('reservation-form'); missing('reserve-10'); missing('reservations-empty')
  expect(el('reservation-20')).toHaveTextContent('Projector × 4')
  expect(el('reservation-period-20')).toHaveTextContent('01 Jan 2030, 10:00–12:00')
  expect(el('reservation-status-20')).toHaveTextContent('Reserved')
  expect(el('review-locked-10')).toHaveTextContent('locked'); missing('decline-10')
  expect(el('quantity-10')).toHaveTextContent('4'); expect(el('technical-10')).toHaveTextContent('HDMI')
  expect(el('status-11')).toHaveTextContent('Requested'); expect(el('quantity-11')).toHaveTextContent('2')
})
// @story: SCRUM-51
// @ac: 4, 5, 6
it('releases the correct history row and unlocks review without removing history', async () => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row, has_unreleased_reservation: true }], reservations: [record] })
  render(tree()); await ready(); await click('release-20'); expect(el('reservation-cancel-button')).toHaveFocus()
  await click('reservation-save-button')
  expect(api.releaseEquipment).toHaveBeenCalledWith('1', 20)
  expect(el('banner')).toHaveTextContent('Equipment reservation released')
  expect(el('reservation-status-20')).toHaveTextContent('Released'); missing('release-20'); missing('review-locked-10')
  expect(el('reserve-10')).toBeVisible(); expect(el('decline-10')).toBeVisible()
})
// @story: SCRUM-51
// @ac: 2, 4, 5
it('retains Released history when reserving again and orders rows by id', async () => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, reservations: [{ ...record, status: 'Released' }] })
  api.reserveEquipment.mockResolvedValue({ reservation: { ...record, id: 21 }, requirement: { ...row, has_unreleased_reservation: true } })
  render(tree()); await ready(); await click('reserve-10'); await click('reservation-save-button')
  expect(el('reservation-status-20')).toHaveTextContent('Released'); expect(el('reservation-status-21')).toHaveTextContent('Reserved')
  const rows = screen.getAllByTestId(/^equipment-requirements-reservation-\d+$/)
  expect(rows.map((r) => r.dataset.testid)).toEqual(['equipment-requirements-reservation-20','equipment-requirements-reservation-21'])
})
// @story: SCRUM-51
// @ac: 7
it.each(['reserve','release'])('keeps %s confirmation and stored rows on refusal', async (mode) => {
  if (mode === 'release') api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row, has_unreleased_reservation: true }], reservations: [record] })
  api.reserveEquipment.mockRejectedValue(new Error('Reservation refused'))
  api.releaseEquipment.mockRejectedValue(new Error('Reservation refused'))
  render(tree()); await ready(); await click(mode === 'reserve' ? 'reserve-10' : 'release-20'); await click('reservation-save-button')
  expect(el('banner')).toHaveTextContent('Reservation refused'); expect(el('reservation-form')).toBeVisible()
  expect(el('quantity-10')).toHaveTextContent('4'); expect(el('reservation-save-button')).not.toBeDisabled()
  if (mode === 'release') expect(el('reservation-status-20')).toHaveTextContent('Reserved')
  else missing('reservation-20')
})
// @story: SCRUM-51
// @ac: 1, 4, 7
it.each(['Safety Check','Confirmed'])('hides actions in %s but keeps readable history', async (status) => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, status, reservations: [record] })
  render(tree()); await ready(); missing('reserve-10'); missing('release-20')
  expect(el('reservation-status-20')).toHaveTextContent('Reserved')
})
// @story: SCRUM-51
// @ac: 5, 7
it('shows reservation history to a Coordinator without mutation controls', async () => {
  features = ['equipment.requirements.view']
  api.getEquipmentRequirements.mockResolvedValue({ ...context, reservations: [record, { ...record, id:21,status:'Released' }] })
  render(tree()); await ready(); missing('reserve-10'); missing('release-20')
  expect(el('reservation-status-20')).toHaveTextContent('Reserved'); expect(el('reservation-status-21')).toHaveTextContent('Released')
})
// @story: SCRUM-51
// @ac: 1, 2
it.each(['Requested','Declined'])('does not offer reserve for a %s requirement', async (status) => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements: [{ ...row,status }] })
  render(tree()); await ready(); missing('reserve-10')
})
// @story: SCRUM-51
// @ac: 1, 4, 7
it('cancels without a write, replaces other inline forms and disables controls while saving', async () => {
  const saved = pending(); api.reserveEquipment.mockReturnValue(saved.promise)
  render(tree()); await ready(); await click('edit-note-10'); expect(el('review-form')).toBeVisible()
  await click('reserve-10'); missing('review-form'); await click('reservation-cancel-button'); missing('reservation-form')
  expect(api.reserveEquipment).not.toHaveBeenCalled()
  await click('reserve-10'); await click('reservation-save-button')
  expect(el('reservation-save-button')).toBeDisabled(); expect(el('reservation-cancel-button')).toBeDisabled(); expect(el('edit-note-10')).toBeDisabled()
  await act(async () => saved.resolve({ reservation:record,requirement:{...row,has_unreleased_reservation:true} }))
  expect(el('reservation-status-20')).toHaveTextContent('Reserved')
})
// @story: SCRUM-51
// @ac: 3, 6
it('clears an earlier availability result after committing equipment', async () => {
  features.push('equipment.check')
  api.checkAvailability.mockResolvedValue({ total_units:10,reserved_units:0,out_of_service_units:0,available_units:10,requested_units:4,covered:true })
  render(tree()); await ready(); await click('check-10'); expect(el('check-result-10')).toBeVisible()
  await click('reserve-10'); await click('reservation-save-button'); missing('check-result-10')
})
// @story: SCRUM-51
// @ac: 4, 5
it('can release a legacy reservation whose requirement is no longer present', async () => {
  api.getEquipmentRequirements.mockResolvedValue({ ...context, requirements:[], reservations:[record] })
  api.releaseEquipment.mockResolvedValue({ reservation:{...record,status:'Released'},requirement:null })
  render(tree()); await ready(); await click('release-20'); await click('reservation-save-button')
  expect(el('reservation-status-20')).toHaveTextContent('Released'); expect(el('empty')).toBeVisible()
})
// @story: SCRUM-51
// @ac: 7
it('hides an open confirmation if reserve permission is removed', async () => {
  const view=render(tree()); await ready(); await click('reserve-10')
  features=[]; view.rerender(tree()); missing('reservation-form'); missing('reserve-10')
})
// @story: SCRUM-51
// @ac: 5, 7
it.each(['resolve','reject'])('discards a late reservation %s after navigating to another event', async (mode) => {
  const saved=pending(); api.reserveEquipment.mockReturnValue(saved.promise)
  render(tree()); await ready(); await click('reserve-10'); await click('reservation-save-button')
  api.getEquipmentRequirements.mockResolvedValue({ ...context,id:2,name:'Next reservation event' })
  await userEvent.click(screen.getByText('Next event')); await screen.findByText('Next reservation event')
  await act(async () => mode==='resolve' ? saved.resolve({reservation:record,requirement:row}) : saved.reject(new Error('Old refusal')))
  missing('reservation-20'); missing('banner')
})

// @story: SCRUM-51
// @ac: 3, 6, 7
it.each(['resolve','reject'])('discards an outstanding availability %s after a reservation commits', async (mode) => {
  features.push('equipment.check')
  const checked=pending(); api.checkAvailability.mockReturnValue(checked.promise)
  render(tree()); await ready(); await click('check-10')
  await click('reserve-10'); await click('reservation-save-button')
  expect(el('banner')).toHaveTextContent('Equipment reserved')
  await act(async () => mode==='resolve' ? checked.resolve({available_units:10,covered:true,requested_units:4}) : checked.reject(new Error('Obsolete availability refusal')))
  missing('check-result-10'); expect(el('banner')).toHaveTextContent('Equipment reserved')
})
// @story: SCRUM-51
// @ac: 3, 7
it.each(['resolve','reject'])('discards an availability %s after leaving its event', async (mode) => {
  features.push('equipment.check')
  const checked=pending(); api.checkAvailability.mockReturnValue(checked.promise)
  render(tree()); await ready(); await click('check-10')
  api.getEquipmentRequirements.mockResolvedValue({...context,id:2,name:'Next reservation event'})
  await userEvent.click(screen.getByText('Next event')); await screen.findByText('Next reservation event')
  await act(async () => mode==='resolve' ? checked.resolve({available_units:10,covered:true,requested_units:4}) : checked.reject(new Error('Obsolete availability refusal')))
  missing('check-result-10'); missing('banner')
})

// @story: SCRUM-51
// @ac: 1, 5
it('applies a successful reserve when an older read fixture omits reservation history', async () => {
  const olderContext = { ...context }
  delete olderContext.reservations
  api.getEquipmentRequirements.mockResolvedValue(olderContext)
  render(tree()); await ready()
  expect(el('reservations-empty')).toHaveTextContent('No equipment reservations.')
  await click('reserve-10'); await click('reservation-save-button')
  expect(api.reserveEquipment).toHaveBeenCalledWith('1', 10)
  expect(el('banner')).toHaveTextContent('Equipment reserved')
  expect(el('reservation-status-20')).toHaveTextContent('Reserved')
  missing('reservation-form'); missing('reserve-10')
})
