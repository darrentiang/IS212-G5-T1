import { Link } from 'react-router'

// Shown in place of a page the account's features do not allow
// (docs/design/ui-guidelines.md §7). The address does not change.
export default function NotPermittedPage() {
  return (
    <div className="space-y-4">
      <p className="text-gray-900" data-testid="not-permitted-message">
        You do not have permission to open this page.
      </p>
      <Link
        to="/requests"
        className="text-blue-700 underline"
        data-testid="not-permitted-home-link"
      >
        Go to Requests
      </Link>
    </div>
  )
}
