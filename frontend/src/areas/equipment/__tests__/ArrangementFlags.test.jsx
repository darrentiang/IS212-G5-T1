import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import EquipmentRequirementsPage from '../EquipmentRequirementsPage'

vi.mock('../api')
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (key) => key === 'equipment.requirements.view' }) }))

// @story: SCRUM-61
// @ac: 3, 6
// A Reserved reservation whose period is not the event's carries the API's flag.

const reservation = (id, fields) => ({ id, event_request_id: 1, equipment_type_id: 1,
  equipment_type_name: 'Projector', quantity: 2, date: '2026-11-15', start_time: '10:00', end_time: '12:00',
  status: 'Reserved', timing_mismatch: false, ...fields })

describe('SCRUM-61 flags on the equipment page', () => {
  it('shows Timing mismatch beside a flagged reservation only', async () => {
    api.getEquipmentRequirements.mockResolvedValue({ id: 1, name: 'SCRUM-61 event', date: '2026-11-22',
      start_time: '10:00', end_time: '12:00', status: 'Planning', requirements: [],
      approved_venue_bookings: [], reservations: [reservation(20, { timing_mismatch: true }), reservation(21, {})] })
    api.listEquipment.mockResolvedValue([])
    render(<MemoryRouter initialEntries={['/requests/1/equipment']}><Routes>
      <Route path="/requests/:id/equipment" element={<EquipmentRequirementsPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('equipment-requirements-reservation-timing-mismatch-20'))
      .toHaveTextContent('Timing mismatch')
    expect(screen.getByTestId('equipment-requirements-reservation-status-20')).toHaveTextContent(/^Reserved$/)
    expect(screen.queryByTestId('equipment-requirements-reservation-timing-mismatch-21')).not.toBeInTheDocument()
  })
})
