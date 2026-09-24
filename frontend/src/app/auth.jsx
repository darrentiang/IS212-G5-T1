import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { login as loginRequest, logout as logoutRequest, me } from '../areas/auth/api'

// The account context (docs/design/frontend.md §5). The API decides what an
// account may do; this only holds the answer so pages can hide controls.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    me()
      .then((data) => setAccount(data))
      .catch(() => {
        // 401 means no account. Any other failure also leaves us without one,
        // and routing sends the user to /login.
        setAccount(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo(
    () => ({
      account,
      loading,
      can: (feature) => Boolean(account?.features?.includes(feature)),
      login: async (username, password) => {
        const data = await loginRequest(username, password)
        setAccount(data)
        return data
      },
      logout: async () => {
        try {
          await logoutRequest()
        } finally {
          setAccount(null)
        }
      },
    }),
    [account, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
