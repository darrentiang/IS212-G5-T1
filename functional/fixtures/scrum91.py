"""SCRUM-91 per-case owned preconditions; never cleans another story's data.

Usage: python scrum91.py N [--clear]
Clears every venue an earlier run of case N left ("SCRUM-91 TCnn ..."), then
stores the case's venue with hours 01:55 to 01:53 and prints its id as JSON.
The forms now refuse those hours, so the venue is written straight to the
database, as one saved before SCRUM-91 was (TC09 to TC12). --clear only clears.
"""
import json
import sys
from datetime import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Venue


def run(n):
    prefix = f'SCRUM-91 TC{n:02}'
    app = create_app()
    with app.app_context():
        for row in db.session.query(Venue).filter(Venue.name.like(f'{prefix} %')).all():
            db.session.delete(row)
        db.session.commit()
        if '--clear' in sys.argv:
            return
        venue = Venue(
            name=f'{prefix} Venue',
            location='Block D Level 1',
            max_capacity=40,
            opening_time=time(1, 55),
            closing_time=time(1, 53),
        )
        db.session.add(venue)
        db.session.commit()
        print(json.dumps({'venue': venue.id}))


if __name__ == '__main__':
    run(int(sys.argv[1]))
