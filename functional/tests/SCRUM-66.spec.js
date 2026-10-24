import { test, expect, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

const script=fileURLToPath(new URL('../fixtures/scrum66.py',import.meta.url))
const fixture=(n,flag)=>JSON.parse(execFileSync('python',[script,String(n),...(flag?[flag]:[])],{encoding:'utf8'})||'null')
let currentCase
let contexts=[]
const completionURL=(event)=>`/api/requests/${event.id}/complete`
const el=(page,suffix)=>page.getByTestId(`request-detail-complete-${suffix}`)
async function apiAs(username) {
  const api=await request.newContext({baseURL:'http://localhost:5173'});contexts.push(api)
  expect((await api.post('/api/login',{data:{username,password:'Passw0rd!'}})).status()).toBe(200)
  return api
}
async function login(page,username='coord1') {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}
async function setup(n,page,user='coord1',time='12:01') {
  clearClock();currentCase=n
  const data=fixture(n);pinClock(`${data.day}T${time}`)
  await login(page,user)
  return {...data,event:data.events[0],before:fixture(n,'--snapshot')}
}
async function open(page,event) {
  await page.goto(`/requests/${event.id}`)
  await expect(page.getByTestId('request-detail-status')).toBeVisible()
}
async function complete(page) {
  await el(page,'button').click()
  await expect(el(page,'cancel-button')).toBeFocused()
  await el(page,'confirm-button').click()
}
const utc=(day,time)=>new Date(`${day}T${time}:00+08:00`).toISOString().replace('.000Z','Z')
const completionText=(day,time)=>`Completed by coord1 at ${new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T00:00:00Z`))}, ${time} UTC`
const metadata=async(api,event)=>{
  const reply=await api.get(`/api/requests/${event.id}`);expect(reply.status()).toBe(200);return reply.json()
}
const withoutCompletion=(snapshot)=>({...snapshot,events:snapshot.events.map(({status,completed_at,completed_by_id,...other})=>other)})
test.afterEach(async()=>{
  await Promise.all(contexts.map(c=>c.dispose()));contexts=[]
  clearClock()
  if(currentCase) fixture(currentCase,'--clear')
  currentCase=undefined
})

// @tc: TC-SCRUM-66-01
// @test: The assigned Coordinator completes a Confirmed event exactly at its scheduled end.
// @story: SCRUM-66
// @ac: 1, 3, 4
test('The assigned Coordinator completes a Confirmed event exactly at its scheduled end.',async({page})=>{
  const {event,day}=await setup(1,page,'coord1','12:00')
  await open(page,event);await complete(page)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Completed')
  await page.reload();await expect(page.getByTestId('request-detail-completion-details')).toHaveText(completionText(day,'04:00'))
  await open(page,event)
  expect((await metadata(page.request,event)).completion).toEqual({completed_by:'coord1',completed_at:utc(day,'12:00')})
  await expect(page.getByTestId('request-detail-status')).toHaveText('Completed')
})
// @tc: TC-SCRUM-66-02
// @test: Completion is refused one minute before the event’s scheduled end.
// @story: SCRUM-66
// @ac: 1, 2
test('Completion is refused one minute before the event’s scheduled end.',async({page})=>{
  const {event,before}=await setup(2,page,'coord1','11:59')
  await open(page,event);await complete(page)
  await expect(el(page,'error')).toHaveText('The event cannot be completed before its scheduled end.')
  await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  expect(fixture(2,'--snapshot')).toEqual(before)
})
// @tc: TC-SCRUM-66-03
// @test: Completion just after the scheduled end preserves arrangements and removes the event from active views.
// @story: SCRUM-66
// @ac: 1, 3, 4, 5
test('Completion just after the scheduled end preserves arrangements and removes the event from active views.',async({page,browser})=>{
  const {event,day,before}=await setup(3,page)
  const lead=await apiAs('lead1')
  const original=await (await lead.get('/api/assignments')).json()
  expect(original.events.some(e=>e.id===event.id)).toBe(true)
  const count=original.coordinators.find(c=>c.username==='coord1').active_events
  await open(page,event);await complete(page)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Completed')
  await page.reload();await open(page,event)
  await expect(page.getByTestId('request-detail-completion-details')).toHaveText(completionText(day,'04:01'))
  expect((await metadata(page.request,event)).completion).toEqual({completed_by:'coord1',completed_at:utc(day,'12:01')})
  expect(withoutCompletion(fixture(3,'--snapshot'))).toEqual(withoutCompletion(before))
  await page.goto('/requests')
  await expect(page.getByTestId(`requests-row-${event.id}`)).toBeVisible()
  await expect(page.getByTestId(`requests-status-${event.id}`)).toHaveText('Completed')
  const context=await browser.newContext()
  try {
    const leadPage=await context.newPage();await login(leadPage,'lead1');await leadPage.goto('/assignments')
    await expect(leadPage.getByTestId('assignments-title')).toBeVisible()
    await expect(leadPage.getByTestId(`assignments-row-${event.id}`)).toHaveCount(0)
    await expect(leadPage.getByTestId('assignments-workload-coord1')).toHaveText(`coord1: ${count-1}`)
  } finally { await context.close() }
})
// @tc: TC-SCRUM-66-04
// @test: A non-Confirmed event and an already Completed event cannot be completed.
// @story: SCRUM-66
// @ac: 2, 3
test('A non-Confirmed event and an already Completed event cannot be completed.',async({page})=>{
  const {events,before}=await setup(4,page)
  for(const event of events) {
    await open(page,event);await expect(el(page,'button')).toHaveCount(0)
    const reply=await page.request.post(completionURL(event))
    expect(reply.status()).toBe(409)
    expect((await reply.json()).message).toBe('Only a Confirmed event can be marked as Completed.')
    await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText(event.status)
  }
  expect(fixture(4,'--snapshot')).toEqual(before)
})
// @tc: TC-SCRUM-66-05
// @test: A Coordinator who is not assigned to the event cannot complete it.
// @story: SCRUM-66
// @ac: 1, 2
test('A Coordinator who is not assigned to the event cannot complete it.',async({page,browser})=>{
  const {event,before}=await setup(5,page,'coord2')
  const reply=await page.request.post(completionURL(event))
  expect(reply.status()).toBe(404);expect(await reply.json()).toEqual({message:'Event request not found.'})
  const context=await browser.newContext()
  try {
    const ownerPage=await context.newPage()
    await login(ownerPage,'coord1');await open(ownerPage,event)
    await expect(ownerPage.getByTestId('request-detail-status')).toHaveText('Confirmed')
    await expect(ownerPage.getByTestId('request-detail-completion-details')).toHaveCount(0)
  } finally { await context.close() }
  expect(fixture(5,'--snapshot')).toEqual(before)
})
// @tc: TC-SCRUM-66-06
// @test: The event’s Organiser cannot complete it.
// @story: SCRUM-66
// @ac: 1, 2
test('The event’s Organiser cannot complete it.',async({page})=>{
  const {event,before}=await setup(6,page,'org1')
  await open(page,event);await expect(el(page,'button')).toHaveCount(0)
  const reply=await page.request.post(completionURL(event))
  expect(reply.status()).toBe(403);expect(await reply.json()).toEqual({message:'You do not have permission to perform this action.'})
  await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  expect(fixture(6,'--snapshot')).toEqual(before)
})
// @tc: TC-SCRUM-66-07
// @test: Completion considers the event’s date rather than only its time of day.
// @story: SCRUM-66
// @ac: 1, 2
test('Completion considers the event’s date rather than only its time of day.',async({page})=>{
  const {event,before}=await setup(7,page,'coord1','13:00')
  await open(page,event);await complete(page)
  await expect(el(page,'error')).toHaveText('The event cannot be completed before its scheduled end.')
  await page.reload();await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  expect(fixture(7,'--snapshot')).toEqual(before)
})
