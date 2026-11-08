import { createContext, useContext } from 'react'
export type Identity = { uid: string; email: string; name: string; role: 'user' | 'admin'; emailVerified: boolean }
export const AuthContext = createContext<{ user: { uid: string } | null; identity: Identity | null; loading: boolean; error: string; configured: boolean; provider: 'firebase' | 'hexclave' }>({ user: null, identity: null, loading: true, error: '', configured: false, provider: 'firebase' })
export function useAuth() { return useContext(AuthContext) }
