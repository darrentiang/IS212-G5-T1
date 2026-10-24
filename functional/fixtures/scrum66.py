"""Owned, idempotent SCRUM-66 preconditions and read-only snapshots.

python scrum66.py N [--clear|--snapshot]. No baseline/demo data is modified.
D = fixture setup day + 1100 + N days; the application clock is pinned by spec.
"""
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, EventRequest, Venue, VenueBookingRequest, VenueHold,
                    EquipmentType, EquipmentRequirement, Reservation, Notification)


def run(number):
    prefix = f'SCRUM-66 TC{number:02} '
    app = create_app()
    with app.app_context():
        events = db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix)).order_by(EventRequest.id).all()
        ids = [e.id for e in events]
        if '--snapshot' in sys.argv:
            def records(model, rows):
                return [{c.name:getattr(r,c.name) for c in model.__table__.columns} for r in rows]
            tables = {'events':records(EventRequest,events)}
            for model in (VenueBookingRequest, VenueHold, EquipmentRequirement, Reservation, Notification):
                tables[model.__tablename__] = records(model,db.session.query(model).filter(model.event_request_id.in_(ids)).order_by(model.id).all())
            tables['equipment_types'] = records(EquipmentType,db.session.query(EquipmentType).filter(EquipmentType.name.startswith(prefix)).order_by(EquipmentType.id).all())
            print(json.dumps(tables,default=str,sort_keys=True))
            return
        for model in (Notification, Reservation, EquipmentRequirement, VenueHold, VenueBookingRequest):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        for row in events: db.session.delete(row)
        db.session.flush()
        for model in (EquipmentType, Venue):
            for row in db.session.query(model).filter(model.name.startswith(prefix)).all(): db.session.delete(row)
        db.session.commit()
        if '--clear' in sys.argv: return
        accounts = {a.username:a for a in db.session.query(Account).all()}
        day = date.today() + timedelta(days=1100+number)
        event_day = day + timedelta(days=1) if number==7 else day
        status = 'Planning' if number==4 else 'Confirmed'
        def event(label,stage):
            row = EventRequest(name=prefix+label,status=stage,date=event_day.isoformat(),start_time='10:00',end_time='12:00',
                attendance=30,purpose='Completion case',description='Owned SCRUM-66 preconditions',equipment_requirements='Projector',
                registration_needs='None',created_by=accounts['org1'],assigned_coordinator=accounts['coord1'])
            db.session.add(row);db.session.flush();return row
        main = event('Planning Event' if number==4 else 'Event',status)
        if number==4:
            done=event('Completed Event','Completed')
            done.completed_by=accounts['coord1'];done.completed_at=datetime.combine(day,datetime.min.time()).replace(hour=4)
        if number==3:
            venue=Venue(name=prefix+'Venue',location='Fixture store',max_capacity=40,is_active=True)
            equipment=EquipmentType(name=prefix+'Projector',total_units=10,description='Fixture projector',location='Fixture store')
            db.session.add_all([venue,equipment]);db.session.flush()
            db.session.add(VenueBookingRequest(event_request=main,venue=venue,status='Approved',date=main.date,start_time='10:00',end_time='12:00',attendance=30,
                raised_by=accounts['coord1'],raised_at=datetime.combine(day,datetime.min.time()),decision='Approved',decided_by=accounts['venue1'],decided_at=datetime.combine(day,datetime.min.time())))
            db.session.add(EquipmentRequirement(event_request=main,equipment_type=equipment,quantity=2,status='Approved',technical_requirements='HDMI'))
            db.session.add(Reservation(event_request_id=main.id,equipment_type_id=equipment.id,quantity=2,date=main.date,start_time='10:00',end_time='12:00',status='Reserved'))
        db.session.commit()
        print(json.dumps({'day':day.isoformat(),'events':[{'id':e.id,'name':e.name,'status':e.status} for e in db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix)).order_by(EventRequest.id)]}))


if __name__=='__main__':
    number=int(sys.argv[1])
    if not 1<=number<=7: raise SystemExit('Case number must be 1..7')
    run(number)
