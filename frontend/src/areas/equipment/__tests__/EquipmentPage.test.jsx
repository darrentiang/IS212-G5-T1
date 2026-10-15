import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../api'
import { ApiError } from '../../../app/http'
import EquipmentPage from '../EquipmentPage'

vi.mock('../api')

// The page asks the shared account context which controls to show; the API
// is still the authority (ADR-002).
let features = ['equipment.view', 'equipment.edit']
vi.mock('../../../app/auth', () => ({
  useAuth: () => ({ can: (feature) => features.includes(feature) }),
}))

const TYPE = { id: 1, name: 'Projector', total_units: 10 }

afterEach(() => {
  features = ['equipment.view', 'equipment.edit']
  vi.restoreAllMocks()
})

function renderPage() {
  render(<EquipmentPage />)
}

describe('EquipmentPage', () => {
  // @story: SCRUM-49
  // @ac: 1
  it('lists every type with its total units', async () => {
    api.listEquipment.mockResolvedValue([TYPE])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-name-1')).toHaveTextContent('Projector')
    })
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
    expect(screen.getByTestId('equipment-row-1')).toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 1
  it('shows the empty message when there are no types', async () => {
    api.listEquipment.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-empty')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-49
  // @ac: 1
  it('reads the total in the singular for exactly one unit', async () => {
    api.listEquipment.mockResolvedValue([{ id: 2, name: 'Solo', total_units: 1 }])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-units-2')).toHaveTextContent('1 unit')
    })
    expect(screen.getByTestId('equipment-units-2')).not.toHaveTextContent('1 units')
  })

  // @story: SCRUM-49
  // @ac: 1, 5
  it('shows a load refusal in the banner and never as an empty inventory', async () => {
    api.listEquipment.mockRejectedValue(new ApiError(500, 'Something went wrong'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Something went wrong',
      )
    })
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('equipment-empty')).not.toBeInTheDocument()
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.listEquipment.mockRejectedValue(new ApiError(500, 'Something went wrong'))
    renderPage()
    await screen.findByTestId('equipment-banner')

    await userEvent.click(screen.getByTestId('equipment-banner-dismiss'))

    expect(screen.queryByTestId('equipment-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 2, 7
  it('offers Change total to an account with equipment.edit', async () => {
    api.listEquipment.mockResolvedValue([TYPE])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-49
  // @ac: 1, 7
  it('offers no change action to an account without equipment.edit', async () => {
    features = ['equipment.view']
    api.listEquipment.mockResolvedValue([TYPE])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('equipment-name-1')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('equipment-edit-button-1')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 2
  it('opens the inline form prefilled and closes it on Cancel', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    expect(screen.getByTestId('equipment-edit-units-input')).toHaveValue(10)

    await user.click(screen.getByTestId('equipment-edit-cancel-button'))
    expect(screen.queryByTestId('equipment-edit-units-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 3, 5
  it('catches a blank value under the field and sends nothing', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('equipment-edit-button-1'))

    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    expect(screen.getByTestId('equipment-edit-units-error')).toHaveTextContent(
      'Total units is required',
    )
    expect(api.updateTotalUnits).not.toHaveBeenCalled()
    expect(screen.getByTestId('equipment-edit-units-input')).toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 2, 6
  it('saves a new total, acknowledges it and shows it after the refresh', async () => {
    const user = userEvent.setup()
    api.listEquipment
      .mockResolvedValueOnce([TYPE])
      .mockResolvedValueOnce([{ ...TYPE, total_units: 8 }])
    api.updateTotalUnits.mockResolvedValue({ ...TYPE, total_units: 8 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '8')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Total units updated',
      )
    })
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'status')
    expect(api.updateTotalUnits).toHaveBeenCalledWith(1, { total_units: '8' })
    expect(screen.queryByTestId('equipment-edit-units-input')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('8 units')
    })
  })

  // @story: SCRUM-49
  // @ac: 3, 5
  it('shows an invalid-value refusal in the banner and keeps the form open', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])
    api.updateTotalUnits.mockRejectedValue(
      new ApiError(400, 'Total units must be zero or a positive whole number.'),
    )

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '1.5')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Total units must be zero or a positive whole number.',
      )
    })
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'alert')
    // The form stays open with what was typed, and nothing was stored.
    expect(screen.getByTestId('equipment-edit-units-input')).toHaveValue(1.5)
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
  })

  // @story: SCRUM-49
  // @ac: 4, 5
  it('shows a reservation-minimum refusal naming the required total', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])
    api.updateTotalUnits.mockRejectedValue(
      new ApiError(400, 'Total units cannot be reduced below 5 units: 5 units are reserved.'),
    )

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '4')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Total units cannot be reduced below 5 units: 5 units are reserved.',
      )
    })
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
  })

  // @story: SCRUM-49
  // @ac: 7
  it('renders the API message when the save is refused as unauthorised', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])
    api.updateTotalUnits.mockRejectedValue(
      new ApiError(403, 'You do not have permission to perform this action.'),
    )

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'You do not have permission to perform this action.',
      )
    })
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
  })

  // @story: SCRUM-49
  // @ac: 6
  it('acknowledges the save even when the refresh that follows refuses', async () => {
    const user = userEvent.setup()
    api.listEquipment
      .mockResolvedValueOnce([TYPE])
      .mockRejectedValueOnce(new ApiError(500, 'Something went wrong'))
    api.updateTotalUnits.mockResolvedValue({ ...TYPE, total_units: 8 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '8')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    // The acknowledgment never depends on the refresh…
    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Total units updated',
      )
    })
    // …and the stale rows are replaced by the unavailable notice, not left
    // on the page as though they were current.
    await waitFor(() => {
      expect(screen.getByTestId('equipment-unavailable')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('equipment-units-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-reload-button')).toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 6
  it('reloads the list from the unavailable notice', async () => {
    const user = userEvent.setup()
    api.listEquipment
      .mockResolvedValueOnce([TYPE])
      .mockRejectedValueOnce(new ApiError(500, 'Something went wrong'))
      .mockResolvedValueOnce([{ ...TYPE, total_units: 8 }])
    api.updateTotalUnits.mockResolvedValue({ ...TYPE, total_units: 8 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.click(screen.getByTestId('equipment-edit-save-button'))
    await waitFor(() => {
      expect(screen.getByTestId('equipment-unavailable')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-reload-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('8 units')
    })
    expect(screen.queryByTestId('equipment-unavailable')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 6
  it('keeps the unavailable notice and shows the banner when Reload itself refuses', async () => {
    const user = userEvent.setup()
    api.listEquipment
      .mockResolvedValueOnce([TYPE])
      .mockRejectedValueOnce(new ApiError(500, 'Something went wrong'))
      .mockRejectedValueOnce(new ApiError(500, 'Still broken'))
    api.updateTotalUnits.mockResolvedValue({ ...TYPE, total_units: 8 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.click(screen.getByTestId('equipment-edit-save-button'))
    await waitFor(() => {
      expect(screen.getByTestId('equipment-unavailable')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-reload-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent('Still broken')
    })
    expect(screen.getByTestId('equipment-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('equipment-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('equipment-units-1')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 2, 3
  it('sends the typed value as a string and disables the buttons while saving', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])
    let resolveSave
    api.updateTotalUnits.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-button-1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '3')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('equipment-edit-save-button')).toBeDisabled()
    })
    expect(screen.getByTestId('equipment-edit-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('equipment-edit-units-input')).toBeDisabled()
    expect(api.updateTotalUnits).toHaveBeenCalledWith(1, { total_units: '3' })

    resolveSave({ ...TYPE, total_units: 3 })
    await waitFor(() => {
      expect(screen.getByTestId('equipment-banner')).toHaveTextContent(
        'Total units updated',
      )
    })
  })

  // @story: SCRUM-49
  // @ac: 1, 6
  it('can retry an initial inventory read failure', async () => {
    const user = userEvent.setup()
    api.listEquipment
      .mockRejectedValueOnce(new ApiError(500, 'Inventory unavailable'))
      .mockResolvedValueOnce([TYPE])

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('equipment-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByTestId('equipment-banner')).toHaveTextContent('Inventory unavailable')
    expect(screen.queryByTestId('equipment-empty')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('equipment-reload-button'))
    await waitFor(() => {
      expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
    })
    expect(screen.queryByTestId('equipment-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('equipment-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 2, 6
  it('prevents switching stock editors while a save and its refresh are pending', async () => {
    const user = userEvent.setup()
    const other = { id: 2, name: 'Microphones', total_units: 20 }
    let resolveSave
    let resolveRefresh
    api.listEquipment
      .mockResolvedValueOnce([TYPE, other])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    api.updateTotalUnits.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve }),
    )

    renderPage()
    await screen.findByTestId('equipment-edit-button-1')
    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '8')
    await user.click(screen.getByTestId('equipment-edit-save-button'))

    expect(screen.getByTestId('equipment-edit-button-2')).toBeDisabled()
    expect(screen.getByTestId('equipment-edit-units-input')).toBeDisabled()
    await user.click(screen.getByTestId('equipment-edit-button-2'))
    expect(screen.getByTestId('equipment-edit-units-input')).toHaveValue(8)
    expect(api.updateTotalUnits).toHaveBeenCalledTimes(1)
    expect(api.updateTotalUnits).toHaveBeenCalledWith(1, { total_units: '8' })

    await act(async () => resolveSave({ ...TYPE, total_units: 8 }))
    expect(screen.getByTestId('equipment-banner')).toHaveTextContent('Total units updated')
    expect(screen.queryByTestId('equipment-edit-units-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-edit-button-1')).toBeDisabled()
    expect(screen.getByTestId('equipment-edit-button-2')).toBeDisabled()

    await act(async () => resolveRefresh([{ ...TYPE, total_units: 8 }, other]))
    expect(screen.getByTestId('equipment-edit-button-2')).toBeEnabled()
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('8 units')
    expect(screen.getByTestId('equipment-units-2')).toHaveTextContent('20 units')
    await user.click(screen.getByTestId('equipment-edit-button-2'))
    expect(screen.getByTestId('equipment-edit-units-input')).toHaveValue(20)
  })

  // @story: SCRUM-49
  // @ac: 7
  it('hides an already-open stock editor if editing permission is removed', async () => {
    const user = userEvent.setup()
    api.listEquipment.mockResolvedValue([TYPE])
    const { rerender } = render(<EquipmentPage />)
    await screen.findByTestId('equipment-edit-button-1')
    await user.click(screen.getByTestId('equipment-edit-button-1'))
    expect(screen.getByTestId('equipment-edit-units-input')).toBeInTheDocument()

    features = ['equipment.view']
    rerender(<EquipmentPage />)
    expect(screen.queryByTestId('equipment-edit-units-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('equipment-edit-button-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
    expect(api.updateTotalUnits).not.toHaveBeenCalled()
  })

  // @story: SCRUM-49
  // @ac: 6
  it('ignores a discarded initial load arriving after a successful stock save', async () => {
    const user = userEvent.setup()
    let resolveOldLoad
    api.listEquipment
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldLoad = resolve }))
      .mockResolvedValueOnce([TYPE])
      .mockResolvedValueOnce([{ ...TYPE, total_units: 8 }])
    api.updateTotalUnits.mockResolvedValueOnce({ ...TYPE, total_units: 8 })

    render(<StrictMode><EquipmentPage /></StrictMode>)
    await screen.findByTestId('equipment-edit-button-1')
    await user.click(screen.getByTestId('equipment-edit-button-1'))
    await user.clear(screen.getByTestId('equipment-edit-units-input'))
    await user.type(screen.getByTestId('equipment-edit-units-input'), '8')
    await user.click(screen.getByTestId('equipment-edit-save-button'))
    await waitFor(() => {
      expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('8 units')
      expect(screen.getByTestId('equipment-edit-button-1')).toBeEnabled()
    })

    await act(async () => resolveOldLoad([TYPE]))
    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('8 units')
    expect(screen.getByTestId('equipment-banner')).toHaveTextContent('Total units updated')
    expect(screen.queryByTestId('equipment-unavailable')).not.toBeInTheDocument()
  })

  // @story: SCRUM-49
  // @ac: 1
  it('ignores a discarded initial read refusal after the current load succeeds', async () => {
    let rejectOldLoad
    api.listEquipment
      .mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOldLoad = reject }))
      .mockResolvedValueOnce([TYPE])

    render(<StrictMode><EquipmentPage /></StrictMode>)
    await screen.findByTestId('equipment-units-1')
    await act(async () => rejectOldLoad(new ApiError(500, 'Old read failed')))

    expect(screen.getByTestId('equipment-units-1')).toHaveTextContent('10 units')
    expect(screen.queryByTestId('equipment-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('equipment-unavailable')).not.toBeInTheDocument()
  })
})

describe('EquipmentPage feedback at the point of action', () => {
  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens Change total as the row below in view, with its field focused', async () => {
    api.listEquipment.mockResolvedValue([TYPE])
    renderPage()

    await userEvent.click(await screen.findByTestId('equipment-edit-button-1'))

    const input = screen.getByTestId('equipment-edit-units-input')
    expect(input).toHaveFocus()
    expect(Element.prototype.scrollIntoView.mock.contexts.at(-1)).toContainElement(input)
  })
})
