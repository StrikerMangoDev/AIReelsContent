import { env } from './config/env.js'

// Keys and credit balances are not authorization to dispatch provider work.
export function capabilityAllowed(capability, config = env) {
  if (capability === 'research' || capability === 'generation') return config.CONTENT_LIVE_FREE_CALLS === 'true'
  if (capability === 'media') return config.CONTENT_LOCAL_MEDIA === 'true'
  if (capability === 'publishing') return config.CONTENT_NATIVE_WEBSITE_PUBLISHING === 'true'
  return false
}

export function assertCapability(capability, config = env) {
  if (!capabilityAllowed(capability, config)) throw Object.assign(new Error('This capability is blocked pending access and budget approval.'), {
    status: 503, code: 'CAPABILITY_BLOCKED', publicMessage: 'This capability is blocked pending access and budget approval.',
  })
}
