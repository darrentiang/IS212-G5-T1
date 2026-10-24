import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// One independently staged test per curated sheet row. No shared demo edits.
const script=fileURLToPath(new URL('../fixtures/scrum65.py',import.meta.url))
const fixture=(n,flag)=>JSON.parse(execFileSync('python',[script,String(n),...(flag?[flag]:[])],{encoding:'utf8'})||'null')
let currentCase
const contexts=[]
const el=(page,suffix)=>page.getByTestId(`request-detail-cancel-${suffix}`)
async function login(page,user='coord1') {
  await page.goto('/login');await page.getByTestId('login-username-input').fill(user)
  await page.getByTestId('login-password-input').fill('Passw0rd!');await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(user)
}
async function setup(n,page,user='coord1') {
  clearClock();currentCase=n
  const data=fixture(n);pinClock(`${data.day}T10:00`)
  await page.clock.setFixedTime(new Date(`${data.day}T10:00:00+08:00`))
  await login(page,user)
  return {...data,event:data.events[0],before:fixture(n,'--snapshot')}
}
async function open(page,event) {
  await page.goto(`/requests/${event.id}`)
  await expect(page.getByTestId('request-detail-status')).toBeVisible()
}
async function cancel(page,reason) {
  await el(page,'button').click();await expect(el(page,'reason-input')).toBeFocused()
  await el(page,'reason-input').fill(reason);await el(page,'confirm-button').click()
}
const dateText=day=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`))
async function details(page,day,reason) {
  await expect(page.getByTestId('request-detail-status')).toHaveText('Cancelled')
  await expect(page.getByTestId('request-detail-cancellation-details')).toContainText(`Cancelled by coord1 at ${dateText(day)}, 02:00 UTC`)
  await expect(page.getByTestId('request-detail-cancellation-reason')).toHaveText(reason)
}
async function session(browser,user) {
  const context=await browser.newContext();contexts.push(context)
  const page=await context.newPage();await login(page,user);return page
}
function preserved(before,after,ids) {
  // Compare every owned column except the exact changes allowed by cancellation.
  const normalise=s=>({...s,
    events:s.events.map(({status,cancelled_at,cancelled_by_id,cancel_reason,...row})=>ids.includes(row.id)?row:{status,cancelled_at,cancelled_by_id,cancel_reason,...row}),
    venue_booking_requests:s.venue_booking_requests.map(row=>{
      const original=before.venue_booking_requests.find(b=>b.id===row.id)
      if(!ids.includes(row.event_request_id)||!['Approved','Requested'].includes(original.status))return row
      const {status,...rest}=row
      if(original.status!=='Approved')return rest
      const {cancel_reason,cancelled_at,cancelled_by_id,...keep}=rest;return keep
    }),
    venue_holds:s.venue_holds.map(row=>{
      const original=before.venue_holds.find(h=>h.id===row.id)
      if(!ids.includes(row.event_request_id)||original.status!=='Held')return row
      const {status,released_at,...keep}=row;return keep
    }),
    reservations:s.reservations?.map(row=>{
      const original=before.reservations.find(r=>r.id===row.id)
      if(!ids.includes(row.event_request_id)||original.status!=='Reserved')return row
      const {status,...keep}=row;return keep
    })
  })
  expect(normalise(after)).toEqual(normalise(before))
}
async function arrangements(page,event,before,reason) {
  await open(page,event)
  for(const b of before.venue_booking_requests.filter(b=>b.event_request_id===event.id)) {
    const expected=b.status==='Approved'?'Cancelled':b.status==='Requested'?'Withdrawn':b.status
    await expect(page.getByTestId(`request-detail-booking-status-${b.id}`)).toHaveText(expected)
    if(b.status==='Approved')await expect(page.getByTestId(`request-detail-booking-cancel-reason-${b.id}`)).toHaveText(reason)
  }
  for(const h of before.venue_holds.filter(h=>h.event_request_id===event.id))
    await expect(page.getByTestId(`request-detail-hold-status-${h.id}`)).toHaveText(h.status==='Held'?'Released':h.status)
  await page.goto(`/requests/${event.id}/equipment`)
  for(const row of before.reservations.filter(r=>r.event_request_id===event.id))
    await expect(page.getByTestId(`equipment-requirements-reservation-status-${row.id}`)).toHaveText('Released')
}
async function inventory(page,type,day,available) {
  await page.goto('/equipment')
  await page.getByTestId('equipment-check-type-input').selectOption({label:type.name})
  await page.getByTestId('equipment-check-start-input').fill(`${day}T13:00`)
  await page.getByTestId('equipment-check-end-input').fill(`${day}T15:00`)
  await page.getByTestId('equipment-check-button').click()
  await expect(page.getByTestId('equipment-check-total')).toHaveText('10')
  await expect(page.getByTestId('equipment-check-available')).toHaveText(String(available))
}
test.afterEach(async()=>{
  try {for(const context of contexts)await context.close()} finally {
    contexts.length=0;clearClock();if(currentCase)fixture(currentCase,'--clear');currentCase=undefined
  }
})

// @tc: TC-SCRUM-65-01
// @test: The assigned Coordinator cancels a Planning event and releases all its active arrangements.
// @story: SCRUM-65
// @ac: 1, 2, 3, 4
test("The assigned Coordinator cancels a Planning event and releases all its active arrangements.",async({page})=>{
  const {event,day,before}=await setup(1,page);const reason='Organiser has withdrawn the event'
  await open(page,event);await cancel(page,reason);await details(page,day,reason)
  await arrangements(page,event,before,reason)
  const after=fixture(1,'--snapshot');preserved(before,after,[event.id])
  const released=after.reservations.filter(r=>r.event_request_id===event.id)
  expect(released).toHaveLength(1)
  expect(released[0].status).toBe('Released')
})

// @tc: TC-SCRUM-65-02
// @test: The assigned Coordinator can cancel an event during Safety Check and release its commitments.
// @story: SCRUM-65
// @ac: 1, 2, 3, 4
test("The assigned Coordinator can cancel an event during Safety Check and release its commitments.",async({page})=>{
  const {event,day,before}=await setup(2,page);const reason='Event will no longer proceed'
  await open(page,event);await cancel(page,reason);await details(page,day,reason)
  await arrangements(page,event,before,reason);await open(page,event);await page.reload();await details(page,day,reason)
  preserved(before,fixture(2,'--snapshot'),[event.id])
})

// @tc: TC-SCRUM-65-03
// @test: Cancelling a Confirmed event removes its venue and equipment commitments without increasing total stock.
// @story: SCRUM-65
// @ac: 1, 2, 3, 4
test("Cancelling a Confirmed event removes its venue and equipment commitments without increasing total stock.",async({page,browser})=>{
  const {event,day,before}=await setup(3,page);const reason='Confirmed event has been withdrawn'
  const tech=await session(browser,'tech1');await inventory(tech,before.equipment_types[0],day,5)
  await open(page,event);await cancel(page,reason);await details(page,day,reason)
  await arrangements(page,event,before,reason)
  const booking=before.venue_booking_requests.find(b=>b.event_request_id===event.id)
  await page.goto(`/venues/${booking.venue_id}/availability`)
  await expect(page.getByTestId(`venue-availability-day-empty-${day}`)).toHaveText('Free')
  await inventory(tech,before.equipment_types[0],day,8)
  preserved(before,fixture(3,'--snapshot'),[event.id])
})

// @tc: TC-SCRUM-65-04
// @test: The assigned Coordinator can cancel Submitted and Approved events that have no arrangements.
// @story: SCRUM-65
// @ac: 1, 2
test("The assigned Coordinator can cancel Submitted and Approved events that have no arrangements.",async({page})=>{
  const {events,day}=await setup(4,page)
  const reasons=['Request withdrawn before review','Planning will not proceed']
  for(let i=0;i<events.length;i++) {
    await open(page,events[i]);await cancel(page,reasons[i]);await details(page,day,reasons[i])
    await page.reload();await open(page,events[i]);await details(page,day,reasons[i])
  }
})

// @tc: TC-SCRUM-65-05
// @test: Empty and whitespace-only cancellation reasons are refused without changing the event or its arrangements.
// @story: SCRUM-65
// @ac: 1, 6
test("Empty and whitespace-only cancellation reasons are refused without changing the event or its arrangements.",async({page})=>{
  const {event,before}=await setup(5,page);await open(page,event)
  await cancel(page,'');await expect(el(page,'error')).toHaveText('Cancellation reason is required.')
  await el(page,'reason-input').fill('   ')
  const refusal=page.waitForResponse(response=>response.url().endsWith(`/api/requests/${event.id}/cancel`) && response.request().method()==='POST')
  await el(page,'confirm-button').click()
  const response=await refusal
  expect(response.status()).toBe(400)
  expect(response.request().postDataJSON()).toEqual({reason:'   '})
  expect((await response.json()).message).toBe('Cancellation reason is required.')
  await expect(el(page,'error')).toHaveText('Cancellation reason is required.')
  await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  expect(fixture(5,'--snapshot')).toEqual(before)
})

// @tc: TC-SCRUM-65-06
// @test: Draft, Rejected, Completed and Cancelled events cannot be cancelled.
// @story: SCRUM-65
// @ac: 1, 2, 5, 6
test("Draft, Rejected, Completed and Cancelled events cannot be cancelled.",async({page})=>{
  const {events,before}=await setup(6,page)
  for(const event of events) {
    if(event.status!=='Draft') {await open(page,event);await expect(el(page,'button')).toHaveCount(0)}
    const reply=await page.request.post(`/api/requests/${event.id}/cancel`,{data:{reason:'Attempt to cancel again'}})
    expect((await reply.json()).message).toBe(event.status==='Draft'?'Event request not found.':'Only a Submitted, Approved, Planning, Safety Check or Confirmed event can be cancelled.')
    if(event.status!=='Draft') {await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText(event.status)}
  }
  expect(fixture(6,'--snapshot')).toEqual(before)
})

// @tc: TC-SCRUM-65-07
// @test: A Coordinator who is not assigned to the event cannot cancel it.
// @story: SCRUM-65
// @ac: 1, 6
test("A Coordinator who is not assigned to the event cannot cancel it.",async({page,browser})=>{
  const {event,before}=await setup(7,page,'coord2')
  const reply=await page.request.post(`/api/requests/${event.id}/cancel`,{data:{reason:'Unauthorised cancellation attempt'}})
  expect(await reply.json()).toEqual({message:'Event request not found.'})
  const owner=await session(browser,'coord1');await open(owner,event)
  await expect(owner.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(owner.getByTestId('request-detail-cancellation-details')).toHaveCount(0)
  for(const b of before.venue_booking_requests)await expect(owner.getByTestId(`request-detail-booking-status-${b.id}`)).toHaveText('Approved')
  expect(fixture(7,'--snapshot')).toEqual(before)
})

// @tc: TC-SCRUM-65-08
// @test: The event’s Organiser cannot directly cancel it.
// @story: SCRUM-65
// @ac: 1, 6
test("The event’s Organiser cannot directly cancel it.",async({page})=>{
  const {event,before}=await setup(8,page,'org1');await open(page,event);await expect(el(page,'button')).toHaveCount(0)
  const reply=await page.request.post(`/api/requests/${event.id}/cancel`,{data:{reason:'Organiser wishes to withdraw'}})
  expect(await reply.json()).toEqual({message:'You do not have permission to perform this action.'})
  await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-cancellation-details')).toHaveCount(0)
  expect(fixture(8,'--snapshot')).toEqual(before)
})

// @tc: TC-SCRUM-65-09
// @test: Cancellation preserves historical arrangement statuses and details.
// @story: SCRUM-65
// @ac: 3, 4
test("Cancellation preserves historical arrangement statuses and details.",async({page})=>{
  const {event,day,before}=await setup(9,page);const reason='Event will not proceed'
  await open(page,event);await cancel(page,reason);await details(page,day,reason)
  await arrangements(page,event,before,reason)
  const after=fixture(9,'--snapshot');preserved(before,after,[event.id])
})

// @tc: TC-SCRUM-65-10
// @test: The assigned Coordinator and Organiser can reopen the cancelled event and view persistent cancellation details without further planning actions.
// @story: SCRUM-65
// @ac: 2, 5
test("The assigned Coordinator and Organiser can reopen the cancelled event and view persistent cancellation details without further planning actions.",async({page,browser})=>{
  const {event,day}=await setup(10,page);const reason='Organiser has cancelled the programme'
  await open(page,event);await cancel(page,reason);await details(page,day,reason)
  const check=async p=>{
    await pageNoActions(p)
    await p.reload();await open(p,event);await details(p,day,reason);await pageNoActions(p)
  }
  await check(page)
  const organiser=await session(browser,'org1');await open(organiser,event);await details(organiser,day,reason);await check(organiser)
})

async function pageNoActions(page) {
  for(const suffix of ['cancel-button','complete-button','approve-button','reject-button','resubmit-button','submit-button','edit-button','send-safety-button'])
    await expect(page.getByTestId(`request-detail-${suffix}`)).toHaveCount(0)
}
