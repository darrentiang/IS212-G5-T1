// The page banner (docs/design/ui-guidelines.md §4): one at a time, an error
// before a success, kept in view below the header wherever the user has
// scrolled. It never dismisses itself; the page clears it on the user's next
// action, and the dismiss control clears it at once.
export default function Banner({ page, error, success, onDismiss }) {
  const message = error || success
  if (!message) return null

  const isError = Boolean(error)
  return (
    <div className={`banner ${isError ? 'banner-error' : 'banner-success'}`}>
      {/* The test id stays on the message alone, so its text is the message word for word. */}
      <p
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        aria-atomic="true"
        className="banner-message"
        data-testid={`${page}-banner`}
      >
        {message}
      </p>
      <button
        type="button"
        className="banner-dismiss"
        aria-label="Dismiss message"
        onClick={onDismiss}
        data-testid={`${page}-banner-dismiss`}
      >
        ×
      </button>
    </div>
  )
}
