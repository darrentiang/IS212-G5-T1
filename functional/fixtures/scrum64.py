"""SCRUM-64 test-owned preconditions, one row's events at a time.

``python scrum64.py <n>`` clears everything this file owns, then stages the events, bookings,
registrations and change requests that row TC-SCRUM-64-<n> starts from, and prints JSON with the
event's id and the ids of the venues and Attendee accounts the row names. ``--clear`` removes
exactly what this file creates: the "SCRUM-64 TCnn Event" events with everything they hold
(bookings, registrations, change requests, safety decisions and the notices they caused), the
Attendee accounts att64a, att64b and att64c, and the venue block a row makes ("Stage repair").

The seed has no Attendees beyond att1, so the three named accounts are created here, as the
SCRUM-54 fixture does. Every event is created in its row's state directly, not through the
actions under test; the browser journeys then perform those actions.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, ChangeRequest, EventRequest, Notification, Registration, Role,
                    SafetyDecision, Venue, VenueBlock, VenueBookingRequest)

PREFIX = 'SCRUM-64 TC'
ATTENDEES = ('att64a', 'att64b', 'att64c')
BLOCK_REASON = 'Stage repair'
LONG = 'Long concert'
TEN = dict(date='2026-12-10', start='19:00', end='21:00', closes='2026-12-09T23:59')
TWELVE = dict(date='2026-12-12', start='14:00', end='16:00', closes='2026-12-09T23:59')

# What each row starts from. ``changes`` holds (kind, affects, text, raised by) for an Open request.
CASES = {
    1: dict(status='Safety Check', owner='org1', date='2026-12-15', start='10:00', end='12:00',
            venues=['Seminar Room 1', 'Auditorium']),
    2: dict(status='Approved', owner='org2', date='2026-12-15', start='10:00', end='12:00',
            venues=['Seminar Room 1'], changes=[('Change', ['attendance'], 'Expect fifty more guests.', 'org2')]),
    3: dict(status='Planning', owner='org2', date='2026-12-15', start='10:00', end='12:00',
            venues=['Seminar Room 1'], changes=[('Change', ['date_time'], 'Move it a week later.', 'org2')]),
    4: dict(status='Planning', owner='org2', date='2026-12-15', start='10:00', end='12:00',
            venues=['Seminar Room 1'], changes=[('Withdrawal', [], 'Client postponed', 'org2')]),
    5: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True,
            registered=['att64a'], withdrawn=['att64b'],
            changes=[('Change', ['date_time'], 'Move it a week later.', 'org1')]),
    6: dict(status='Confirmed', owner='org1', date='2026-12-12', start='10:00', end='12:00',
            venues=['Auditorium'], registration=True, registered=['att64a'], closes='2026-12-09T23:59'),
    7: dict(status='Safety Check', owner='org1', **TWELVE, venues=['Seminar Room 1'], registered=['att64a']),
    8: dict(status='Safety Check', owner='org1', **TWELVE, venues=['Seminar Room 1', 'Auditorium'],
            registration=True, registered=['att64a'], withdrawn=['att64b']),
    9: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True,
            registered=['att64a', 'att64b'], withdrawn=['att64c']),
    10: dict(status='Confirmed', owner='org2', **TEN, venues=['Seminar Room 1'], registration=True,
             registered=['att64a'], changes=[('Withdrawal', [], 'Client cancelled the programme', 'org2')]),
    11: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True),
    12: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True),
    13: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True,
             capacity=1, registered=['att64a']),
    14: dict(status='Confirmed', owner='org1', **TEN, venues=['Seminar Room 1'], registration=True,
             registered=['att64a']),
}


def clear():
    """Remove everything this file creates, the attendees and the block included."""
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    db.session.query(Notification).filter(Notification.event_request_id.in_(ids)).delete(synchronize_session=False)
    for username in ATTENDEES:
        account = db.session.query(Account).filter_by(username=username).first()
        if account:
            db.session.query(Notification).filter_by(recipient_id=account.id).delete(synchronize_session=False)
    db.session.query(ChangeRequest).filter(ChangeRequest.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(SafetyDecision).filter(SafetyDecision.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(Registration).filter(Registration.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(VenueBookingRequest).filter(
        VenueBookingRequest.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    db.session.query(VenueBlock).filter_by(reason=BLOCK_REASON).delete(synchronize_session=False)
    for row in db.session.query(Account).filter(Account.username.in_(ATTENDEES)):
        row.roles = []
        db.session.delete(row)
    db.session.commit()


def attendees():
    attendee = db.session.query(Role).filter_by(name='Attendee').one()
    accounts = {}
    for username in ATTENDEES:
        row = db.session.query(Account).filter_by(username=username).first()
        if row is None:
            row = Account(username=username)
            row.set_password('Passw0rd!')
            row.roles = [attendee]
            db.session.add(row)
        accounts[username] = row
    db.session.flush()
    return accounts


def stage(n):
    case = CASES[n]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    accounts = {a.username: a for a in db.session.query(Account).all()}
    venues = {v.name: v for v in db.session.query(Venue).all()}
    people = attendees()
    accounts.update(people)
    name = f'{PREFIX}{n:02} Event'
    capacity = case.get('capacity', 5)
    row = EventRequest(
        name=name, status=case['status'], date=case['date'], start_time=case['start'], end_time=case['end'],
        attendance=capacity, purpose=LONG, description='Functional fixture', equipment_requirements='None',
        registration_needs='None', created_by=accounts[case['owner']], assigned_coordinator=accounts['coord1'],
        submitted_at=now, registration_enabled=case.get('registration', False),
        registration_capacity=capacity, registration_closes_at=datetime.fromisoformat(case['closes'])
        if 'closes' in case else datetime.fromisoformat('2026-12-09T23:59'))
    db.session.add(row)
    db.session.flush()
    for venue in case.get('venues', []):
        db.session.add(VenueBookingRequest(
            venue=venues[venue], event_request=row, status='Approved', date=case['date'], start_time=case['start'],
            end_time=case['end'], attendance=capacity, raised_by=accounts['coord1'], raised_at=now,
            decision='Approved', decided_at=now, decided_by=accounts['venue1']))
    for username in case.get('registered', []):
        db.session.add(Registration(event_request=row, attendee=accounts[username], status='Registered',
                                    registered_at=now))
    for username in case.get('withdrawn', []):
        db.session.add(Registration(event_request=row, attendee=accounts[username], status='Withdrawn',
                                    registered_at=now, withdrawn_at=now))
    for kind, affects, text, raiser in case.get('changes', []):
        db.session.add(ChangeRequest(event_request=row, raised_by=accounts[raiser], kind=kind,
                                     description=text, affects=affects, status='Open', raised_at=now))
    db.session.commit()
    first_venue = case.get('venues', [None])[0]
    return {
        'event': row.id,
        'venue': venues[first_venue].id if first_venue else None,
        'venues': {v: venues[v].id for v in case.get('venues', [])},
    }


def main():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        print(json.dumps(stage(int(sys.argv[1]))))


if __name__ == '__main__':
    main()
