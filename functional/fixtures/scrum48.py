"""SCRUM-48 test-owned preconditions, never imported by the production app.

Run only on the functional runner's disposable database. This spec's namespace
is refreshed before the spec and cleared afterwards, preserving other stories'
coordinator workloads. Some preconditions
need SCRUM-81's future review states: stage those here, not through a test-only
production endpoint. User steps exercise the real application and backend.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EquipmentType, EventRequest, EquipmentRequirement, Reservation, Venue, VenueBookingRequest


def seed():
    app = create_app()
    with app.app_context():
        accounts = {a.username: a for a in db.session.query(Account).all()}
        # Only this spec's namespaced records; never reset the shared database.
        ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like('SCRUM-48 TC%')).all()]
        for model in (Reservation, EquipmentRequirement, VenueBookingRequest):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
        db.session.query(EquipmentType).filter(EquipmentType.name.like('SCRUM-48 TC%')).delete(synchronize_session=False)
        db.session.query(Venue).filter(Venue.name.like('SCRUM-48 TC%')).delete(synchronize_session=False)
        db.session.commit()
        if '--clear' in sys.argv:
            return
        for n in range(1, 15):
            prefix = f'SCRUM-48 TC{n:02}'
            event = EventRequest(name=f'{prefix} Event', status='Safety Check' if n == 13 else 'Planning',
                                 date='2026-12-15', start_time='10:00', end_time='12:00', attendance=40,
                                 purpose='Equipment test', description='Functional fixture',
                                 equipment_requirements='Organiser original needs', registration_needs='None',
                                 created_by=accounts['org1'], assigned_coordinator=accounts['coord1'])
            db.session.add(event)
            types = {}
            for name in ('Projector', 'Microphones'):
                equipment = EquipmentType(name=f'{prefix} {name}', total_units=(0 if name == 'Projector' else 5) if n == 10 else 10,
                                          description='Functional fixture type', location='Test store')
                db.session.add(equipment); types[name] = equipment
            def requirement(name, qty, technical='', status='Requested'):
                db.session.add(EquipmentRequirement(event_request=event, equipment_type=types[name],
                                                   quantity=qty, technical_requirements=technical, status=status))
            if n in (2, 3, 4, 6, 7, 8, 9, 11, 12):
                requirement('Projector', 2, 'HDMI connection required')
            if n in (3, 4, 5):
                requirement('Microphones', 4)
            if n == 14:
                requirement('Projector', 2, 'HDMI connection required', 'Approved')
                requirement('Microphones', 4, 'Wireless microphones', 'Declined')
            if n in (2, 13):
                for letter in ('A', 'B', 'C') if n == 2 else ('A',):
                    venue = Venue(name=f'{prefix} Venue {letter}', location='Fixture building', max_capacity=80)
                    db.session.add(venue)
                    db.session.add(VenueBookingRequest(event_request=event, venue=venue,
                        date=event.date, start_time=event.start_time, end_time=event.end_time, attendance=40,
                        status='Cancelled' if letter == 'C' else 'Approved', raised_by=accounts['coord1'], raised_at=datetime(2026, 10, 1, tzinfo=timezone.utc)))
            if n in (3, 4, 10):
                other = EventRequest(name=f'{prefix} Other event', status='Planning', created_by=accounts['org1'],
                                     date=event.date, start_time=event.start_time, end_time=event.end_time,
                                     attendance=40, assigned_coordinator=accounts['coord1'])
                db.session.add(other)
                db.session.add(Reservation(event_request=other, equipment_type=types['Microphones' if n == 10 else 'Projector'],
                    quantity=5 if n == 10 else 2, date=event.date, start_time=event.start_time, end_time=event.end_time, status='Reserved'))
        db.session.commit()
        print('SCRUM-48 test-owned fixture preconditions loaded')


if __name__ == '__main__':
    seed()
