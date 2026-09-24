import { useAuth } from './auth'

// Home for an account that may open no page yet (today: Technical Support
// Staff). It sits inside the layout, so the account still sees who it is
// logged in as and can log out (docs/design/ui-guidelines.md §1).
export default function HomePage() {
  const { account } = useAuth()

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="home-title">
          Welcome, {account.username}
        </h1>
      </div>

      <div className="card">
        <p className="empty-state" data-testid="home-message">
          There is nothing for your role to do here yet.
        </p>
      </div>
    </div>
  )
}
