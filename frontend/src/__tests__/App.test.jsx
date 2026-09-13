// @tc: TC-INFRA-03
// @story: INFRA
// @ac: 1
// @type: Happy
// @scenario: App renders heading and ping button
// @preconditions: None
// @steps: 1. Render App component
// @test_data: none
// @expected: Heading "ConnectSphere Event Planning" and button "Ping Backend" are visible
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'

describe('App', () => {
  it('renders heading and ping button', () => {
    render(<App />)
    expect(screen.getByText('ConnectSphere Event Planning')).toBeInTheDocument()
    expect(screen.getByText('Ping Backend')).toBeInTheDocument()
  })
})
