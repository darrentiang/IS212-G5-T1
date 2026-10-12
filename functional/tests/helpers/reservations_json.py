"""Read-only inspection of reservation rows for SCRUM-49's functional tests.

Prints, as JSON on stdout, every reservation of the named equipment type(s),
in id order: id, type name, event name, quantity, date, start, end, status.
The spec snapshots this before a save and compares after it, to prove that a
save (or a refused save) left reservations untouched (TC-SCRUM-49-07 to 11).

Test-side only — no product endpoint exists or is added for this. The
database is opened READ-ONLY (file URI mode=ro) and resolved through the
same DATABASE_URL / instance/app.db logic the running application uses, so
the helper can never write and can never read a different database than the
one under test (SCRUM-49 plan §7).
"""

import json
import os
import sqlite3
import sys

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        ),
        "backend",
    ),
)

from app import default_database_uri  # noqa: E402


def main(type_names):
    uri = default_database_uri()
    prefix = "sqlite:///"
    if not uri.startswith(prefix) or uri.endswith(":memory:"):
        raise SystemExit(f"expected a file-backed sqlite database, got {uri!r}")
    path = os.path.abspath(uri[len(prefix):])
    if not os.path.exists(path):
        raise SystemExit(f"database not found: {path}")

    file_uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    connection = sqlite3.connect(file_uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        marks = ",".join("?" for _ in type_names)
        rows = connection.execute(
            f"""
            SELECT r.id, t.name AS equipment_type, e.name AS event,
                   r.quantity, r.date, r.start_time, r.end_time, r.status
            FROM reservations r
            JOIN equipment_types t ON t.id = r.equipment_type_id
            JOIN event_requests e ON e.id = r.event_request_id
            WHERE t.name IN ({marks})
            ORDER BY r.id
            """,
            list(type_names),
        ).fetchall()
    finally:
        connection.close()
    print(json.dumps([dict(row) for row in rows], indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: reservations_json.py <equipment type name> [...]")
    main(sys.argv[1:])
