import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../api'
import { ApiError } from '../../../app/http'
import EquipmentPage from '../EquipmentPage'

vi.mock('../api')

// SCRUM-52: the Out of service column, and Withdraw and Return on each row for
// an account with equipment.edit. The API is still the authority (ADR-002).
let features = ['equipment.view', 'equipment.edit']
vi.mock('../../../app/auth', () => ({
  useAuth: () => ({ can: (feature) => features.includes(feature) }),
}))

const SPEAKERS = {
  id: 7, name: 'Stage Speakers', description: '', location: 'Equipment Store B',
  total_units: 8, out_of_service_units: 0,
}

const SHORT = [
  { event_request_id: 31, name: 'Stage Show', date: '2026-12-05', start_time: '10:00', end_time: '12:00',
    reserved_units: 5, coordinator: 'coord1' },
  { event_request_id: 32, name: 'Nobody Talk', date: '2026-12-06', start_time: '09:00', end_time: '11:00',
    reserved_units: 7, coordinator: null },
]

afterEach(() => {
  features = ['equipment.view', 'equipment.edit']
  vi.restoreAllMocks()
})

async function renderPage(rows = [SPEAKERS]) {
  api.listEquipment.mockResolvedValue(rows)
  render(<EquipmentPage />)
  await screen.findByTestId(`equipment-row-${rows[0].id}`)
}

async function fillWithdraw(user, quantity, reason) {
  await user.click(screen.getByTestId('equipment-withdraw-button-7'))
  if (quantity) await user.type(screen.getByTestId('equipment-withdraw-quantity-input'), quantity)
  if (reason) await user.type(screen.getByTestId('equipment-withdraw-reason-input'), reason)
  await user.click(screen.getByTestId('equipment-withdraw-save-button'))
}

