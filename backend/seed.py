"""Create and populate the development database.

Used two ways:

* ``seed_database(db, data_path)`` is called by this script and by the pytest
  ``app`` fixture, so a developer's database and a test database hold exactly
  the same standing data.
* As a command line script:

      python seed.py            create and seed the database if it is absent
      python seed.py --reset    delete the database file and recreate it

The script never partially updates an existing database. A database that is
already seeded is left untouched; a database at a different schema version is
rebuilt with --reset.
"""

import argparse
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import db
from models import (
    SCHEMA_VERSION,
    AccessibilityFeature,
    Account,
    EventRequest,
    Facility,
    Notification,
    Role,
    RoomLayout,
    SchemaMeta,
    Venue,
)

DEFAULT_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed", "data.json")


class AlreadySeededError(RuntimeError):
    """Raised when asked to seed a database that already holds seed data."""


def parse_time(value):
    """'08:00' from the seed file to a time, or None when it is absent."""
    if value is None:
        return None
    return datetime.strptime(value, "%H:%M").time()


def parse_datetime(value):
    """ISO datetime from the seed file, or None when it is absent."""
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def seed_database(db, data_path=DEFAULT_DATA_PATH):
    """Create the tables, insert the seed data and record the schema version.

    Raises AlreadySeededError if the database already holds seed data; nothing
    is written in that case. Any other failure is rolled back, so the database
    is never left half seeded.
    """
    db.create_all()

    already_seeded = (
        db.session.query(SchemaMeta).first() is not None
        or db.session.query(Role).first() is not None
    )
    if already_seeded:
        raise AlreadySeededError(
            "Database is already seeded; nothing was changed. Run: python seed.py --reset"
        )

    with open(data_path, encoding="utf-8") as handle:
        data = json.load(handle)

    try:
        roles = {}
        for name in data["roles"]:
            role = Role(name=name)
            roles[name] = role
            db.session.add(role)

        accounts = {}
        for entry in data["accounts"]:
            account = Account(
                username=entry["username"],
                organisation=entry.get("organisation"),
            )
            account.set_password(entry["password"])
            account.roles = [roles[name] for name in entry["roles"]]
            db.session.add(account)
            accounts[entry["username"]] = account

        db.session.flush()

        # The fixed lists come first: event requests (SCRUM-42) and venues link to them.
        facilities = {}
        for name in data.get("facilities", []):
            facility = Facility(name=name)
            facilities[name] = facility
            db.session.add(facility)

        accessibility_features = {}
        for name in data.get("accessibility_features", []):
            feature = AccessibilityFeature(name=name)
            accessibility_features[name] = feature
            db.session.add(feature)

        layouts = {}
        for name in data.get("layouts", []):
            layout = RoomLayout(name=name)
            layouts[name] = layout
            db.session.add(layout)

        event_requests = {}
        for entry in data.get("event_requests", []):
            owner = accounts[entry["created_by"]]
            optional_fields = {
                field: entry[field] for field in EventRequest.REQUIRED_FIELDS if field in entry
            }
            event_request = EventRequest(
                name=entry["name"],
                purpose=entry.get("purpose"),
                status=entry["status"],
                created_by=owner,
                registration_enabled=bool(entry.get("registration_enabled", False)),
                coordinator_notes=entry.get("coordinator_notes"),
                submitted_at=parse_datetime(entry.get("submitted_at")),
                # SCRUM-43: standing events already assigned to a coordinator,
                # so the open-event counts have something to count.
                assigned_coordinator=(
                    accounts[entry["assigned_coordinator"]]
                    if entry.get("assigned_coordinator")
                    else None
                ),
                assigned_at=parse_datetime(entry.get("assigned_at")),
                # SCRUM-42: the optional requirements chosen from the fixed lists.
                layout=layouts[entry["layout"]] if entry.get("layout") else None,
                facilities=[facilities[name] for name in entry.get("facilities", [])],
                accessibility_features=[
                    accessibility_features[name]
                    for name in entry.get("accessibility_features", [])
                ],
                **{k: v for k, v in optional_fields.items() if k not in ("name", "purpose")},
            )
            db.session.add(event_request)
            event_requests[entry["name"]] = event_request

        for entry in data.get("venues", []):
            db.session.add(
                Venue(
                    name=entry["name"],
                    location=entry["location"],
                    max_capacity=entry["max_capacity"],
                    opening_time=parse_time(entry.get("opening_time")),
                    closing_time=parse_time(entry.get("closing_time")),
                    setup_time=entry.get("setup_time", 0),
                    turnaround_time=entry.get("turnaround_time", 0),
                    facilities=[facilities[name] for name in entry.get("facilities", [])],
                    accessibility_features=[
                        accessibility_features[name]
                        for name in entry.get("accessibility_features", [])
                    ],
                )
            )

        # SCRUM-58: standing notifications, so the inbox has rows to show.
        # Stories that notify someone add theirs with
        # notifications.create_notification().
        for entry in data.get("notifications", []):
            db.session.add(
                Notification(
                    recipient=accounts[entry["recipient"]],
                    event_request=event_requests[entry["event"]] if entry.get("event") else None,
                    message=entry["message"],
                    created_at=parse_datetime(entry["created_at"]),
                    read_at=parse_datetime(entry.get("read_at")),
                )
            )

        db.session.add(SchemaMeta(version=SCHEMA_VERSION))
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    return SCHEMA_VERSION


def sqlite_path(uri):
    """The file behind a SQLite connection string, or None if there is no file."""
    prefix = "sqlite:///"
    if not uri.startswith(prefix) or uri.endswith(":memory:"):
        return None
    return uri[len(prefix):]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create and seed the ConnectSphere database.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete the database file and recreate it from the seed data",
    )
    args = parser.parse_args(argv)

    # Imported here so that --reset deletes a database at the wrong schema
    # version before create_app has a chance to refuse to start on it.
    from app import create_app, default_database_uri

    uri = default_database_uri()
    path = sqlite_path(uri)

    if args.reset:
        if path and os.path.exists(path):
            os.remove(path)
            print(f"Deleted {path}")
        elif path:
            print(f"No database at {path}; creating it")

    try:
        app = create_app()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1

    with app.app_context():
        try:
            version = seed_database(db)
        except AlreadySeededError:
            stored = db.session.query(SchemaMeta).first()
            print(f"already seeded (schema v{stored.version})")
            return 0
        print(f"Seeded {path or uri} (schema v{version})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
