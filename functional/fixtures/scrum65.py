"""Independent SCRUM-65 cases. Own namespace; setup day+1300+N; no demo edits.

python scrum65.py N [--snapshot|--clear]. Snapshots are read-only.
Held expiry is before event start and its warning is already recorded, so the
request-wide SCRUM-85 expiry hook cannot contaminate cancellation preservation.
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
    prefix=f'SCRUM-65 TC{number:02} '
    with create_app().app_context():
        events=db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix)).order_by(EventRequest.id).all()
        ids=[e.id for e in events]
        if '--snapshot' in sys.argv:
            def records(model,rows):return [{c.name:getattr(row,c.name) for c in model.__table__.columns} for row in rows]
            result={'events':records(EventRequest,events)}
            for model in (VenueBookingRequest,VenueHold,EquipmentRequirement,Reservation,Notification):
                result[model.__tablename__]=records(model,db.session.query(model).filter(model.event_request_id.in_(ids)).order_by(model.id).all())
            result['equipment_types']=records(EquipmentType,db.session.query(EquipmentType).filter(EquipmentType.name.startswith(prefix)).order_by(EquipmentType.id).all())
            print(json.dumps(result,default=str,sort_keys=True));return
        for model in (Notification,Reservation,EquipmentRequirement,VenueHold,VenueBookingRequest):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        for e in events:db.session.delete(e)
        db.session.flush()
        for model in (EquipmentType,Venue):
            for row in db.session.query(model).filter(model.name.startswith(prefix)).all():db.session.delete(row)
        db.session.commit()
        if '--clear' in sys.argv:return
        accounts={a.username:a for a in db.session.query(Account).all()}
        day=date.today()+timedelta(days=1300+number)
        local=datetime.combine(day,datetime.min.time())
        def event(label,stage):
            e=EventRequest(name=prefix+label,status=stage,date=day.isoformat(),start_time='13:00',end_time='15:00',
                attendance=30,purpose='Cancellation case',description='Owned SCRUM-65 preconditions',
                equipment_requirements='Projector',registration_needs='None',created_by=accounts['org1'],
                assigned_coordinator=accounts['coord1'] if stage!='Draft' else None)
            db.session.add(e);db.session.flush();return e
        stages={2:'Safety Check',3:'Confirmed',4:'Submitted',10:'Approved'}
        main=event('Submitted Event' if number==4 else 'Event',stages.get(number,'Planning'))
        if number==4:event('Approved Event','Approved')
        if number==6:
            main.status='Draft';main.assigned_coordinator=None
            for stage in ('Rejected','Completed','Cancelled'):
                e=event(stage+' Event',stage)
                if stage=='Completed':e.completed_at=local.replace(hour=1);e.completed_by=accounts['coord1']
                if stage=='Cancelled':
                    e.cancelled_at=local.replace(hour=1);e.cancelled_by=accounts['coord1'];e.cancel_reason='Original cancellation reason'
        def venue(label):
            v=Venue(name=prefix+label,location='Cancellation fixture',max_capacity=40,is_active=True,setup_time=0,turnaround_time=0)
            db.session.add(v);db.session.flush();return v
        def booking(e,label,status):
            b=VenueBookingRequest(event_request=e,venue=venue(label),status=status,date=e.date,start_time=e.start_time,end_time=e.end_time,
                attendance=30,raised_by=accounts['coord1'],raised_at=local.replace(hour=1))
            if status in ('Approved','Cancelled','Rejected'):
                b.decision='Rejected' if status=='Rejected' else 'Approved';b.decided_by=accounts['venue1'];b.decided_at=local.replace(hour=1)
            if status=='Cancelled':
                b.cancel_reason='Earlier venue arrangement withdrawn';b.cancelled_at=local.replace(hour=1);b.cancelled_by=accounts['coord1']
            db.session.add(b);db.session.flush();return b
        def hold(label,status):
            h=VenueHold(event_request=main,venue=venue(label),status=status,expires_at=local.replace(hour=12),
                placed_by=accounts['coord1'],placed_at=local.replace(hour=0),warning_sent_at=local.replace(hour=1))
            if status=='Released':h.released_at=local.replace(hour=1)
            if status=='Expired':h.expires_at=local.replace(hour=8);h.expired_at=local.replace(hour=8)
            db.session.add(h)
        def equipment():
            t=EquipmentType(name=prefix+'Projector',total_units=10,description='Fixture projector',location='Fixture store')
            db.session.add(t);db.session.flush();return t
        def reservation(e,t,status,quantity=3):
            row=Reservation(event_request_id=e.id,equipment_type_id=t.id,quantity=quantity,date=e.date,start_time=e.start_time,end_time=e.end_time,status=status)
            db.session.add(row)
        if number in (1,2,3,5,7,8):
            booking(main,'Venue A','Approved')
            if number==1:
                booking(main,'Venue B','Approved');booking(main,'Venue C','Requested');hold('Venue D','Held')
            t=equipment();db.session.add(EquipmentRequirement(event_request=main,equipment_type=t,quantity=3,status='Approved',technical_requirements='HDMI'))
            reservation(main,t,'Reserved')
            if number in (1,3):
                other=event('Other Event','Planning');other.assigned_coordinator=accounts['coord2']
                booking(other,'Other Venue','Approved');reservation(other,t,'Reserved',2)
        if number==6:
            old=db.session.query(EventRequest).filter_by(name=prefix+'Cancelled Event').one()
            reservation(old,equipment(),'Released')
        if number==9:
            for label,status in [('Rejected venue','Rejected'),('Withdrawn venue','Withdrawn'),('Cancelled venue','Cancelled')]:booking(main,label,status)
            hold('Released hold venue','Released');hold('Expired hold venue','Expired')
            t=equipment();reservation(main,t,'Released')
        db.session.commit()
        print(json.dumps({'day':day.isoformat(),'events':[{'id':e.id,'name':e.name,'status':e.status} for e in db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix)).order_by(EventRequest.id)]}))


if __name__=='__main__':
    n=int(sys.argv[1])
    if not 1<=n<=10:raise SystemExit('Case number must be 1..10')
    run(n)
