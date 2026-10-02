import { z } from 'zod'
export const eventSchema = z.object({
  sessionId: z.string().uuid(), consent: z.literal(true),
  type: z.enum(['page_view', 'article_click', 'region_change', 'category_change', 'search', 'signin', 'signout', 'research_completed', 'package_generated', 'package_approved', 'package_exported']),
  path: z.enum(['/', '/dashboard', '/login', '/signup', '/admin', '/studio']),
  articleId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  value: z.string().max(60).optional(),
}).strict()
