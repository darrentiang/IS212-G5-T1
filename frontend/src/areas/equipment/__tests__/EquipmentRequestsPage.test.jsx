import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import EquipmentRequestsPage from '../EquipmentRequestsPage'
import * as api from '../api'
vi.mock('../api')
let features
vi.mock('../../../app/auth', () => ({ useAuth: () => ({ can: (feature) => features.includes(feature) }) }))
const context = { id: 1, name: 'Event one', date: '2026-12-15', start_time: '10:00', end_time: '12:00', status: 'Planning' }
const pending = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const index = (strict = false) => { const tree = <MemoryRouter><EquipmentRequestsPage /></MemoryRouter>; return render(strict ? <StrictMode>{tree}</StrictMode> : tree) }
beforeEach(() => {
  features = ['equipment.requirements.view']
  api.listEquipmentEvents.mockResolvedValue([context])
})
afterEach(() => vi.resetAllMocks())
describe('equipment requests index', () => {
  // @story: SCRUM-48
  // @ac: 6
  it('lists scoped events with links and timing', async () => {
    index(); const link = await screen.findByTestId('equipment-requests-event-1')
    expect(link).toHaveAttribute('href', '/requests/1/equipment')
    expect(link).toHaveTextContent('Event one')
    expect(screen.getByText(/15 Dec 2026/)).toHaveTextContent('10:00')
    expect(screen.getByTestId('equipment-requests-status-1')).toHaveTextContent('Planning')
  })
  // @story: SCRUM-48
  // @ac: 6
  it('shows an actual empty list', async () => {
    api.listEquipmentEvents.mockResolvedValue([]); index(); expect(await screen.findByTestId('equipment-requests-empty')).toBeInTheDocument()
  })
  // @story: SCRUM-48
  // @ac: 5
  it('a dismissed load error never turns into a false empty list', async () => {
    api.listEquipmentEvents.mockRejectedValue(new Error('Read refused')); index(); await screen.findByText('Read refused')
    await userEvent.click(screen.getByTestId('equipment-requests-banner-dismiss'))
    expect(screen.queryByTestId('equipment-requests-empty')).toBeNull()
  })
  // @story: SCRUM-48
  // @ac: 6
  it.each(['resolve', 'reject'])('ignores discarded StrictMode index read %s', async (outcome) => {
    const old = pending(); api.listEquipmentEvents.mockReturnValueOnce(old.promise).mockResolvedValue([context]); index(true)
    await screen.findByText('Event one')
    await act(async () => { if (outcome === 'resolve') old.resolve([]); else old.reject(new Error('Old failure')) })
    expect(screen.getByText('Event one')).toBeInTheDocument(); expect(screen.queryByText('Old failure')).toBeNull()
  })
})
