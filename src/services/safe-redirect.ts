export function safeRedirect(requested: string | null): string {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\') || [...requested].some(character => character.charCodeAt(0) <= 32)) return '/'
  try {
    const target = new URL(requested, 'https://local.invalid')
    if (target.origin !== 'https://local.invalid' || !/^\/(?:$|studio(?:\/|$)|studio-review\/[^/]+\/[^/]+$|ideas(?:\/[^/]+(?:\/edit)?)?$|find-ideas$|dashboard$|planning$|workspaces$|usage$)/.test(target.pathname)) return '/'
    return target.pathname + target.search
  } catch { return '/' }
}
