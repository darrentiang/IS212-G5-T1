"""SCRUM-57 test-owned preconditions: the events whose registrations are viewed.

Every event is named "SCRUM-57 <row's event>", created by org1 and assigned to
coord1. Registrations are inserted directly, as scrum55.py and scrum92.py do,
by att1 and the two Attendee accounts the rows name, att57a and att57b, which
the seed does not have; registered_at is UTC, as the API stores it. Prints
{event name: id} as JSON. --clear removes exactly what this file stages.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EventRequest, Registration, Role

PREFIX = 'SCRUM-57 '
ATTENDEES = ('att57a', 'att57b')


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    db.session.query(Registration).filter(Registration.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    for row in db.session.query(Account).filter(Account.username.in_(ATTENDEES)):
        row.roles = []
        db.session.delete(row)
    db.session.commit()


def seed():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        attendee = db.session.query(Role).filter_by(name='Attendee').one()
        for username in ATTENDEES:
            row = Account(username=username)
            row.set_password('Passw0rd!')
            row.roles = [attendee]
            db.session.add(row)
        db.session.flush()
        accounts = {a.username: a for a in db.session.query(Account).all()}
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        events = {}

        def event(label, status, date, start, end, capacity=None, closes=None, registrations=()):
            row = EventRequest(
                name=f'{PREFIX}{label}', status=status, date=date, start_time=start, end_time=end,
                attendance=50, purpose='Registration view test', description='Functional fixture',
                equipment_requirements='None', registration_needs='None', created_by=accounts['org1'],
                assigned_coordinator=accounts['coord1'], submitted_at=now,
                registration_enabled=capacity is not None, registration_capacity=capacity,
                registration_closes_at=datetime.fromisoformat(closes) if closes else None)
            db.session.add(row)
            db.session.flush()
            for username, state, at in registrations:
                db.session.add(Registration(
                    event_request=row, attendee=accounts[username], status=state,
                    registered_at=datetime.fromisoformat(at) if at else now,
                    withdrawn_at=now if state == 'Withdrawn' else None))
            events[row.name] = row

        event('Count Gala', 'Confirmed', '2026-12-10', '19:00', '21:00', capacity=3,
              closes='2026-12-09T23:59',
              registrations=[('att1', 'Registered', '2026-11-20T10:00'),
                             ('att57a', 'Registered', '2026-11-21T11:30'),
                             ('att57b', 'Withdrawn', '2026-11-19T09:00')])
        event('Full Gala', 'Confirmed', '2026-12-11', '19:00', '21:00', capacity=2,
              closes='2026-12-11T19:00',
              registrations=[('att1', 'Registered', None), ('att57a', 'Registered', None)])
        event('Quiet Fair', 'Planning', '2026-12-12', '10:00', '12:00')
        db.session.commit()
        print(json.dumps({name: row.id for name, row in events.items()}))


if __name__ == '__main__':
    seed()
