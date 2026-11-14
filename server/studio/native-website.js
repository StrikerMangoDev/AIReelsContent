import { env } from '../config/env.js'
import { capabilityAllowed } from '../policy.js'

// This destination uses the existing reviewed-publication route, never an external CMS.
export function nativeWebsiteDestination(config = env) {
  return {
    id: 'native_website', name: 'AIReelsContent website',
    status: capabilityAllowed('publishing', config) ? 'available' : 'disabled',
    publicationPath: '/insights/:publicationId',
    requirements: ['administrator', 'current independent review', 'separate owner approval', 'current approved sources'],
    automatic: false,
    reason: 'Publishes a reviewed article on this app through the existing administrator-only route. Search Console, GA4, sitemap submission and external CMS delivery are separate integrations. A destination is not a publication receipt.',
  }
}
