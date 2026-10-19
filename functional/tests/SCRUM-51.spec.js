import { test, expect, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// SCRUM-51 curated twelve rows, exact names/order. No SCRUM-52 placeholder test.
// Each test stages and clears only its own event/type namespace, including retries.
const script=fileURLToPath(new URL('../fixtures/scrum51.py',import.meta.url))
const baseURL='http://localhost:5173'
let currentCase
let contexts=[]
const fixture=(n,option)=>execFileSync('python',[script,String(n),...(option?[option]:[])],{encoding:'utf8'})
const snapshot=(n)=>JSON.parse(fixture(n,'--snapshot'))
const preserved=(state)=>({events:state.events,types:state.types,requirements:state.requirements})
async function apiAs(username) {
  const api=await request.newContext({baseURL}); contexts.push(api)
  expect((await api.post('/api/login',{data:{username,password:'Passw0rd!'}})).status()).toBe(200)
  return api
}
async function login(page,username) {
  await page.goto('/login'); await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!'); await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}
async function setup(n,page,user='tech1') {
  currentCase=n; fixture(n)
  const api=await apiAs('tech1')
  const events=await (await api.get('/api/equipment/requests')).json()
  const event=events.find(e=>e.name===`SCRUM-51 TC${String(n).padStart(2,'0')} Event`)
  expect(event).toBeTruthy()
  const detail=await (await api.get(`/api/requests/${event.id}/equipment`)).json()
  const before=snapshot(n)
  await login(page,user)
  await page.getByTestId('layout-nav-equipment-requirements').click()
  if(user!=='coord2') await page.getByTestId(`equipment-requests-event-${event.id}`).click()
  return {api,event,detail,before}
}
const el=(page,suffix)=>page.getByTestId(`equipment-requirements-${suffix}`)
const reserveURL=(event,row)=>`/api/requests/${event.id}/equipment/${row.id}/reserve`
const releaseURL=(event,row)=>`/api/requests/${event.id}/equipment/reservations/${row.id}/release`
async function action(page,mode,id) {
  await el(page,`${mode}-${id}`).click(); await expect(el(page,'reservation-cancel-button')).toBeFocused()
  await el(page,'reservation-save-button').click()
}
async function inventoryCheck(page,type,date,start,end,reserved,free) {
  await page.getByTestId('layout-nav-equipment').click()
  await page.getByTestId('equipment-check-type-input').selectOption({label:type})
  await page.getByTestId('equipment-check-start-input').fill(`${date}T${start}`)
  await page.getByTestId('equipment-check-end-input').fill(`${date}T${end}`)
  await page.getByTestId('equipment-check-button').click()
  await expect(page.getByTestId('equipment-check-reserved')).toHaveText(String(reserved))
  await expect(page.getByTestId('equipment-check-available')).toHaveText(String(free))
}
async function reservationRead(api,event) {
  const reply=await api.get(`/api/requests/${event.id}/equipment/reservations`)
  expect(reply.status()).toBe(200); return reply.json()
}
test.afterEach(async()=>{
  await Promise.all(contexts.map(c=>c.dispose())); contexts=[]
  if(currentCase) fixture(currentCase,'--clear')
  currentCase=undefined
})

// @tc: TC-SCRUM-51-01
// @test: Technical Support reserves the full Approved requirement quantity and reduces availability without changing total inventory.
// @story: SCRUM-51
// @ac: 1, 2, 5, 6
test('Technical Support reserves the full Approved requirement quantity and reduces availability without changing total inventory.',async({page})=>{
  const {api,event,detail,before}=await setup(1,page); const row=detail.requirements[0]
  await action(page,'reserve',row.id); await expect(el(page,'banner')).toHaveText('Equipment reserved')
  await expect(el(page,`reserve-${row.id}`)).toHaveCount(0)
  await page.reload(); const records=await reservationRead(api,event); expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({event_request_id:event.id,equipment_type_id:row.equipment_type_id,quantity:4,date:event.date,start_time:'10:00',end_time:'12:00',status:'Reserved'})
  await expect(el(page,`reservation-${records[0].id}`)).toContainText(`${row.equipment_type_name} × 4`)
  await expect(el(page,`reservation-status-${records[0].id}`)).toHaveText('Reserved')
  await inventoryCheck(page,row.equipment_type_name,event.date,'11:00','13:00',4,6)
  expect(preserved(snapshot(1))).toEqual(preserved(before))
})
// @tc: TC-SCRUM-51-02
// @test: A reservation succeeds when available units exactly meet the Approved requirement quantity.
// @story: SCRUM-51
// @ac: 1, 3, 6
test('A reservation succeeds when available units exactly meet the Approved requirement quantity.',async({page})=>{
  const {api,event,detail,before}=await setup(2,page)
  await action(page,'reserve',detail.requirements[0].id); await expect(el(page,'banner')).toHaveText('Equipment reserved')
  await page.reload(); const records=await reservationRead(api,event); expect(records).toHaveLength(1); expect(records[0].quantity).toBe(4)
  await expect(el(page,`reservation-status-${records[0].id}`)).toHaveText('Reserved')
  await inventoryCheck(page,detail.requirements[0].equipment_type_name,event.date,'10:00','12:00',10,0)
  const after=snapshot(2); expect(preserved(after)).toEqual(preserved(before)); expect(after.reservations).toEqual(expect.arrayContaining(before.reservations))
})
// @tc: TC-SCRUM-51-03
// @test: A reservation is refused when availability is one unit below the Approved requirement quantity.
// @story: SCRUM-51
// @ac: 3, 7
test('A reservation is refused when availability is one unit below the Approved requirement quantity.',async({page})=>{
  const {api,event,detail,before}=await setup(3,page)
  await action(page,'reserve',detail.requirements[0].id)
  await expect(el(page,'banner')).toHaveText('Insufficient equipment: 3 units available for this period.')
  await expect(el(page,'reservation-form')).toBeVisible(); await page.reload()
  expect(await reservationRead(api,event)).toEqual([]); expect(snapshot(3)).toEqual(before)
})
// @tc: TC-SCRUM-51-04
// @test: Reservation periods that only touch do not prevent reserving the equipment.
// @story: SCRUM-51
// @ac: 3, 6
test('Reservation periods that only touch do not prevent reserving the equipment.',async({page})=>{
  const {api,event,detail,before}=await setup(4,page)
  await action(page,'reserve',detail.requirements[0].id); await expect(el(page,'banner')).toHaveText('Equipment reserved')
  await page.reload(); const records=await reservationRead(api,event)
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({quantity:4,start_time:'10:00',end_time:'12:00',status:'Reserved'})
  await expect(el(page,`reservation-status-${records[0].id}`)).toHaveText('Reserved')
  const after=snapshot(4); expect(preserved(after)).toEqual(preserved(before)); expect(after.reservations).toEqual(expect.arrayContaining(before.reservations))
})
// @tc: TC-SCRUM-51-05
// @test: Reservation rechecks current availability after another event commits equipment.
// @story: SCRUM-51
// @ac: 3, 7
test('Reservation rechecks current availability after another event commits equipment.',async({page})=>{
  const {api,event,detail,before}=await setup(5,page)
  await el(page,`check-${detail.requirements[0].id}`).click(); await expect(el(page,`check-available-${detail.requirements[0].id}`)).toHaveText('10')
  const separate=await apiAs('tech1'); const other=before.events.find(e=>e[1].endsWith('Other Event'))
  const otherDetail=await (await separate.get(`/api/requests/${other[0]}/equipment`)).json()
  expect((await separate.post(reserveURL({id:other[0]},otherDetail.requirements[0]))).status()).toBe(201)
  const committed=snapshot(5)
  await action(page,'reserve',detail.requirements[0].id)
  await expect(el(page,'banner')).toHaveText('Insufficient equipment: 5 units available for this period.')
  await page.reload(); expect(await reservationRead(api,event)).toEqual([]); expect(snapshot(5)).toEqual(committed)
  expect(preserved(snapshot(5))).toEqual(preserved(before))
})
// @tc: TC-SCRUM-51-06
// @test: Requested and Declined equipment requirements cannot be reserved.
// @story: SCRUM-51
// @ac: 1, 7
test('Requested and Declined equipment requirements cannot be reserved.',async({page})=>{
  const {api,event,detail,before}=await setup(6,page)
  for(const row of detail.requirements) {
    await expect(el(page,`reserve-${row.id}`)).toHaveCount(0)
    const reply=await api.post(reserveURL(event,row)); expect(reply.status()).toBe(409)
    expect((await reply.json()).message).toBe('Only an Approved equipment requirement can be reserved.')
  }
  await page.reload(); expect(await reservationRead(api,event)).toEqual([]); expect(snapshot(6)).toEqual(before)
})
// @tc: TC-SCRUM-51-07
// @test: Releasing a reservation restores its commitment while preserving its record and other reservations.
// @story: SCRUM-51
// @ac: 4, 5, 6
test('Releasing a reservation restores its commitment while preserving its record and other reservations.',async({page})=>{
  const {api,event,detail,before}=await setup(7,page); const record=detail.reservations[0]
  await action(page,'release',record.id); await expect(el(page,'banner')).toHaveText('Equipment reservation released')
  await page.reload(); const records=await reservationRead(api,event); expect(records).toEqual([{...record,status:'Released'}])
  await expect(el(page,`reservation-status-${record.id}`)).toHaveText('Released')
  await inventoryCheck(page,record.equipment_type_name,event.date,'10:00','12:00',3,7)
  const after=snapshot(7); expect(preserved(after)).toEqual(preserved(before))
  expect(after.reservations).toEqual(before.reservations.map(r=>r.id===record.id?{...r,status:'Released'}:r))
})
// @tc: TC-SCRUM-51-08
// @test: Equipment cannot be reserved or released while the event is in Safety Check.
// @story: SCRUM-51
// @ac: 1, 4, 7
test('Equipment cannot be reserved or released while the event is in Safety Check.',async({page})=>{
  const {api,event,detail,before}=await setup(8,page)
  await expect(el(page,`reserve-${detail.requirements[0].id}`)).toHaveCount(0)
  await expect(el(page,`release-${detail.reservations[0].id}`)).toHaveCount(0)
  for(const url of [reserveURL(event,detail.requirements[0]),releaseURL(event,detail.reservations[0])]) {
    const reply=await api.post(url); expect(reply.status()).toBe(409)
    expect((await reply.json()).message).toBe('Equipment can only be reserved or released while the event is Approved or Planning.')
  }
  await page.reload(); expect(snapshot(8)).toEqual(before)
  await expect(el(page,`reservation-status-${detail.reservations[0].id}`)).toHaveText('Reserved')
})
// @tc: TC-SCRUM-51-09
// @test: The assigned Coordinator can view reservation details but cannot reserve or release equipment.
// @story: SCRUM-51
// @ac: 5, 7
test('The assigned Coordinator can view reservation details but cannot reserve or release equipment.',async({page})=>{
  const {event,detail,before}=await setup(9,page,'coord1'); const coordinator=await apiAs('coord1')
  for(const record of detail.reservations) {
    await expect(el(page,`reservation-${record.id}`)).toContainText(`${record.equipment_type_name} × ${record.quantity}`)
    await expect(el(page,`reservation-status-${record.id}`)).toHaveText(record.status)
    await expect(el(page,`reservation-period-${record.id}`)).toContainText('10:00–12:00')
    await expect(el(page,`release-${record.id}`)).toHaveCount(0)
  }
  const unreserved=detail.requirements.find(r=>r.equipment_type_name.endsWith('Speakers'))
  await expect(el(page,`reserve-${unreserved.id}`)).toHaveCount(0)
  for(const url of [reserveURL(event,unreserved),releaseURL(event,detail.reservations[0])]) {
    const reply=await coordinator.post(url); expect(reply.status()).toBe(403); expect((await reply.json()).message).toBeTruthy()
  }
  await page.reload(); expect(snapshot(9)).toEqual(before)
})
// @tc: TC-SCRUM-51-10
// @test: Technical Support can release and reserve again while preserving Released history without double-counting it.
// @story: SCRUM-51
// @ac: 1, 2, 4, 5, 6
test('Technical Support can release and reserve again while preserving Released history without double-counting it.',async({page})=>{
  const {api,event,detail,before}=await setup(10,page); const old=detail.reservations[0]
  await action(page,'release',old.id); await expect(el(page,`reservation-status-${old.id}`)).toHaveText('Released')
  await action(page,'reserve',detail.requirements[0].id); await expect(el(page,'banner')).toHaveText('Equipment reserved')
  await page.reload(); const records=await reservationRead(api,event)
  expect(records).toHaveLength(2); expect(records[0]).toEqual({...old,status:'Released'})
  expect(records[1]).toMatchObject({quantity:4,date:event.date,start_time:'10:00',end_time:'12:00',status:'Reserved'})
  await expect(el(page,`reservation-status-${records[1].id}`)).toHaveText('Reserved')
  await inventoryCheck(page,old.equipment_type_name,event.date,'10:00','12:00',4,0)
  expect(preserved(snapshot(10))).toEqual(preserved(before))
})
// @tc: TC-SCRUM-51-11
// @test: A second reservation is refused while the requirement already has an unreleased reservation.
// @story: SCRUM-51
// @ac: 2, 7
test('A second reservation is refused while the requirement already has an unreleased reservation.',async({page})=>{
  const {api,event,detail,before}=await setup(11,page)
  await expect(el(page,`reserve-${detail.requirements[0].id}`)).toHaveCount(0)
  const reply=await api.post(reserveURL(event,detail.requirements[0])); expect(reply.status()).toBe(409)
  expect((await reply.json()).message).toBe('This requirement already has an unreleased reservation.')
  await page.reload(); expect(await reservationRead(api,event)).toHaveLength(1); expect(snapshot(11)).toEqual(before)
})
// @tc: TC-SCRUM-51-12
// @test: A Coordinator who is not assigned to the event cannot view its reservation details.
// @story: SCRUM-51
// @ac: 5
test('A Coordinator who is not assigned to the event cannot view its reservation details.',async({page})=>{
  const {api,event,detail,before}=await setup(12,page,'coord2'); const other=await apiAs('coord2')
  await expect(page.getByTestId(`equipment-requests-event-${event.id}`)).toHaveCount(0)
  await page.goto(`/requests/${event.id}/equipment`)
  await expect(el(page,'banner')).toHaveText('You cannot access this event\'s equipment requirements.')
  await expect(el(page,`reservation-${detail.reservations[0].id}`)).toHaveCount(0)
  const refused=await other.get(`/api/requests/${event.id}/equipment/reservations`)
  expect(refused.status()).toBe(403); expect((await refused.json()).message).toBe('You cannot access this event\'s equipment requirements.')
  const owner=await apiAs('coord1'); expect(await reservationRead(owner,event)).toEqual(detail.reservations)
  await page.getByTestId('layout-logout-button').click()
  await login(page,'coord1'); await page.goto(`/requests/${event.id}/equipment`)
  await expect(el(page,`reservation-status-${detail.reservations[0].id}`)).toHaveText('Reserved')
  expect(await reservationRead(api,event)).toEqual(detail.reservations); expect(snapshot(12)).toEqual(before)
})