describe('EquipmentPage — withdraw and return (SCRUM-52)', () => {
  // @story: SCRUM-52
  // @ac: 3, 8
  it('shows units out of service to a reader without equipment.edit, and no Withdraw or Return', async () => {
    features = ['equipment.view']
    await renderPage([{ ...SPEAKERS, out_of_service_units: 1 }])

    expect(screen.getByTestId('equipment-out-of-service-7')).toHaveTextContent('1 out of service')
    expect(screen.queryByTestId('equipment-withdraw-button-7')).not.toBeInTheDocument()
    expect(screen.queryByTestId('equipment-return-button-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 1, 6, 8
  it('offers Withdraw and Return beside Change total to an account with equipment.edit', async () => {
    await renderPage()

    expect(screen.getByTestId('equipment-out-of-service-7')).toHaveTextContent('0 out of service')
    expect(screen.getByTestId('equipment-edit-button-7')).toBeInTheDocument()
    expect(screen.getByTestId('equipment-withdraw-button-7')).toHaveTextContent('Withdraw')
    expect(screen.getByTestId('equipment-return-button-7')).toHaveTextContent('Return')
  })

  // @story: SCRUM-52
  // @ac: 1
  it('catches a blank quantity and reason under their fields and sends nothing', async () => {
    const user = userEvent.setup()
    await renderPage()

    await fillWithdraw(user, '', '   ')

    expect(screen.getByTestId('equipment-withdraw-quantity-error')).toHaveTextContent('Quantity is required')
    expect(screen.getByTestId('equipment-withdraw-reason-error')).toHaveTextContent('Reason is required')
    expect(api.withdrawFromService).not.toHaveBeenCalled()
    expect(screen.getByTestId('equipment-withdraw-reason-input')).toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 1, 4
  it('withdraws, acknowledges it, re-reads the inventory and lists the events left short', async () => {
    const user = userEvent.setup()
    await renderPage()
    api.withdrawFromService.mockResolvedValue({
      equipment: { ...SPEAKERS, out_of_service_units: 2 }, shortfalls: SHORT,
    })
    api.listEquipment.mockResolvedValue([{ ...SPEAKERS, out_of_service_units: 2 }])

    await fillWithdraw(user, '2', 'Water damage')

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent('Equipment withdrawn from service')
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'status')
    expect(api.withdrawFromService).toHaveBeenCalledWith(7, { quantity: '2', reason: 'Water damage' })
    expect(screen.queryByTestId('equipment-withdraw-quantity-input')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-out-of-service-7')).toHaveTextContent('2 out of service')
    })
    expect(api.listEquipment).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('equipment-shortfall-name-31')).toHaveTextContent('Stage Show')
    expect(screen.getByTestId('equipment-shortfall-period-31')).toHaveTextContent('05 Dec 2026, 10:00–12:00')
    expect(screen.getByTestId('equipment-shortfall-reserved-31')).toHaveTextContent('5')
    expect(screen.getByTestId('equipment-shortfall-coordinator-31')).toHaveTextContent('coord1')
    expect(screen.getByTestId('equipment-shortfall-coordinator-32')).toHaveTextContent('None')
  })

  // @story: SCRUM-52
  // @ac: 4
  it('lists no event when the withdrawal leaves every event covered', async () => {
    const user = userEvent.setup()
    await renderPage()
    api.withdrawFromService.mockResolvedValue({ equipment: { ...SPEAKERS, out_of_service_units: 1 }, shortfalls: [] })

    await fillWithdraw(user, '1', 'Cone damaged')

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent('Equipment withdrawn from service')
    expect(screen.queryByTestId('equipment-shortfalls')).not.toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 4
  it('clears the list of events left short with the banner', async () => {
    const user = userEvent.setup()
    await renderPage()
    api.withdrawFromService.mockResolvedValue({ equipment: SPEAKERS, shortfalls: SHORT })
    await fillWithdraw(user, '2', 'Water damage')
    await screen.findByTestId('equipment-shortfalls')

    await user.click(screen.getByTestId('equipment-banner-dismiss'))

    expect(screen.queryByTestId('equipment-shortfalls')).not.toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 2
  it('shows a quantity refusal in the banner and leaves the form open with what was typed', async () => {
    const user = userEvent.setup()
    await renderPage()
    api.withdrawFromService.mockRejectedValue(new ApiError(400, 'Quantity must be a whole number from 1 to 8.'))

    await fillWithdraw(user, '9', 'Cone damaged')

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent(
      'Quantity must be a whole number from 1 to 8.',
    )
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('equipment-withdraw-quantity-input')).toHaveValue(9)
    expect(screen.getByTestId('equipment-withdraw-reason-input')).toHaveValue('Cone damaged')
    expect(screen.getByTestId('equipment-out-of-service-7')).toHaveTextContent('0 out of service')
  })

  // @story: SCRUM-52
  // @ac: 6
  it('returns units with a quantity alone and acknowledges it', async () => {
    const user = userEvent.setup()
    await renderPage([{ ...SPEAKERS, out_of_service_units: 2 }])
    api.returnToService.mockResolvedValue(SPEAKERS)
    api.listEquipment.mockResolvedValue([SPEAKERS])

    await user.click(screen.getByTestId('equipment-return-button-7'))
    expect(screen.queryByTestId('equipment-withdraw-reason-input')).not.toBeInTheDocument()
    await user.type(screen.getByTestId('equipment-return-quantity-input'), '2')
    await user.click(screen.getByTestId('equipment-return-save-button'))

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent('Equipment returned to service')
    expect(api.returnToService).toHaveBeenCalledWith(7, { quantity: '2' })
    await waitFor(() => {
      expect(screen.getByTestId('equipment-out-of-service-7')).toHaveTextContent('0 out of service')
    })
    expect(screen.queryByTestId('equipment-return-quantity-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 6
  it('catches a blank return quantity, and shows a refusal with the form left open', async () => {
    const user = userEvent.setup()
    await renderPage([{ ...SPEAKERS, out_of_service_units: 2 }])
    api.returnToService.mockRejectedValue(new ApiError(400, 'Quantity must be a whole number from 1 to 2.'))

    await user.click(screen.getByTestId('equipment-return-button-7'))
    await user.click(screen.getByTestId('equipment-return-save-button'))
    expect(screen.getByTestId('equipment-return-quantity-error')).toHaveTextContent('Quantity is required')
    expect(api.returnToService).not.toHaveBeenCalled()

    await user.type(screen.getByTestId('equipment-return-quantity-input'), '3')
    await user.click(screen.getByTestId('equipment-return-save-button'))

    expect(await screen.findByTestId('equipment-banner')).toHaveTextContent(
      'Quantity must be a whole number from 1 to 2.',
    )
    expect(screen.queryByTestId('equipment-return-quantity-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-return-quantity-input')).toHaveValue(3)
  })

  // @story: SCRUM-52
  // @ac: 1, 6
  it('keeps one inline form open at a time and closes it on Cancel', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.click(screen.getByTestId('equipment-edit-button-7'))
    await user.click(screen.getByTestId('equipment-withdraw-button-7'))
    expect(screen.queryByTestId('equipment-edit-units-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-withdraw-quantity-input')).toHaveFocus()

    await user.click(screen.getByTestId('equipment-return-button-7'))
    expect(screen.queryByTestId('equipment-withdraw-quantity-input')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('equipment-edit-button-7'))
    expect(screen.queryByTestId('equipment-return-quantity-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-edit-units-input')).toBeInTheDocument()

    await user.click(screen.getByTestId('equipment-withdraw-button-7'))
    await user.click(screen.getByTestId('equipment-withdraw-cancel-button'))
    expect(screen.queryByTestId('equipment-withdraw-quantity-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-52
  // @ac: 1
  it('disables every row control while a withdrawal and its refresh are pending', async () => {
    const user = userEvent.setup()
    await renderPage()
    let finish
    api.withdrawFromService.mockReturnValue(new Promise((resolve) => { finish = resolve }))

    await fillWithdraw(user, '1', 'Cone damaged')

    expect(screen.getByTestId('equipment-withdraw-save-button')).toBeDisabled()
    expect(screen.getByTestId('equipment-withdraw-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('equipment-withdraw-quantity-input')).toBeDisabled()
    expect(screen.getByTestId('equipment-withdraw-reason-input')).toBeDisabled()
    expect(screen.getByTestId('equipment-return-button-7')).toBeDisabled()
    expect(screen.getByTestId('equipment-edit-button-7')).toBeDisabled()
    finish({ equipment: SPEAKERS, shortfalls: [] })
    await waitFor(() => expect(screen.getByTestId('equipment-withdraw-button-7')).toBeEnabled())
  })
})
