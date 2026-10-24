import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuth } from '../../../app/auth'
import * as api from '../api'
import CancellationSection from '../CancellationSection'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')
// @story: SCRUM-65
// @ac: 1, 2, 3, 4, 5, 6
const EVENT = { id:65,name:'Cancellation event',status:'Planning',assigned_coordinator:'coord1',created_by:'org1',
  facilities:[],accessibility_features:[],date:'2036-06-10',start_time:'13:00',end_time:'15:00' }
const REASON = 'Organiser has withdrawn the event.'
const DONE = {...EVENT,status:'Cancelled',cancellation:{cancelled_by:'coord1',cancelled_at:'2036-06-10T02:00:00Z',reason:REASON}}
const id = (suffix) => screen.getByTestId(`request-detail-cancel-${suffix}`)
function auth(user='coord1',features=['requests.cancel']) {
  vi.mocked(useAuth).mockReturnValue({account:{username:user},can:key=>features.includes(key)})
}
function mount(event=EVENT) {
  auth();const onCancelled=vi.fn()
  return {...render(<CancellationSection event={event} onCancelled={onCancelled}/>),onCancelled}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function open(user) {await user.click(id('button'))}
afterEach(()=>vi.resetAllMocks())

describe('SCRUM-65 cancellation',()=>{
  it.each(['Submitted','Approved','Planning','Safety Check','Confirmed'])('offers cancellation in %s',status=>{
    mount({...EVENT,status});expect(id('button')).toBeInTheDocument()
  })
  it.each([undefined,{}, {can:()=>true}])('hides mutations without a complete auth context',context=>{
    vi.mocked(useAuth).mockReturnValue(context)
    render(<CancellationSection event={EVENT} onCancelled={vi.fn()}/>)
    expect(screen.queryByRole('region',{name:'Event cancellation'})).not.toBeInTheDocument()
  })
  it.each([['org1',[],EVENT],['coord2',['requests.cancel'],EVENT],['coord1',['requests.cancel'],{...EVENT,status:'Cancelled'}]])('hides unavailable action for %s',(user,features,event)=>{
    auth(user,features);render(<CancellationSection event={event} onCancelled={vi.fn()}/>)
    expect(screen.queryByTestId('request-detail-cancel-button')).not.toBeInTheDocument()
  })
  it('shows persisted actor, full UTC time and reason without a mutation action',()=>{
    mount(DONE)
    expect(screen.getByTestId('request-detail-cancellation-details')).toHaveTextContent('Cancelled by coord1 at 10 Jun 2036, 02:00 UTC')
    expect(screen.getByTestId('request-detail-cancellation-reason')).toHaveTextContent(REASON)
    expect(screen.queryByTestId('request-detail-cancel-button')).not.toBeInTheDocument()
  })
  it('focuses the reason and dismisses without submitting',async()=>{
    const user=userEvent.setup();mount();await open(user)
    expect(id('reason-input')).toHaveFocus()
    await user.type(id('reason-input'),REASON);await user.click(id('dismiss-button'));await open(user)
    expect(id('reason-input')).toHaveValue('');expect(api.cancelRequest).not.toHaveBeenCalled()
  })
  it('sends the reason and disables all controls while pending',async()=>{
    const user=userEvent.setup();const {onCancelled}=mount();const pending=deferred()
    vi.mocked(api.cancelRequest).mockReturnValue(pending.promise)
    await open(user);await user.type(id('reason-input'),REASON);await user.click(id('confirm-button'))
    expect(api.cancelRequest).toHaveBeenCalledExactlyOnceWith(65,REASON)
    for(const field of ['reason-input','dismiss-button','confirm-button'])expect(id(field)).toBeDisabled()
    await act(async()=>pending.resolve(DONE))
    expect(onCancelled).toHaveBeenCalledExactlyOnceWith(DONE)
    expect(screen.queryByTestId('request-detail-cancel-form')).not.toBeInTheDocument()
  })
  it('displays a server refusal for blank reason without losing the form and permits retry',async()=>{
    const user=userEvent.setup();const {onCancelled}=mount()
    vi.mocked(api.cancelRequest).mockRejectedValue(new Error('Cancellation reason is required.'))
    await open(user);await user.click(id('confirm-button'))
    expect(api.cancelRequest).toHaveBeenCalledExactlyOnceWith(65,'')
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancellation reason is required.')
    expect(onCancelled).not.toHaveBeenCalled();expect(id('confirm-button')).toBeEnabled()
    await user.click(id('dismiss-button'));await open(user);expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['resolve','reject'])('discards late %s after navigation',async mode=>{
    const user=userEvent.setup();const {rerender,onCancelled}=mount();const pending=deferred()
    vi.mocked(api.cancelRequest).mockReturnValue(pending.promise)
    await open(user);await user.click(id('confirm-button'))
    rerender(<CancellationSection event={{...EVENT,id:67}} onCancelled={onCancelled}/>)
    await act(async()=>mode==='resolve'?pending.resolve(DONE):pending.reject(new Error('Old error')))
    expect(onCancelled).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await open(user);expect(id('confirm-button')).toBeEnabled()
  })
  it('discards success after unmount',async()=>{
    const user=userEvent.setup();const {unmount,onCancelled}=mount();const pending=deferred()
    vi.mocked(api.cancelRequest).mockReturnValue(pending.promise)
    await open(user);await user.click(id('confirm-button'));unmount()
    await act(async()=>pending.resolve(DONE));expect(onCancelled).not.toHaveBeenCalled()
  })
  it('updates the real detail and refreshes venue records on cancellation',async()=>{
    auth('coord1',['requests.cancel','venues.view','bookings.edit'])
    vi.mocked(api.getRequest).mockResolvedValue(EVENT)
    vi.mocked(api.listHolds).mockResolvedValue([])
    vi.mocked(api.listBookings).mockResolvedValue([])
    vi.mocked(api.cancelRequest).mockResolvedValue(DONE)
    const user=userEvent.setup()
    render(<MemoryRouter initialEntries={['/requests/65']}><Routes><Route path="/requests/:id" element={<RequestDetailPage/>}/></Routes></MemoryRouter>)
    await screen.findByTestId('request-detail-cancel-button')
    await waitFor(()=>expect(api.listBookings).toHaveBeenCalledTimes(1))
    await open(user);await user.type(id('reason-input'),REASON);await user.click(id('confirm-button'))
    await waitFor(()=>expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Cancelled'))
    expect(screen.getByTestId('request-detail-cancellation-reason')).toHaveTextContent(REASON)
    await waitFor(()=>expect(api.listBookings).toHaveBeenCalledTimes(2))
    expect(api.listHolds).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('request-detail-cancel-button')).not.toBeInTheDocument()
  })
  it('keeps only one lifecycle confirmation open on the real page',async()=>{
    auth('coord1',['requests.cancel','requests.complete'])
    vi.mocked(api.getRequest).mockResolvedValue({...EVENT,status:'Confirmed'})
    const user=userEvent.setup()
    render(<MemoryRouter initialEntries={['/requests/65']}><Routes><Route path="/requests/:id" element={<RequestDetailPage/>}/></Routes></MemoryRouter>)
    await screen.findByTestId('request-detail-cancel-button')
    await user.click(screen.getByTestId('request-detail-complete-button'))
    expect(screen.getByTestId('request-detail-complete-form')).toBeInTheDocument()
    await open(user)
    expect(screen.queryByTestId('request-detail-complete-form')).not.toBeInTheDocument()
    expect(id('reason-input')).toHaveFocus()
    await user.click(screen.getByTestId('request-detail-complete-button'))
    expect(screen.queryByTestId('request-detail-cancel-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-complete-form')).toBeInTheDocument()
  })

})
