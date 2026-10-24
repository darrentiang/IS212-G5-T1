import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuth } from '../../../app/auth'
import * as api from '../api'
import CompletionSection from '../CompletionSection'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')
// @story: SCRUM-66
// @ac: 1, 2, 3, 4
const EVENT = { id: 66, name: 'Completion event', status: 'Confirmed', assigned_coordinator: 'coord1',
  created_by: 'org1', facilities: [], accessibility_features: [], date: '2035-06-10', start_time:'10:00', end_time:'12:00' }
const DONE = { ...EVENT, status: 'Completed', completion: {completed_by:'coord1', completed_at:'2035-06-10T04:00:00Z'} }
const id = (name) => screen.getByTestId(`request-detail-complete-${name}`)
function auth(user='coord1', features=['requests.complete']) {
  vi.mocked(useAuth).mockReturnValue({account:{username:user},can:(key)=>features.includes(key)})
}
function mount(event=EVENT) {
  auth()
  const onCompleted=vi.fn()
  return { ...render(<CompletionSection event={event} onCompleted={onCompleted}/>), onCompleted }
}
async function open(user) { await user.click(id('button')) }
const deferred=()=>{ let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject} }
afterEach(()=>vi.resetAllMocks())

describe('SCRUM-66 completion',()=>{
  it.each([undefined, {}, {can:()=>true}])('hides mutations without a complete auth context', (context)=>{
    vi.mocked(useAuth).mockReturnValue(context)
    render(<CompletionSection event={EVENT} onCompleted={vi.fn()}/>)
    expect(screen.queryByTestId('request-detail-complete-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', {name:'Event completion'})).not.toBeInTheDocument()
  })
  it.each([
    ['org1', [], EVENT],
    ['coord2', ['requests.complete'], EVENT],
    ['coord1', ['requests.complete'], {...EVENT,status:'Planning'}],
  ])('hides action for %s with unsuitable access/state', (user,features,event)=>{
    auth(user,features)
    render(<CompletionSection event={event} onCompleted={vi.fn()}/> )
    expect(screen.queryByTestId('request-detail-complete-button')).not.toBeInTheDocument()
  })
  it('shows saved completion details without offering another action',()=>{
    mount(DONE)
    expect(screen.getByTestId('request-detail-completion-details')).toHaveTextContent('Completed by coord1 at 10 Jun 2035, 04:00 UTC')
    expect(screen.queryByTestId('request-detail-complete-button')).not.toBeInTheDocument()
  })
  it('does not render an empty region for a legacy Completed record',()=>{
    mount({...EVENT,status:'Completed'})
    expect(screen.queryByRole('region',{name:'Event completion'})).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-completion-details')).not.toBeInTheDocument()
  })
  it('focuses Cancel and cancels without submitting',async()=>{
    const user=userEvent.setup(); mount(); await open(user)
    expect(id('cancel-button')).toHaveFocus()
    await user.click(id('cancel-button'))
    expect(screen.queryByTestId('request-detail-complete-form')).not.toBeInTheDocument()
    expect(api.completeRequest).not.toHaveBeenCalled()
  })
  it('disables confirmation controls while awaiting the real action and reports success',async()=>{
    const user=userEvent.setup(); const {onCompleted}=mount(); const pending=deferred()
    vi.mocked(api.completeRequest).mockReturnValue(pending.promise)
    await open(user); await user.click(id('confirm-button'))
    expect(id('confirm-button')).toBeDisabled(); expect(id('cancel-button')).toBeDisabled()
    expect(api.completeRequest).toHaveBeenCalledExactlyOnceWith(66)
    await act(async()=>pending.resolve(DONE))
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(DONE)
    expect(screen.queryByTestId('request-detail-complete-form')).not.toBeInTheDocument()
  })
  it('keeps refusal visible, permits retry, and clears it on cancel',async()=>{
    const user=userEvent.setup(); const {onCompleted}=mount()
    vi.mocked(api.completeRequest).mockRejectedValue(new Error('The event has not ended.'))
    await open(user); await user.click(id('confirm-button'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The event has not ended.')
    expect(onCompleted).not.toHaveBeenCalled(); expect(id('confirm-button')).toBeEnabled()
    await user.click(id('cancel-button')); await open(user)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['resolve','reject'])('discards late %s after event navigation',async(mode)=>{
    const user=userEvent.setup();const {rerender,onCompleted}=mount();const pending=deferred()
    vi.mocked(api.completeRequest).mockReturnValue(pending.promise)
    await open(user);await user.click(id('confirm-button'))
    rerender(<CompletionSection event={{...EVENT,id:67}} onCompleted={onCompleted}/> )
    await act(async()=>mode==='resolve'?pending.resolve(DONE):pending.reject(new Error('Old refusal')))
    expect(onCompleted).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await open(user);expect(id('confirm-button')).toBeEnabled()
  })
  it('discards completion after unmount',async()=>{
    const user=userEvent.setup();const {unmount,onCompleted}=mount();const pending=deferred()
    vi.mocked(api.completeRequest).mockReturnValue(pending.promise)
    await open(user);await user.click(id('confirm-button'));unmount()
    await act(async()=>pending.resolve(DONE))
    expect(onCompleted).not.toHaveBeenCalled()
  })
  it('updates the actual request detail status and renders completion metadata',async()=>{
    auth();vi.mocked(api.getRequest).mockResolvedValue(EVENT)
    vi.mocked(api.completeRequest).mockResolvedValue(DONE)
    const user=userEvent.setup()
    render(<MemoryRouter initialEntries={['/requests/66']}><Routes><Route path="/requests/:id" element={<RequestDetailPage/>}/></Routes></MemoryRouter>)
    await screen.findByTestId('request-detail-complete-button')
    await open(user);await user.click(id('confirm-button'))
    await waitFor(()=>expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Completed'))
    expect(screen.getByTestId('request-detail-completion-details')).toHaveTextContent('Completed by coord1 at 10 Jun 2035, 04:00 UTC')
  })
})
