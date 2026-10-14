import { useEffect, useRef } from 'react'

// Feedback at the point of action (docs/design/ui-guidelines.md §13): what a
// control opens or shows is brought into view and, when it has a field,
// focused, so the user never scrolls or searches to see what their click did.

const FIELD = 'input, select, textarea'

// Scrolls the element into view only as far as needed (the html element's
// scroll-padding keeps it clear of the sticky header), then focuses the first
// element matching selector inside it; a null selector focuses nothing.
export function reveal(element, selector = FIELD) {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (selector) element.querySelector(selector).focus({ preventScroll: true })
}

// Patterns A, A′ and B: reveal the returned ref's element each time `open`
// becomes or changes to a truthy value (a form opening, a confirmation, a
// fresh result list).
export function useReveal(open, selector = FIELD) {
  const ref = useRef(null)
  useEffect(() => {
    if (open && ref.current) reveal(ref.current, selector)
  }, [open, selector])
  return ref
}

// Pattern C: after a required-field check fails, reveal and focus the first
// field showing a message under it inside ref's element. Runs on every new
// errors value, so a second failed submit moves focus back again.
export function useRevealError(ref, errors) {
  useEffect(() => {
    const message = ref.current?.querySelector('.field-error')
    if (message) reveal(message.parentElement)
  }, [ref, errors])
}
