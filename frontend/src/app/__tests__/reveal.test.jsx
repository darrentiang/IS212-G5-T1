import { describe, it, expect, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReveal, useRevealError } from '../reveal'

beforeEach(() => {
  Element.prototype.scrollIntoView.mockClear()
})

function Opener({ selector }) {
  const [open, setOpen] = useState(null)
  const ref = useReveal(open, selector)
  return (
    <>
      <button type="button" onClick={() => setOpen('a')}>open a</button>
      <button type="button" onClick={() => setOpen('b')}>open b</button>
      <button type="button" onClick={() => setOpen(null)}>close</button>
      {open && (
        <form ref={ref} data-testid="form">
          <p>{open}</p>
          <button type="button">Cancel</button>
          <input data-testid="first" />
          <input data-testid="second" />
        </form>
      )}
    </>
  )
}

function Checked() {
  const [errors, setErrors] = useState({})
  const [count, setCount] = useState(0)
  const ref = useReveal(null)
  useRevealError(ref, errors)
  return (
    <form ref={ref}>
      <div>
        <input data-testid="name" />
      </div>
      <div data-testid="location-field">
        <input data-testid="location" />
        {errors.location && <p className="field-error">Location is required</p>}
      </div>
      <button type="button" onClick={() => setErrors({ location: 'x' })}>check</button>
      <button type="button" onClick={() => setCount(count + 1)}>rerender {count}</button>
    </form>
  )
}

describe('useReveal', () => {
  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('scrolls an opened form into view only as far as needed and focuses its first field', async () => {
    render(<Opener />)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('open a'))

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('form'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(screen.getByTestId('first')).toHaveFocus()
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('reveals again when what is open changes, and not when it closes', async () => {
    render(<Opener />)
    await userEvent.click(screen.getByText('open a'))
    await userEvent.click(screen.getByText('open b'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)

    await userEvent.click(screen.getByText('close'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('focuses what the selector names, such as a confirmation\u2019s Cancel button', async () => {
    render(<Opener selector="button" />)

    await userEvent.click(screen.getByText('open a'))

    expect(screen.getByText('Cancel')).toHaveFocus()
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('scrolls without moving focus when the selector is null', async () => {
    render(<Opener selector={null} />)

    await userEvent.click(screen.getByText('open a'))

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(screen.getByText('open a')).toHaveFocus()
  })
})

describe('useRevealError', () => {
  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('brings the first field with a message into view and focuses it, on every failed check', async () => {
    render(<Checked />)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('check'))
    expect(Element.prototype.scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('location-field'))
    expect(screen.getByTestId('location')).toHaveFocus()

    await userEvent.click(screen.getByText(/rerender/))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByText('check'))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('location')).toHaveFocus()
  })
})
