"""SCRUM-46 test-owned preconditions: the events the Organiser opens (TC-SCRUM-46-01 to 13).

Every event is named "SCRUM-46 TCnn ..." and belongs to org1, so --clear removes
exactly what this file stages and nothing else (the seeded Design Workshop of row
09 is not touched). Events are inserted in the status the row starts from, with
the Approved bookings and equipment requirements the row lists: a Completed event
cannot be reached through the app (its end time must have passed) and no screen
sets coordinator notes, so staging them directly is the only way to hold those
two preconditions; the rest could be reached through the app but would repeat the
flows SCRUM-53, 65 and 66 already prove.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, EquipmentRequirement, EquipmentType, EventRequest, SafetyDecision, Venue, VenueBlock,
                    VenueBookingRequest, VenueHold)

PREFIX = 'SCRUM-46 TC'
NOW = datetime.now(timezone.utc).replace(tzinfo=None)
DATE, START, END = '2027-03-12', '10:00', '12:00'


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    for model in (VenueBookingRequest, VenueHold, EquipmentRequirement, SafetyDecision):
        db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    db.session.query(VenueBlock).filter(VenueBlock.reason.like(f'{PREFIX}%')).delete(synchronize_session=False)
    db.session.commit()


def seed():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        accounts = {a.username: a for a in db.session.query(Account).all()}
        room = db.session.query(Venue).filter_by(name='Seminar Room 1').one()
        hall = db.session.query(Venue).filter_by(name='Auditorium').one()
        projector = db.session.query(EquipmentType).filter_by(name='Projector').one()

        def event(label, status, *, coordinator='coord1', date=DATE, **fields):
            row = EventRequest(
                name=f'{PREFIX}{label}', status=status, date=date, start_time=START, end_time=END, attendance=40,
                purpose='Arrangements test', description='Functional fixture', equipment_requirements='Projector',
                registration_needs='None', created_by=accounts['org1'],
                assigned_coordinator=accounts[coordinator] if coordinator else None, **fields)
            db.session.add(row)
            db.session.flush()
            return row

        def booking(row, venue, status, **fields):
            db.session.add(VenueBookingRequest(
                venue=venue, event_request=row, status=status, date=row.date, start_time=START, end_time=END,
                attendance=40, raised_by=accounts['coord1'], raised_at=NOW, **fields))

        def requirement(row, quantity=2, status='Approved'):
            db.session.add(EquipmentRequirement(
                event_request=row, equipment_type=projector, quantity=quantity, status=status))

        def arranged(row):
            booking(row, room, 'Approved')
            requirement(row)

        event('01 Assigned Gala', 'Submitted')
        event('02 Unassigned Gala', 'Submitted', coordinator=None)
        arranged(event('03 Confirmed Gala', 'Confirmed'))
        arranged(event('04 Completed Gala', 'Completed'))
        two = event('05 Two Venue Gala', 'Confirmed')
        booking(two, room, 'Approved')
        booking(two, hall, 'Approved')
        arranged(event('06 Planning Gala', 'Planning'))
        arranged(event('07 Safety Gala', 'Safety Check', safety_check_at=NOW))
        returned = event('08 Returned Gala', 'Planning', date='2027-03-20')
        booking(returned, room, 'Approved')
        db.session.add(VenueBlock(
            venue=room, starts_at=datetime(2027, 3, 20, 8), ends_at=datetime(2027, 3, 20, 20),
            reason=f'{PREFIX}08 Venue unavailable', created_by=accounts['venue1'], created_at=NOW))
        booking(event('10 Cancelled Gala', 'Cancelled'), room, 'Cancelled')
        internal = event('11 Internal Gala', 'Confirmed')
        booking(internal, room, 'Approved')
        booking(internal, hall, 'Rejected', decision='Rejected', decision_reason='The Auditorium is closed that day',
                decided_by=accounts['venue1'], decided_at=NOW)
        db.session.add(VenueHold(venue=hall, event_request=internal, status='Released', expires_at=datetime(2027, 3, 1, 10),
                                 placed_by=accounts['coord1'], placed_at=NOW))
        notes = event('12 Notes Gala', 'Planning', coordinator_notes='Call the venue manager')
        db.session.add(SafetyDecision(
            event_request=notes, decision='Changes requested', reason='Add a second exit',
            notes={'emergency-access': 'Needs two exits'}, areas=['venue_arrangements'],
            decided_by=accounts['safety1'], decided_at=NOW))
        arranged(event('13 Confirmed Gala', 'Confirmed'))
        db.session.commit()
        print('SCRUM-46 fixtures loaded')


if __name__ == '__main__':
    seed()
