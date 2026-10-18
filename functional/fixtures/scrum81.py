"""SCRUM-81 test-owned preconditions, following SCRUM-48's fixture convention.

Only this story's namespace is staged/cleared, on the functional runner DB.
Reserved/Released preconditions do not pretend to exercise SCRUM-51's workflow.
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
        ids = [e.id for e in db.session.query(EventRequest).filter(EventRequest.name.like('SCRUM-81 TC%'))]
        for model in (Reservation, EquipmentRequirement, VenueBookingRequest):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
        db.session.query(EquipmentType).filter(EquipmentType.name.like('SCRUM-81 TC%')).delete(synchronize_session=False)
        db.session.query(Venue).filter(Venue.name.like('SCRUM-81 TC%')).delete(synchronize_session=False)
        db.session.commit()
        if '--clear' in sys.argv:
            return
        for n in range(1, 13):
            prefix = f'SCRUM-81 TC{n:02}'
            event = EventRequest(name=f'{prefix} Event', status='Safety Check' if n == 10 else 'Approved' if n in (3, 6, 8) else 'Planning',
                date='2026-12-15', start_time='10:00', end_time='12:00', attendance=40,
                purpose='Equipment review test', description='Functional fixture', equipment_requirements='Original abstract needs',
                registration_needs='None', created_by=accounts['org1'], assigned_coordinator=accounts['coord1'])
            db.session.add(event)
            types = {}
            for name in ('Projector', 'Microphones'):
                types[name] = EquipmentType(name=f'{prefix} {name}', total_units=10,
                    description='Review fixture', location='Test store')
                db.session.add(types[name])
            for name, quantity in [('Projector', 2), ('Microphones', 4)]:
                if n in (4, 8, 9, 10, 12) and name == 'Microphones':
                    continue
                status = 'Approved' if name == 'Projector' and n in (6, 7, 9, 10) else 'Declined' if (n == 8 or n == 6 and name == 'Microphones') else 'Requested'
                note = 'Model under review' if n == 7 else 'Alternative model identified' if n == 8 else 'Collect from Equipment Store A' if n in (6, 9, 10) else 'Awaiting technical review' if n == 12 else ''
                db.session.add(EquipmentRequirement(event_request=event, equipment_type=types[name], quantity=quantity,
                    technical_requirements='HDMI connection required' if name == 'Projector' else '', status=status,
                    decline_reason='Suitable model unavailable' if n == 8 else 'Wireless microphones cannot be provided' if status == 'Declined' else None,
                    arrangement_note=note, decided_by=accounts['tech1'] if status != 'Requested' else None,
                    decided_at=datetime(2026, 10, 1) if status != 'Requested' else None))
            if n in (1, 10):
                for letter in ('A', 'B', 'C') if n == 1 else ('A',):
                    venue = Venue(name=f'{prefix} Venue {letter}', location='Fixture building', max_capacity=80)
                    db.session.add(venue)
                    db.session.add(VenueBookingRequest(event_request=event, venue=venue, date=event.date,
                        start_time=event.start_time, end_time=event.end_time, attendance=40,
                        status='Cancelled' if letter == 'C' else 'Approved', raised_by=accounts['coord1'],
                        raised_at=datetime(2026, 10, 1, tzinfo=timezone.utc)))
            if n in (2, 6, 8, 9):
                holder = event
                if n == 2:
                    holder = EventRequest(name=f'{prefix} Other event', status='Planning', created_by=accounts['org1'],
                        date=event.date, start_time=event.start_time, end_time=event.end_time, attendance=40,
                        assigned_coordinator=accounts['coord1'])
                    db.session.add(holder)
                db.session.add(Reservation(event_request=holder, equipment_type=types['Projector'], quantity=2,
                    date=event.date, start_time=event.start_time, end_time=event.end_time,
                    status='Released' if n == 8 else 'Reserved'))
        db.session.commit()
        print('SCRUM-81 fixture preconditions loaded')


if __name__ == '__main__':
    seed()
