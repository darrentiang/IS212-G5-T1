import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { login as loginRequest, logout as logoutRequest, me } from '../areas/auth/api'
import { getUnreadCount } from '../areas/notifications/api'

// The account context (docs/design/frontend.md §5). The API decides what an
// account may do; this only holds the answer so pages can hide controls.
const AuthContext = createContext(null)

// SCRUM-58: read alongside /api/me, not folded into its payload — a second,
// purpose-built call, the same composition any page already does with
// Promise.all, not a reason for /api/auth to depend on /api/notifications.
function loadUnreadCount(setUnreadCount) {
  getUnreadCount()
    .then((data) => setUnreadCount(data.unread_count))
    .catch(() => setUnreadCount(0))
}

export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    me()
      .then((data) => {
        setAccount(data)
        loadUnreadCount(setUnreadCount)
      })
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
      unreadCount,
      refreshUnreadCount: () => loadUnreadCount(setUnreadCount),
      can: (feature) => Boolean(account?.features?.includes(feature)),
      login: async (username, password) => {
        const data = await loginRequest(username, password)
        setAccount(data)
        loadUnreadCount(setUnreadCount)
        return data
      },
      logout: async () => {
        try {
          await logoutRequest()
        } finally {
          setAccount(null)
          setUnreadCount(0)
        }
      },
    }),
    [account, loading, unreadCount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
