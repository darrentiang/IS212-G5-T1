import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EquipmentRequirementsPage from '../EquipmentRequirementsPage'
import * as api from '../api'

vi.mock('../api')
let features
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (key) => features.includes(key) }) }))

// SCRUM-50: Technical Support Staff open the availability check from a recorded requirement.
const row = {
  id: 10,
  equipment_type_id: 1,
  equipment_type_name: 'Projector',
  quantity: 2,
  technical_requirements: '',
  status: 'Requested',
  arrangement_note: '',
  decline_reason: null,
  decided_by: null,
  decided_at: null,
}
const other = { ...row, id: 11, equipment_type_id: 2, equipment_type_name: 'Microphones', quantity: 4 }
const context = {
  id: 1,
  name: 'Check event',
  date: '2027-02-20',
  start_time: '10:00',
  end_time: '12:00',
  status: 'Planning',
  requirements: [row, other],
  approved_venue_bookings: [],
}
const covered = {
  equipment_type: { id: 1, name: 'Projector' },
  start: '2027-02-20T10:00',
  end: '2027-02-20T12:00',
  total_units: 10,
  reserved_units: 3,
  out_of_service_units: 0,
  available_units: 7,
  requested_units: 2,
  covered: true,
  short_by: 0,
}
const el = (suffix) => screen.getByTestId(`equipment-requirements-${suffix}`)
const missing = (suffix) => expect(screen.queryByTestId(`equipment-requirements-${suffix}`)).toBeNull()

function page() {
  return render(
    <MemoryRouter initialEntries={['/requests/1/equipment']}>
      <Routes>
        <Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  features = ['equipment.requirements.view', 'equipment.check']
  api.getEquipmentRequirements.mockResolvedValue(structuredClone(context))
  api.listEquipment.mockResolvedValue([
    { id: 1, name: 'Projector' },
    { id: 2, name: 'Microphones' },
  ])
})
afterEach(() => vi.resetAllMocks())

describe('SCRUM-50 availability check from a requirement', () => {
  // @story: SCRUM-50
  // @ac: 2, 3, 7
  it('checks the requirement for the event period and says it is covered', async () => {
    api.checkAvailability.mockResolvedValue(covered)
    page()
    await screen.findByText('Check event')

    await userEvent.click(el('check-10'))

    expect(api.checkAvailability).toHaveBeenCalledWith(1, { event_request_id: '1', quantity: 2 })
    expect(el('check-result-10')).toBeInTheDocument()
    expect(el('check-total-10')).toHaveTextContent('10')
    expect(el('check-reserved-10')).toHaveTextContent('3')
    expect(el('check-out-of-service-10')).toHaveTextContent('0')
    expect(el('check-available-10')).toHaveTextContent('7')
    expect(el('check-verdict-10')).toHaveTextContent('Covered: the 2 requested are available.')
    expect(el('check-period-10')).toHaveTextContent('20 Feb 2027, 10:00–12:00')
    missing('check-result-11')
  })

  // @story: SCRUM-50
  // @ac: 7
  it('says how many units short a requirement is', async () => {
    api.checkAvailability.mockResolvedValue({
      ...covered,
      requested_units: 8,
      available_units: 5,
      covered: false,
      short_by: 3,
    })
    page()
    await screen.findByText('Check event')

    await userEvent.click(el('check-10'))

    expect(el('check-verdict-10')).toHaveTextContent('Short by 3: 8 requested, 5 available.')
  })

  // @story: SCRUM-50
  // @ac: 2
  it('shows only the latest requirement checked', async () => {
    api.checkAvailability.mockResolvedValue(covered)
    page()
    await screen.findByText('Check event')

    await userEvent.click(el('check-10'))
    api.checkAvailability.mockResolvedValue({ ...covered, equipment_type: { id: 2, name: 'Microphones' } })
    await userEvent.click(el('check-11'))

    expect(api.checkAvailability).toHaveBeenLastCalledWith(2, { event_request_id: '1', quantity: 4 })
    expect(el('check-result-11')).toBeInTheDocument()
    missing('check-result-10')
  })

  // @story: SCRUM-50
  // @ac: 1
  it('shows the refusal in the page banner and no result', async () => {
    api.checkAvailability.mockRejectedValue(new Error('This event has no period yet, so availability cannot be checked for it.'))
    page()
    await screen.findByText('Check event')

    await userEvent.click(el('check-10'))

    expect(el('banner')).toHaveTextContent('This event has no period yet')
    missing('check-result-10')
  })

  // @story: SCRUM-50
  // @ac: 9
  it('offers an account without equipment.check no check control', async () => {
    features = ['equipment.requirements.view']
    page()
    await screen.findByText('Check event')

    missing('check-10')
    missing('check-11')
  })
})
