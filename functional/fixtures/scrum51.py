"""SCRUM-51 per-case owned preconditions; never cleans another story's data.

Usage: python scrum51.py N [--clear|--snapshot]
D is local setup date + 800 + N days; every related record uses that same D.
Snapshots are read-only test evidence, not a new production endpoint.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EquipmentType, EventRequest, EquipmentRequirement, Reservation


def run(n):
    prefix=f'SCRUM-51 TC{n:02}'
    app=create_app()
    with app.app_context():
        events=db.session.query(EventRequest).filter(EventRequest.name.like(f'{prefix} %')).order_by(EventRequest.id).all()
        types=db.session.query(EquipmentType).filter(EquipmentType.name.like(f'{prefix} %')).order_by(EquipmentType.id).all()
        ids=[e.id for e in events]
        if '--snapshot' in sys.argv:
            requirements=db.session.query(EquipmentRequirement).filter(EquipmentRequirement.event_request_id.in_(ids)).order_by(EquipmentRequirement.id).all()
            reservations=db.session.query(Reservation).filter(Reservation.event_request_id.in_(ids)).order_by(Reservation.id).all()
            print(json.dumps({'events':[(e.id,e.name,e.status,e.date,e.start_time,e.end_time) for e in events],
                'types':[(t.id,t.name,t.total_units) for t in types],
                'requirements':[{k:v for k,v in q.to_dict().items() if k!='has_unreleased_reservation'} for q in requirements],
                'reservations':[{'id':r.id,'event_request_id':r.event_request_id,'equipment_type_id':r.equipment_type_id,
                    'quantity':r.quantity,'date':r.date,'start_time':r.start_time,'end_time':r.end_time,'status':r.status} for r in reservations]}))
            return
        for model in (Reservation,EquipmentRequirement):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        for event in events: db.session.delete(event)
        for equipment in types: db.session.delete(equipment)
        db.session.commit()
        if '--clear' in sys.argv: return
        accounts={a.username:a for a in db.session.query(Account).all()}
        day=(date.today()+timedelta(days=800+n)).isoformat()
        def event(label='Event',start='10:00',end='12:00',status='Planning'):
            row=EventRequest(name=f'{prefix} {label}',status=status,date=day,start_time=start,end_time=end,
                attendance=40,purpose='Reservation case',description='Owned functional fixture',
                created_by=accounts['org1'],assigned_coordinator=accounts['coord1'])
            db.session.add(row); db.session.flush(); return row
        main=event(status='Approved' if n in (2,10) else 'Safety Check' if n==8 else 'Planning')
        def equipment(label,total=10):
            row=EquipmentType(name=f'{prefix} {label}',total_units=total,description='Reservation fixture',location='Test store')
            db.session.add(row); db.session.flush(); return row
        projector=equipment('Projector',4 if n in (4,10) else 10)
        def requirement(owner,type,quantity,status='Approved'):
            row=EquipmentRequirement(event_request=owner,equipment_type=type,quantity=quantity,status=status,
                technical_requirements='HDMI connection required' if type==projector else '',
                decline_reason='Unavailable model' if status=='Declined' else None)
            db.session.add(row); db.session.flush(); return row
        def reserve(owner,type,quantity,status='Reserved'):
            db.session.add(Reservation(event_request_id=owner.id,equipment_type_id=type.id,quantity=quantity,
                date=day,start_time=owner.start_time,end_time=owner.end_time,status=status))
        q=6 if n==5 else 2 if n in (6,8,9) else 4
        requirement(main,projector,q,'Requested' if n==6 else 'Approved')
        if n in (2,3,5,7):
            qty={2:6,3:7,5:5,7:3}[n]
            other=event('Other Event'); requirement(other,projector,qty)
            if n!=5: reserve(other,projector,qty)
        if n==4:
            for label,start,end in [('Earlier Event','09:00','10:00'),('Later Event','12:00','13:00')]:
                other=event(label,start,end); requirement(other,projector,4); reserve(other,projector,4)
        if n in (7,9,10,11,12): reserve(main,projector,q)
        if n in (6,8,9):
            microphone=equipment('Microphones'); requirement(main,microphone,3 if n in (6,8) else 1,'Declined' if n==6 else 'Approved')
            if n in (8,9): reserve(main,microphone,3 if n==8 else 1,'Reserved' if n==8 else 'Released')
        if n==9: requirement(main,equipment('Speakers'),3)
        db.session.commit()


if __name__=='__main__':
    number=int(sys.argv[1])
    if not 1<=number<=12: raise SystemExit('Case number must be 1..12')
    run(number)
