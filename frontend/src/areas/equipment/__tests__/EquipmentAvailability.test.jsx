import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../api'
import EquipmentPage from '../EquipmentPage'

vi.mock('../api')

let features = ['equipment.view', 'equipment.edit', 'equipment.check']
vi.mock('../../../app/auth', () => ({
  useAuth: () => ({ can: (feature) => features.includes(feature) }),
}))

const TYPES = [
  { id: 1, name: 'Projector', total_units: 10 },
  { id: 2, name: 'Microphones', total_units: 20 },
]

const RESULT = {
  equipment_type: { id: 1, name: 'Projector' },
  start: '2027-02-15T10:00',
  end: '2027-02-15T13:00',
  total_units: 10,
  reserved_units: 5,
  out_of_service_units: 0,
  available_units: 5,
}

afterEach(() => {
  features = ['equipment.view', 'equipment.edit', 'equipment.check']
  vi.restoreAllMocks()
})

// SCRUM-50: Technical Support Staff check a type for a period.
describe('Check availability', () => {
  // @story: SCRUM-50
  // @ac: 1, 3, 4
  it('sends the type, start and end, and shows total, reserved, out of service and available', async () => {
    api.listEquipment.mockResolvedValue(TYPES)
    api.checkAvailability.mockResolvedValue(RESULT)
    render(<EquipmentPage />)
    const user = userEvent.setup()

    await user.selectOptions(await screen.findByTestId('equipment-check-type-input'), '1')
    await user.type(screen.getByTestId('equipment-check-start-input'), '2027-02-15T10:00')
    await user.type(screen.getByTestId('equipment-check-end-input'), '2027-02-15T13:00')
    await user.click(screen.getByTestId('equipment-check-button'))

    expect(await screen.findByTestId('equipment-check-result')).toBeInTheDocument()
    expect(api.checkAvailability).toHaveBeenCalledWith('1', {
      start: '2027-02-15T10:00',
      end: '2027-02-15T13:00',
    })
    expect(screen.getByTestId('equipment-check-total')).toHaveTextContent('10')
    expect(screen.getByTestId('equipment-check-reserved')).toHaveTextContent('5')
    expect(screen.getByTestId('equipment-check-out-of-service')).toHaveTextContent('0')
    expect(screen.getByTestId('equipment-check-available')).toHaveTextContent('5')
  })

  // @story: SCRUM-50
  // @ac: 3
  it('brings the result card into view', async () => {
    api.listEquipment.mockResolvedValue(TYPES)
    api.checkAvailability.mockResolvedValue(RESULT)
    Element.prototype.scrollIntoView.mockClear()
    render(<EquipmentPage />)
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('equipment-check-start-input'), '2027-02-15T10:00')
    await user.type(screen.getByTestId('equipment-check-end-input'), '2027-02-15T13:00')
    await user.click(screen.getByTestId('equipment-check-button'))

    const card = await screen.findByTestId('equipment-check-result')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView.mock.contexts).toContain(card)
  })

  // @story: SCRUM-50
  // @ac: 1
  it('checks the first type when none was picked', async () => {
    api.listEquipment.mockResolvedValue(TYPES)
    api.checkAvailability.mockResolvedValue(RESULT)
    render(<EquipmentPage />)
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('equipment-check-start-input'), '2027-02-15T10:00')
    await user.type(screen.getByTestId('equipment-check-end-input'), '2027-02-15T13:00')
    await user.click(screen.getByTestId('equipment-check-button'))

    await waitFor(() => expect(api.checkAvailability).toHaveBeenCalledWith('1', expect.any(Object)))
  })

  // @story: SCRUM-50
  // @ac: 1
  it('shows the API refusal in the banner and no result', async () => {
    api.listEquipment.mockResolvedValue(TYPES)
    api.checkAvailability.mockRejectedValue(new Error('The start must be before the end.'))
    render(<EquipmentPage />)
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('equipment-check-start-input'), '2027-02-15T12:00')
    await user.type(screen.getByTestId('equipment-check-end-input'), '2027-02-15T10:00')
    await user.click(screen.getByTestId('equipment-check-button'))

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent('The start must be before the end.')
    expect(screen.queryByTestId('equipment-check-result')).not.toBeInTheDocument()
  })

  // @story: SCRUM-50
  // @ac: 1
  it('clears the earlier result when a new check is refused', async () => {
    api.listEquipment.mockResolvedValue(TYPES)
    api.checkAvailability
      .mockResolvedValueOnce(RESULT)
      .mockRejectedValueOnce(new Error('A start and an end are required.'))
    render(<EquipmentPage />)
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('equipment-check-start-input'), '2027-02-15T10:00')
    await user.type(screen.getByTestId('equipment-check-end-input'), '2027-02-15T13:00')
    await user.click(screen.getByTestId('equipment-check-button'))
    expect(await screen.findByTestId('equipment-check-result')).toBeInTheDocument()

    await user.clear(screen.getByTestId('equipment-check-end-input'))
    await user.click(screen.getByTestId('equipment-check-button'))

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent('A start and an end are required.')
    expect(screen.queryByTestId('equipment-check-result')).not.toBeInTheDocument()
  })

  // @story: SCRUM-50
  // @ac: 9
  it('offers an account without equipment.check no check form', async () => {
    features = ['equipment.view']
    api.listEquipment.mockResolvedValue(TYPES)
    render(<EquipmentPage />)

    await screen.findByTestId('equipment-name-1')
    expect(screen.queryByTestId('equipment-check-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('equipment-check-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-50
  // @ac: 1
  it('offers no check form when there are no types to check', async () => {
    api.listEquipment.mockResolvedValue([])
    render(<EquipmentPage />)

    await screen.findByTestId('equipment-empty')
    expect(screen.queryByTestId('equipment-check-form')).not.toBeInTheDocument()
  })
})
