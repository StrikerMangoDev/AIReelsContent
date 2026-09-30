import { createContext, useContext } from 'react'
import type { User } from 'firebase/auth'
export type Identity = { uid: string; email: string; name: string; role: 'user' | 'admin'; emailVerified: boolean }
export const AuthContext = createContext<{ user: User | null; identity: Identity | null; loading: boolean; error: string; configured: boolean }>({ user: null, identity: null, loading: true, error: '', configured: false })
export function useAuth() { return useContext(AuthContext) }
