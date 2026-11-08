let actor: string | null = null
const listeners = new Set<() => void>()
export const workspaceIdentity = () => actor
export function setWorkspaceIdentity(uid: string | null) {
  if (actor === uid) return
  actor = uid
  listeners.forEach(listener => listener())
}
export function activeWorkspace() {
  if (!actor) return 'personal'
  try { return sessionStorage.getItem(`studio-workspace:${actor}`) || 'personal' } catch { return 'personal' }
}
export function selectWorkspace(uid: string, scope: string) {
  if (uid !== actor) throw new Error('Sign in again before switching workspaces.')
  if (scope !== 'personal' && !/^ws:[0-9a-f-]{36}$/i.test(scope)) throw new Error('Invalid workspace')
  sessionStorage.setItem(`studio-workspace:${uid}`, scope)
  listeners.forEach(listener => listener())
}
export function subscribeWorkspace(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
