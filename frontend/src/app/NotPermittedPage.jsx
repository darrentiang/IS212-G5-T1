import { Link } from 'react-router'

// Shown in place of a page the account's features do not allow
// (docs/design/ui-guidelines.md §8). The address does not change.
// The link goes to '/', which App resolves to this account's home page; the
// page does not work that out for itself, so it stays independent of the
// route list.
export default function NotPermittedPage() {
  return (
    <div className="card">
      <div className="empty-state space-y-4">
        <p data-testid="not-permitted-message">You do not have permission to open this page.</p>

        <Link to="/" className="btn btn-secondary" data-testid="not-permitted-home-link">
          Go to your home page
        </Link>
      </div>
    </div>
  )
}
