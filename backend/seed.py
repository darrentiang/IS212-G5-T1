"""Create and populate the development database.

Used three ways:

* ``seed_database(db, data_path)`` is called by this script and by the pytest
  ``app`` fixture, so a developer's database and a test database hold exactly
  the same standing data.
* ``apply_extra(db, data_path)`` appends test-owned fixture rows (types,
  events, reservations) to an already-seeded database — SCRUM-49's ``--extra``
  — with deterministic matching so a rerun never duplicates or overwrites.
* As a command line script:

      python seed.py            create and seed the database if it is absent
      python seed.py --reset    delete the database file and recreate it
      python seed.py --extra PATH   also append fixture rows from PATH

The script never partially updates an existing baseline: a database that is
already seeded is left untouched (unless ``--extra`` appends to it); a
database at a different schema version is rebuilt with --reset.
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
    EquipmentType,
    EventRequest,
    Facility,
    Notification,
    Reservation,
    Role,
    RoomLayout,
    SafetyDecision,
    SchemaMeta,
    Venue,
    VenueBookingRequest,
)

DEFAULT_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed", "data.json")


class AlreadySeededError(RuntimeError):
    """Raised when asked to seed a database that already holds seed data."""


class FixtureConflict(RuntimeError):
    """Raised when an existing record does not match the fixture file.

    ``apply_extra`` never overwrites and never repairs silently: a rerun with
    unchanged fixtures skips every existing row, while a database record that
    has diverged from the fixture definition is an error naming that record
    (SCRUM-49 implementation plan §2).
    """


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


def seed_database(db, data_path=DEFAULT_DATA_PATH, standing_bookings=True):
    """Create the tables, insert the seed data and record the schema version.

    ``standing_bookings`` is whether the venue booking requests in the seed file
    are inserted. A developer's database and the functional tests have them (an
    event in Safety Check needs Approved bookings to be reviewed, SCRUM-89); the
    pytest ``app`` fixture leaves them out, because the booking tests count and
    list every booking request and each creates exactly the ones it needs.

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
                # SCRUM-89: events already in Safety Check, so the Safety
                # Officer has something to list and decide. SCRUM-53 sets this
                # when it moves an event there.
                safety_check_at=parse_datetime(entry.get("safety_check_at")),
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

        venues = {}
        for entry in data.get("venues", []):
            venue = (
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
            venues[entry["name"]] = venue
            db.session.add(venue)

        # SCRUM-89: venue booking requests on the standing events, so a Safety
        # Officer opening an event in Safety Check sees its Approved bookings.
        # The date, times and attendance are copied from the event, as raising
        # a booking does (SCRUM-36 AC3).
        for entry in data.get("venue_bookings", []) if standing_bookings else []:
            event_request = event_requests[entry["event"]]
            db.session.add(
                VenueBookingRequest(
                    venue=venues[entry["venue"]],
                    event_request=event_request,
                    status=entry["status"],
                    date=event_request.date,
                    start_time=event_request.start_time,
                    end_time=event_request.end_time,
                    attendance=event_request.attendance,
                    raised_by=accounts[entry["raised_by"]],
                    raised_at=parse_datetime(entry["raised_at"]),
                    decision=entry["status"] if entry.get("decided_by") else None,
                    decision_reason=entry.get("decision_reason"),
                    decided_at=parse_datetime(entry.get("decided_at")),
                    decided_by=accounts[entry["decided_by"]] if entry.get("decided_by") else None,
                )
            )

        # SCRUM-89: decisions the Safety Officer already made, so "earlier
        # decisions stay visible" has a standing example.
        for entry in data.get("safety_decisions", []):
            db.session.add(
                SafetyDecision(
                    event_request=event_requests[entry["event"]],
                    decision=entry["decision"],
                    reason=entry.get("reason"),
                    notes=entry.get("notes", {}),
                    areas=entry.get("areas", []),
                    decided_at=parse_datetime(entry["decided_at"]),
                    decided_by=accounts[entry["decided_by"]],
                )
            )

        for entry in data.get("equipment_types", []):
            db.session.add(
                EquipmentType(
                    name=entry["name"],
                    description=entry.get("description", ""),
                    location=entry.get("location", ""),
                    total_units=entry["total_units"],
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


EVENT_FIXTURE_FIELDS = (
    "status",
    "date",
    "start_time",
    "end_time",
    "attendance",
    "purpose",
    "description",
    "equipment_requirements",
)


def _parse_fixture_period(date, start_time, end_time, where):
    """A complete, valid period from fixture text, else raise FixtureConflict.

    A reservation's snapshot period must be a real date, HH:MM times and a
    start strictly before its end (state-model.md v1.7, "Equipment
    reservation"); the same rule guards a fixture event, whose period any
    reservation of it copies.
    """
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
        start = datetime.strptime(start_time, "%H:%M").time()
        end = datetime.strptime(end_time, "%H:%M").time()
    except (TypeError, ValueError):
        raise FixtureConflict(
            f"{where}: period must be yyyy-mm-dd with HH:MM times, got "
            f"{date!r} {start_time!r}-{end_time!r}"
        ) from None
    if start >= end:
        raise FixtureConflict(
            f"{where}: start time {start_time} must be before end time {end_time}"
        )
    return day, start, end


def apply_extra(db, data_path):
    """Append fixture rows from data_path to an already-seeded database.

    SCRUM-49's ``--extra`` mode. Idempotent by deterministic matching,
    never by blind insert:

    * ``equipment_types`` — matched by name. Absent: insert. Present: left
      completely untouched; stock is user-mutable, so a rerun never
      overwrites a total edited during a local run.
    * ``event_requests`` — matched by name. Absent: insert. Present: every
      field the fixture declares must equal the stored row, else
      FixtureConflict naming the event.
    * ``reservations`` — identified by the pair (equipment type name, event
      name), which must be unique inside the file. Absent: insert, with the
      period snapshotted from the linked event. Present: quantity and status
      must match and the stored period must still equal the event's period,
      else FixtureConflict. No product uniqueness constraint is involved:
      matching only ever runs against these namespaced fixture records.

    Returns the number of rows inserted. Any FixtureConflict rolls the whole
    import back — nothing is half applied, nothing is repaired silently.
    """
    with open(data_path, encoding="utf-8") as handle:
        data = json.load(handle)

    added = 0
    accounts = {row.username: row for row in db.session.query(Account).all()}
    try:
        for entry in data.get("equipment_types", []):
            name = entry.get("name")
            total = entry.get("total_units")
            if (
                not name
                or isinstance(total, bool)
                or not isinstance(total, int)
                or total < 0
            ):
                raise FixtureConflict(
                    f"equipment type {name!r}: total_units must be a non-negative whole number"
                )
            if db.session.query(EquipmentType).filter_by(name=name).first() is None:
                db.session.add(
                    EquipmentType(
                        name=name,
                        description=entry.get("description", ""),
                        location=entry.get("location", ""),
                        total_units=total,
                    )
                )
                added += 1
        db.session.flush()

        events = {}
        for entry in data.get("event_requests", []):
            name = entry.get("name")
            if not name:
                raise FixtureConflict("an event fixture is missing its name")
            for field in ("status", "date", "start_time", "end_time", "attendance"):
                if field not in entry:
                    raise FixtureConflict(f"event {name!r}: missing {field}")
            _parse_fixture_period(
                entry["date"], entry["start_time"], entry["end_time"], f"event {name!r}"
            )
            creator = accounts.get(entry.get("created_by"))
            if creator is None:
                raise FixtureConflict(
                    f"event {name!r}: unknown account {entry.get('created_by')!r}"
                )
            existing = db.session.query(EventRequest).filter_by(name=name).first()
            if existing is not None:
                for field in EVENT_FIXTURE_FIELDS:
                    if getattr(existing, field) != entry.get(field):
                        raise FixtureConflict(
                            f"event {name!r}: stored {field}={getattr(existing, field)!r} "
                            f"does not match fixture {entry.get(field)!r}"
                        )
                if existing.created_by.username != entry["created_by"]:
                    raise FixtureConflict(
                        f"event {name!r}: stored creator does not match fixture "
                        f"{entry['created_by']!r}"
                    )
                events[name] = existing
                continue
            row = EventRequest(
                name=name,
                status=entry["status"],
                created_by=creator,
                date=entry["date"],
                start_time=entry["start_time"],
                end_time=entry["end_time"],
                attendance=entry["attendance"],
                purpose=entry.get("purpose"),
                description=entry.get("description"),
                equipment_requirements=entry.get("equipment_requirements"),
            )
            db.session.add(row)
            events[name] = row
            added += 1
        db.session.flush()

        seen = set()
        for entry in data.get("reservations", []):
            type_name = entry.get("equipment_type")
            event_name = entry.get("event")
            if not type_name or not event_name:
                raise FixtureConflict(
                    "a reservation fixture is missing its equipment_type or event"
                )
            identity = (type_name, event_name)
            if identity in seen:
                raise FixtureConflict(
                    f"reservation {type_name!r} / {event_name!r}: duplicate identity "
                    f"in {data_path}"
                )
            seen.add(identity)

            equipment = (
                db.session.query(EquipmentType).filter_by(name=type_name).first()
            )
            event = events.get(event_name) or (
                db.session.query(EventRequest).filter_by(name=event_name).first()
            )
            if equipment is None:
                raise FixtureConflict(
                    f"reservation {type_name!r} / {event_name!r}: unknown equipment type"
                )
            if event is None:
                raise FixtureConflict(
                    f"reservation {type_name!r} / {event_name!r}: unknown event"
                )
            quantity = entry.get("quantity")
            if (
                isinstance(quantity, bool)
                or not isinstance(quantity, int)
                or quantity < 1
            ):
                raise FixtureConflict(
                    f"reservation {type_name!r} / {event_name!r}: quantity must be a "
                    f"whole number of at least 1"
                )
            status = entry.get("status", "Reserved")
            if status not in Reservation.STATUSES:
                raise FixtureConflict(
                    f"reservation {type_name!r} / {event_name!r}: status must be "
                    f"Reserved or Released"
                )
            _parse_fixture_period(
                event.date, event.start_time, event.end_time, f"event {event_name!r}"
            )

            existing = (
                db.session.query(Reservation)
                .filter_by(
                    equipment_type_id=equipment.id,
                    event_request_id=event.id,
                )
                .first()
            )
            if existing is not None:
                if existing.quantity != quantity or existing.status != status:
                    raise FixtureConflict(
                        f"reservation {type_name!r} / {event_name!r}: stored "
                        f"quantity={existing.quantity} status={existing.status!r} does "
                        f"not match fixture quantity={quantity} status={status!r}"
                    )
                if (existing.date, existing.start_time, existing.end_time) != (
                    event.date,
                    event.start_time,
                    event.end_time,
                ):
                    raise FixtureConflict(
                        f"reservation {type_name!r} / {event_name!r}: stored period does "
                        f"not match the event's period"
                    )
                continue
            db.session.add(
                Reservation(
                    equipment_type=equipment,
                    event_request=event,
                    quantity=quantity,
                    date=event.date,
                    start_time=event.start_time,
                    end_time=event.end_time,
                    status=status,
                )
            )
            added += 1

        db.session.commit()
    except FixtureConflict:
        db.session.rollback()
        raise
    return added


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
    parser.add_argument(
        "--extra",
        metavar="PATH",
        help=(
            "append fixture rows from PATH to the (possibly just seeded) database; "
            "idempotent by the matching rules in apply_extra"
        ),
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
            if args.extra and stored is None:
                print("--extra requires a seeded database", file=sys.stderr)
                return 1
            print(f"already seeded (schema v{stored.version})")
            if args.extra:
                try:
                    added = apply_extra(db, args.extra)
                except (FixtureConflict, OSError, ValueError) as error:
                    print(f"extra fixture failed: {error}", file=sys.stderr)
                    return 1
                print(f"Applied {added} fixture rows from {args.extra}")
            return 0
        print(f"Seeded {path or uri} (schema v{version})")
        if args.extra:
            try:
                added = apply_extra(db, args.extra)
            except (FixtureConflict, OSError, ValueError) as error:
                print(f"extra fixture failed: {error}", file=sys.stderr)
                return 1
            print(f"Applied {added} fixture rows from {args.extra}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
