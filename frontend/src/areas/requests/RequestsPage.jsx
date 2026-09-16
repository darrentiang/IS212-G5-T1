// Placeholder so the scaffold has a landing page; replaced by SCRUM-28/29.
// It follows the page anatomy in docs/design/ui-guidelines.md §3 — title row,
// then content — so that it is the example every real page copies.
export default function RequestsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900" data-testid="requests-title">
          Requests
        </h1>
        {/* SCRUM-28 adds the New request button here, at the right of this row. */}
      </div>

      <p className="text-gray-600" data-testid="requests-empty">
        No requests yet.
      </p>
    </div>
  )
}
