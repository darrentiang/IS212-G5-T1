"""SCRUM-92 test-owned preconditions: the events coord1 sets registration on.

Every event is named "SCRUM-92 TCnn <row's event>", assigned to coord1, so each
test opens only its own. Registrations are inserted directly, as scrum55.py
does (nothing in the app registers an Attendee yet, SCRUM-54), by att1 and the
three Attendee accounts the rows name, att92a, att92b and att92c, which the
seed does not have. Prints {event name: id} as JSON. --clear removes exactly
what this file stages.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EventRequest, Registration, Role

PREFIX = 'SCRUM-92 TC'
ATTENDEES = ('att92a', 'att92b', 'att92c')


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

        def event(label, status, date, start, end, attendance=50, closes=None, capacity=None,
                  registrations=()):
            row = EventRequest(
                name=f'{PREFIX}{label}', status=status, date=date, start_time=start, end_time=end,
                attendance=attendance, purpose='Registration test', description='Functional fixture',
                equipment_requirements='None', registration_needs='None', created_by=accounts['org1'],
                assigned_coordinator=accounts['coord1'], submitted_at=now,
                registration_enabled=closes is not None, registration_capacity=capacity,
                registration_closes_at=datetime.fromisoformat(closes) if closes else None)
            db.session.add(row)
            db.session.flush()
            for username, state in registrations:
                db.session.add(Registration(
                    event_request=row, attendee=accounts[username], status=state, registered_at=now,
                    withdrawn_at=now if state == 'Withdrawn' else None))
            events[row.name] = row

        def gala(n, **fields):
            event(f'{n:02} Reg Gala', 'Planning', '2026-12-05', '18:00', '21:00', attendance=120, **fields)

        def fair(n):
            event(f'{n:02} Reg Fair', 'Confirmed', '2026-12-06', '10:00', '12:00', capacity=50,
                  closes='2026-12-06T10:00',
                  registrations=[('att1', 'Registered'), ('att92a', 'Registered'),
                                 ('att92b', 'Registered'), ('att92c', 'Withdrawn')])

        for n in (1, 2, 3, 5, 6):
            gala(n)
        fair(4)
        gala(7, capacity=120, closes='2026-12-05T18:00')
        fair(8)
        event('09 Quiet Talk', 'Planning', '2026-12-07', '14:00', '15:00', capacity=30,
              closes='2026-12-07T14:00', registrations=[('att1', 'Withdrawn')])
        event('10 Early Talk', 'Submitted', '2026-12-09', '10:00', '11:00', attendance=40)
        event('11 Off Night', 'Cancelled', '2026-12-08', '19:00', '21:00')
        db.session.commit()
        print(json.dumps({name: row.id for name, row in events.items()}))


if __name__ == '__main__':
    seed()
