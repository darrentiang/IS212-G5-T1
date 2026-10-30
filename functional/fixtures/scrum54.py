"""SCRUM-54 test-owned preconditions: the events att1 registers for.

Every event is named "SCRUM-54 TCnn <row's event>", Confirmed with registration
on, created by org1 and assigned to coord1, each with one Approved venue
booking, so each test opens only its own. Reg Concert (10 Dec 2026, 19:00-21:00,
Seminar Room 1, capacity 2, closes 09 Dec 2026, 23:59) carries coordinator notes
the Attendee must never see; Close Talk (05 Dec 2026, 14:00-15:00, Auditorium,
capacity 50) closes 01 Dec 2026, 10:00. The registrations a row starts with are
inserted directly; att54a and att54b are the two Attendee accounts the rows
name, which the seed does not have. Prints {event name: id} as JSON. --clear
removes exactly what this file stages.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EventRequest, Registration, Role, Venue, VenueBookingRequest

PREFIX = 'SCRUM-54 TC'
ATTENDEES = ('att54a', 'att54b')


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    db.session.query(Registration).filter(Registration.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(VenueBookingRequest).filter(
        VenueBookingRequest.event_request_id.in_(ids)).delete(synchronize_session=False)
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
        venues = {v.name: v for v in db.session.query(Venue).all()}
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        events = {}

        def event(label, date, start, end, venue, capacity, closes, purpose, notes=None, registered=()):
            row = EventRequest(
                name=f'{PREFIX}{label}', status='Confirmed', date=date, start_time=start, end_time=end,
                attendance=capacity, purpose=purpose, description='Functional fixture',
                equipment_requirements='None', registration_needs='None', coordinator_notes=notes,
                created_by=accounts['org1'], assigned_coordinator=accounts['coord1'], submitted_at=now,
                registration_enabled=True, registration_capacity=capacity,
                registration_closes_at=datetime.fromisoformat(closes))
            db.session.add(row)
            db.session.flush()
            db.session.add(VenueBookingRequest(
                venue=venues[venue], event_request=row, status='Approved', date=date, start_time=start,
                end_time=end, attendance=capacity, raised_by=accounts['coord1'], raised_at=now,
                decision='Approved', decided_at=now, decided_by=accounts['venue1']))
            for username in registered:
                db.session.add(Registration(event_request=row, attendee=accounts[username], status='Registered',
                                            registered_at=now))
            events[row.name] = row

        def concert(n, registered=()):
            event(f'{n:02} Reg Concert', '2026-12-10', '19:00', '21:00', 'Seminar Room 1', 2, '2026-12-09T23:59',
                  'Evening concert', notes='Internal: VIP list pending', registered=registered)

        def talk(n):
            event(f'{n:02} Close Talk', '2026-12-05', '14:00', '15:00', 'Auditorium', 50, '2026-12-01T10:00',
                  'Afternoon talk')

        concert(1)
        concert(2, registered=['att54a'])
        concert(3, registered=['att54a'])
        concert(4)
        for n in (5, 6, 7):
            talk(n)
        db.session.commit()
        print(json.dumps({name: row.id for name, row in events.items()}))


if __name__ == '__main__':
    seed()
